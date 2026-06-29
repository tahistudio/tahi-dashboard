'use client'

import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, Check } from 'lucide-react'
import { ShellIcon } from '@/components/tahi/shell-icons'
import { Popover } from '@/components/tahi/popover'
import { apiPath } from '@/lib/api'

/** Access rule for a team member (mirrors the AccessRule shape from team page) */
export interface TeamMemberAccessRule {
  role: string        // 'project_manager' | 'task_handler' | 'viewer'
  scopeType: string   // 'all_clients' | 'plan_type' | 'specific_clients'
  planType?: string | null
  trackType: string   // 'all' | 'small' | 'large'
  orgIds?: string[]   // set when scopeType = 'specific_clients'
}

interface ClientImpersonationData {
  type: 'client'
  orgId: string
  orgName: string
  contactId?: string
  contactName?: string
}

interface TeamMemberImpersonationData {
  type: 'team_member'
  teamMemberId: string
  teamMemberName: string
  accessRules: TeamMemberAccessRule[]
}

type ImpersonationData = ClientImpersonationData | TeamMemberImpersonationData

/** @deprecated Use the typed setClientImpersonation or setTeamMemberImpersonation instead */
interface LegacyImpersonationData {
  orgId: string
  orgName: string
  contactId?: string
  contactName?: string
}

const STORAGE_KEY = 'tahi-impersonate'

// Cookie that carries the impersonated org to the server so portal GET
// endpoints (via getPortalAuth) scope to the previewed client. Session cookie
// (no Max-Age) so it dies on browser close; path=/ so it covers the basePath.
const ORG_COOKIE = 'tahi-impersonate-org'

function setImpersonateOrgCookie(orgId: string) {
  try { document.cookie = `${ORG_COOKIE}=${encodeURIComponent(orgId)}; path=/; SameSite=Lax` } catch { /* no document */ }
}

function clearImpersonateOrgCookie() {
  try { document.cookie = `${ORG_COOKIE}=; path=/; Max-Age=0; SameSite=Lax` } catch { /* no document */ }
}

// ---- Reactive sessionStorage store ----
// Allows all components using useImpersonation() to update immediately
// when impersonation is set or cleared, without page refresh.

const listeners = new Set<() => void>()

// Cache the snapshot so useSyncExternalStore gets a stable reference.
// Without this, JSON.parse returns a new object on every call, which
// causes useSyncExternalStore to detect a "change" every render and
// trigger an infinite re-render loop.
let cachedRaw: string | null = null
let cachedSnapshot: ImpersonationData | null = null

function getSnapshot(): ImpersonationData | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored === cachedRaw) return cachedSnapshot
    cachedRaw = stored
    if (!stored) {
      cachedSnapshot = null
      return null
    }
    const parsed = JSON.parse(stored) as ImpersonationData | LegacyImpersonationData
    // Handle legacy format (no type field) - treat as client impersonation
    if (!('type' in parsed) || !parsed.type) {
      const legacy = parsed as LegacyImpersonationData
      if (legacy.orgId) {
        cachedSnapshot = { type: 'client', ...legacy }
        return cachedSnapshot
      }
      cachedSnapshot = null
      return null
    }
    if (parsed.type === 'client' && (parsed as ClientImpersonationData).orgId) {
      cachedSnapshot = parsed as ClientImpersonationData
      return cachedSnapshot
    }
    if (parsed.type === 'team_member' && (parsed as TeamMemberImpersonationData).teamMemberId) {
      cachedSnapshot = parsed as TeamMemberImpersonationData
      return cachedSnapshot
    }
    cachedSnapshot = null
    return null
  } catch {
    cachedRaw = null
    cachedSnapshot = null
    return null
  }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function notify() {
  listeners.forEach(cb => cb())
}

/** Set client impersonation (call from client detail page) */
export function setImpersonation(data: LegacyImpersonationData) {
  const typed: ClientImpersonationData = { type: 'client', ...data }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(typed))
  setImpersonateOrgCookie(data.orgId)
  notify()
}

/** Set team member impersonation (call from team page) */
export function setTeamMemberImpersonation(data: {
  teamMemberId: string
  teamMemberName: string
  accessRules: TeamMemberAccessRule[]
}) {
  const typed: TeamMemberImpersonationData = { type: 'team_member', ...data }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(typed))
  // Team-member view is admin-side scoping, not a client org: drop any org cookie.
  clearImpersonateOrgCookie()
  notify()
}

/** Clear impersonation */
export function clearImpersonation() {
  sessionStorage.removeItem(STORAGE_KEY)
  clearImpersonateOrgCookie()
  notify()
}

/**
 * Banner shown when impersonating a client or team member.
 * Uses useSyncExternalStore for immediate reactivity.
 */
export function ImpersonationBanner() {
  const router = useRouter()
  const impersonation = useSyncExternalStore(subscribe, getSnapshot, () => null)

  const handleExit = useCallback(() => {
    const isTeamMember = impersonation?.type === 'team_member'
    clearImpersonation()
    router.push(isTeamMember ? '/team' : '/clients')
  }, [router, impersonation])

  if (!impersonation) return null

  const isTeamMember = impersonation.type === 'team_member'

  let displayName: string

  if (isTeamMember) {
    displayName = impersonation.teamMemberName
  } else {
    displayName = impersonation.contactName
      ? `${impersonation.contactName} at ${impersonation.orgName}`
      : impersonation.orgName
  }

  return (
    <div className="imp-banner">
      <span className="imp-eye">
        <ShellIcon n="impersonate" s={15} />
      </span>
      {isTeamMember ? (
        <span>
          Viewing as <b>{displayName}</b>
          {impersonation.accessRules.length > 0 && (
            <> ({impersonation.accessRules[0].role.replace(/_/g, ' ')})</>
          )}.
        </span>
      ) : (
        <span>
          Viewing <ClientSwitcher currentOrgId={impersonation.orgId} label={displayName} color="#ffffff" /> . Read-only client view.
        </span>
      )}
      <button className="imp-exit" onClick={handleExit}>Exit preview</button>
    </div>
  )
}

/**
 * Client switcher inside the Client-view banner. Lets the operator jump between
 * clients without exiting first. Fetches the active client list (admin endpoint,
 * so it works even while the impersonation cookie is set) on first open, and a
 * pick re-points the impersonation + reloads so every surface refetches as the
 * new client. The current client + the list are data-private so the banner stays
 * screen-share safe.
 */
function ClientSwitcher({ currentOrgId, label, color }: { currentOrgId: string; label: string; color: string }) {
  const [open, setOpen] = useState(false)
  const [clients, setClients] = useState<{ id: string; name: string }[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  const loadClients = useCallback(async () => {
    if (loaded) return
    try {
      const res = await fetch(apiPath('/api/admin/clients?status=active'))
      if (res.ok) {
        const data = await res.json() as { organisations?: { id: string; name: string }[] }
        setClients(data.organisations ?? [])
      }
    } catch { /* leave empty */ }
    finally { setLoaded(true) }
  }, [loaded])

  const switchTo = (id: string, name: string) => {
    setOpen(false)
    if (id === currentOrgId) return
    setImpersonation({ orgId: id, orgName: name })
    if (typeof window !== 'undefined') window.location.reload()
  }

  const filtered = query.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(query.trim().toLowerCase()))
    : clients

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => { setOpen(o => !o); void loadClients() }}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1 font-semibold"
        style={{ color, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit' }}
      >
        <strong data-private>{label}</strong>
        <ChevronDown className="w-3.5 h-3.5" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms ease', flexShrink: 0 }} aria-hidden="true" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={triggerRef} align="start" width="16rem" mobileFullWidth>
        <div style={{ padding: '0.5rem' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Switch client"
            aria-label="Search clients"
            style={{ width: '100%', padding: '0.4375rem 0.5rem', fontSize: '0.8125rem', borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', marginBottom: '0.375rem' }}
          />
          <div style={{ maxHeight: '15rem', overflowY: 'auto' }} role="menu" aria-label="Clients">
            {!loaded ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', padding: '0.5rem', margin: 0 }}>Loading clients...</p>
            ) : filtered.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', padding: '0.5rem', margin: 0 }}>No clients found</p>
            ) : filtered.map(c => {
              const active = c.id === currentOrgId
              return (
                <button
                  key={c.id}
                  type="button"
                  role="menuitem"
                  onClick={() => switchTo(c.id, c.name)}
                  className="w-full"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'left', padding: '0.4375rem 0.5rem', borderRadius: 'var(--radius-sm)', border: 'none', background: active ? 'var(--color-bg-secondary)' : 'transparent', color: 'var(--color-text)', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: active ? 600 : 500, minHeight: '2.25rem' }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
                >
                  <span data-private style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  {active && <Check className="w-3.5 h-3.5" style={{ color: 'var(--color-brand)', flexShrink: 0 }} aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        </div>
      </Popover>
    </>
  )
}

/**
 * Hook to check if impersonation is active.
 * Reactively updates when impersonation state changes.
 */
export function useImpersonation() {
  const data = useSyncExternalStore(subscribe, getSnapshot, () => null)

  const isClient = data?.type === 'client'
  const isTeamMember = data?.type === 'team_member'

  return {
    isImpersonating: data !== null,
    /** True when impersonating a client (legacy "View as Client") */
    isImpersonatingClient: isClient,
    /** True when impersonating a team member ("View as Team Member") */
    isImpersonatingTeamMember: isTeamMember,
    impersonatedOrgId: isClient ? (data as ClientImpersonationData).orgId : null,
    impersonatedOrgName: isClient ? (data as ClientImpersonationData).orgName : null,
    impersonatedContactId: isClient ? ((data as ClientImpersonationData).contactId ?? null) : null,
    impersonatedContactName: isClient ? ((data as ClientImpersonationData).contactName ?? null) : null,
    /** Team member ID when impersonating a team member */
    impersonatedTeamMemberId: isTeamMember ? (data as TeamMemberImpersonationData).teamMemberId : null,
    /** Team member name when impersonating a team member */
    impersonatedTeamMemberName: isTeamMember ? (data as TeamMemberImpersonationData).teamMemberName : null,
    /** Access rules for the impersonated team member */
    impersonatedAccessRules: isTeamMember ? (data as TeamMemberImpersonationData).accessRules : [],
  }
}
