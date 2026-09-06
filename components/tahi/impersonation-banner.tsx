'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, Check } from 'lucide-react'
import { ShellIcon } from '@/components/tahi/shell-icons'
import { Popover } from '@/components/tahi/popover'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { usePermissions } from '@/components/tahi/permissions-context'
import { apiPath } from '@/lib/api'
import {
  ACT_MODE_VALUE,
  IMPERSONATE_MODE_COOKIE,
  IMPERSONATE_ORG_COOKIE,
  readPreviewMode,
  readPreviewOrgId,
  type PreviewMode,
} from '@/lib/preview-cookie'

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
  /**
   * 'view' (default) is the read-only lens. 'act' means writes are real.
   *
   * Mirrors the tahi-impersonate-mode cookie the server actually reads, so the
   * UI and the API cannot disagree about which strip to paint. Never the
   * authority for anything: getPortalAuth re-proves the right to act on every
   * request.
   */
  mode?: PreviewMode
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
// The name and the "does this value name an org" rule come from
// lib/preview-cookie.ts, which the middleware and every server component read
// too: one definition of previewing for the whole app.
const ORG_COOKIE = IMPERSONATE_ORG_COOKIE

function setImpersonateOrgCookie(orgId: string) {
  try { document.cookie = `${ORG_COOKIE}=${encodeURIComponent(orgId)}; path=/; SameSite=Lax` } catch { /* no document */ }
}

function clearImpersonateOrgCookie() {
  try { document.cookie = `${ORG_COOKIE}=; path=/; Max-Age=0; SameSite=Lax` } catch { /* no document */ }
  clearImpersonateModeCookie()
}

/**
 * Act as client is ARMED by the server (POST /api/admin/impersonate/mode, which
 * checks super_admin), never from here. Disarming is local as well as remote,
 * because putting the mode down must work even when the network does not: the
 * cookie is only intent, and the server refuses to honour it for anyone who is
 * not entitled anyway. Three places clear the org cookie (this file,
 * middleware.ts, /api/admin/impersonate/exit) and all three now clear this one
 * with it, or an operator returns to the studio still armed.
 */
function clearImpersonateModeCookie() {
  try {
    document.cookie = `${IMPERSONATE_MODE_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`
  } catch { /* no document */ }
}

/** What the SERVER would read for the mode, right now. */
function readImpersonateModeCookie(): PreviewMode {
  if (typeof document === 'undefined') return 'view'
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === IMPERSONATE_MODE_COOKIE) return readPreviewMode(rest.join('='))
  }
  return 'view'
}

/**
 * What the SERVER would read from this browser, right now. Not the React prop,
 * which is one render behind: this is the live value, so it is safe to check
 * in the same tick as a state change.
 */
function readImpersonateOrgCookie(): string | null {
  if (typeof document === 'undefined') return null
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === ORG_COOKIE) return readPreviewOrgId(rest.join('='))
  }
  return null
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
  // Always read-only to start with, including when switching clients from
  // inside the banner. An armed mode must never ride across from one client to
  // another: the operator agreed to act for THAT client, not for the next one.
  const typed: ClientImpersonationData = { type: 'client', ...data, mode: 'view' }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(typed))
  setImpersonateOrgCookie(data.orgId)
  clearImpersonateModeCookie()
  notify()
}

/**
 * Adopt what the SERVER already reads from this browser into a tab that has no
 * store yet (a bookmark, a second window, a restored session).
 *
 * Store-only, and that is the whole point: it must touch no cookie. Routing
 * this through setImpersonation, as it once did, cleared the mode cookie as a
 * side effect, so merely opening a second tab silently disarmed Act as client
 * for the whole browser and the first tab quietly followed it down. Failing
 * safe is not the same as behaving predictably.
 */
function adoptServerPreview(orgId: string, orgName: string, mode: PreviewMode) {
  const typed: ClientImpersonationData = { type: 'client', orgId, orgName, mode }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(typed))
  notify()
}

/**
 * Record the mode this tab is in. Store-only: the cookie is the server's to
 * set (arming) and is cleared separately (disarming), so this never invents a
 * permission, it only keeps the strip honest about the answer the server gave.
 */
function setStoredMode(mode: PreviewMode) {
  const current = getSnapshot()
  if (current?.type !== 'client') return
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, mode }))
  notify()
}

/**
 * Ask the server to arm or disarm Act as client, and reload once it answers.
 *
 * The reload is not laziness. Read-only state reaches the page from three
 * places at once (this per-tab store, server-rendered props on the portal
 * surfaces, and the audience the shell layout resolved), and a half-refreshed
 * page in this particular mode means a control that looks disabled while the
 * route behind it writes, or the reverse. One reload, everything agrees.
 */
export async function requestClientViewMode(mode: PreviewMode): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(apiPath('/api/admin/impersonate/mode'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      return { ok: false, error: data.error ?? 'Could not change client view mode.' }
    }
    if (mode !== ACT_MODE_VALUE) clearImpersonateModeCookie()
    setStoredMode(mode)
    if (typeof window !== 'undefined') window.location.reload()
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
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

export interface ImpersonationBannerProps {
  /**
   * `organisations.id` the tahi-impersonate-org cookie names, resolved
   * server-side by the dashboard layout (lib/view-audience.ts). Null when the
   * session is not previewing anyone.
   */
  serverPreviewOrgId?: string | null
  /** That org's name, so a tab adopting the cookie can label the strip. */
  serverPreviewOrgName?: string | null
  /**
   * The mode the SERVER read from tahi-impersonate-mode. Same reason as the org
   * id above: a fresh tab carries the cookie without this tab's store, and a
   * strip that says "read-only" over a session whose writes are landing is the
   * worst of the states this file exists to prevent.
   */
  serverPreviewMode?: PreviewMode
}

/**
 * Banner shown when impersonating a client or team member.
 * Uses useSyncExternalStore for immediate reactivity.
 */
export function ImpersonationBanner({
  serverPreviewOrgId = null,
  serverPreviewOrgName = null,
  serverPreviewMode = 'view',
}: ImpersonationBannerProps = {}) {
  const router = useRouter()
  const pathname = usePathname()
  const impersonation = useSyncExternalStore(subscribe, getSnapshot, () => null)
  // Fail-closed by default (see PermissionsProvider's DEFAULT), and the server
  // checks again on the route that arms the mode and on every write, so this
  // only decides whether the control is worth painting.
  const { isSuperAdmin } = usePermissions()
  const [confirmActOpen, setConfirmActOpen] = useState(false)
  const [modeError, setModeError] = useState<string | null>(null)
  const [modeBusy, setModeBusy] = useState(false)

  const handleExit = useCallback(() => {
    const isTeamMember = impersonation?.type === 'team_member'
    clearImpersonation()
    router.push(isTeamMember ? '/team' : '/clients')
  }, [router, impersonation])

  const enterActMode = useCallback(async () => {
    setModeBusy(true)
    setModeError(null)
    const result = await requestClientViewMode(ACT_MODE_VALUE)
    setConfirmActOpen(false)
    setModeBusy(false)
    if (!result.ok) setModeError(result.error ?? 'Could not switch to acting.')
  }, [])

  const leaveActMode = useCallback(async () => {
    setModeBusy(true)
    setModeError(null)
    const result = await requestClientViewMode('view')
    setModeBusy(false)
    if (!result.ok) setModeError(result.error ?? 'Could not return to read-only.')
  }, [])

  // Entering or leaving Client view changes what the SERVER should render:
  // the shell layout reads the tahi-impersonate-org cookie to pin the client's
  // billing currency, and every studio-only page reads it to redirect the
  // preview the way it redirects a real client (lib/view-audience.ts). Setting
  // impersonation is a client-side state change, so the router cache would go
  // on serving segments rendered for the previous audience until a hard reload.
  // Refresh once per transition, never on mount (the first pass only records
  // where we started).
  const previewedOrgId = impersonation?.type === 'client' ? impersonation.orgId : null
  const lastPreviewedOrgId = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    if (lastPreviewedOrgId.current === undefined) {
      // Seed from the server's reading too, so a tab that is about to adopt the
      // cookie (below) does not count that as a transition and refresh a shell
      // the server already rendered for the previewed audience.
      lastPreviewedOrgId.current = previewedOrgId ?? serverPreviewOrgId ?? null
      return
    }
    if (lastPreviewedOrgId.current === previewedOrgId) return
    lastPreviewedOrgId.current = previewedOrgId
    router.refresh()
  }, [previewedOrgId, serverPreviewOrgId, router])

  // Cookie / sessionStorage reconciliation. The preview signal the SERVER reads
  // is a browser-wide cookie; this store is per-tab sessionStorage. A tab opened
  // fresh while Client view is on (bookmark, second window, restored session)
  // therefore carries the cookie without the store: the server redirects its
  // studio-only pages and pins the previewed client's currency, while this
  // banner, useImpersonation() and every client-side audience flag say "not
  // previewing" - a tab with no explanation and no way out. Adopt the server's
  // reading into this tab so the whole tab agrees and Exit preview is reachable.
  // Once per org id: exiting clears the store first, so the stale prop of the
  // render on its way out must not put the preview straight back.
  const adoptedOrgId = useRef<string | null>(null)
  useEffect(() => {
    if (!serverPreviewOrgId) return
    if (adoptedOrgId.current === serverPreviewOrgId) return
    adoptedOrgId.current = serverPreviewOrgId
    if (getSnapshot() !== null) return
    // The server's mode comes across with it, so a second tab shows the acting
    // strip rather than promising a read-only session that is not one.
    adoptServerPreview(
      serverPreviewOrgId,
      serverPreviewOrgName ?? 'this client',
      serverPreviewMode,
    )
  }, [serverPreviewOrgId, serverPreviewOrgName, serverPreviewMode])

  // The same reconciliation for the mode alone, for the tab that already has a
  // store: the mode can change in another tab, or be swept by the middleware
  // when a preview ends. Keyed on the live cookie rather than the prop, which
  // is one render behind and would fight the reload in requestClientViewMode.
  //
  // The mode lives in a cookie and the record lives in per-tab sessionStorage,
  // so nothing notifies this tab when another one arms or disarms: no storage
  // event fires for a cookie, and a client-side navigation does not remount
  // the layout banner. Keyed on `storedMode` alone, a tab that already had a
  // store would read the cookie once at mount and then paint the same strip
  // for the rest of its life. Painting the green read-only strip over a
  // browser that is armed is the worst thing this component can do, because
  // the strip IS the safeguard, so the tab re-reads whenever it comes back to
  // the front and whenever the route changes.
  const [modeTick, setModeTick] = useState(0)
  useEffect(() => {
    const recheck = () => setModeTick(t => t + 1)
    const onVisible = () => {
      if (document.visibilityState === 'visible') recheck()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', recheck)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', recheck)
    }
  }, [])

  const storedMode = impersonation?.type === 'client' ? (impersonation.mode ?? 'view') : null
  useEffect(() => {
    if (storedMode === null) return
    const live = readImpersonateModeCookie()
    if (live === storedMode) return
    setStoredMode(live)
  }, [storedMode, modeTick, pathname])

  // The same reconciliation, the other way. The preview can end somewhere this
  // tab's store never hears about: the ?exit-preview=1 escape hatch in the
  // middleware, GET /api/admin/impersonate/exit, another tab, a browser that
  // dropped a session cookie. The tab would then keep showing the strip and
  // reporting a preview through useImpersonation() while the server renders
  // the studio, which is the confusing half of the state this whole file
  // exists to keep honest.
  //
  // Keyed on document.cookie, not on the prop: the prop is one render behind,
  // so entering Client view (store written, cookie written, refresh pending)
  // would look exactly like this and undo itself.
  useEffect(() => {
    if (previewedOrgId === null) return
    if (readImpersonateOrgCookie() !== null) return
    clearImpersonation()
  }, [previewedOrgId])

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

  const acting = !isTeamMember && (impersonation.mode ?? 'view') === ACT_MODE_VALUE

  return (
    <>
      {/* Act mode gets its own tone. The strip's entire promise in read-only is
          "nothing you do here can happen"; once that stops being true it must
          not keep looking like the state where it was. */}
      <div className={acting ? 'imp-banner imp-acting' : 'imp-banner'}>
        <span className="imp-eye">
          {/* An eye for looking, a pencil for writing. */}
          <ShellIcon n={acting ? 'content' : 'impersonate'} s={15} />
        </span>
        {isTeamMember ? (
          <span>
            Viewing as <b>{displayName}</b>
            {impersonation.accessRules.length > 0 && (
              <> ({impersonation.accessRules[0].role.replace(/_/g, ' ')})</>
            )}.
          </span>
        ) : acting ? (
          <span>
            Acting as <ClientSwitcher currentOrgId={impersonation.orgId} label={displayName} color="#ffffff" /> (you).
            {' '}Everything you do here is recorded.
          </span>
        ) : (
          <span>
            Viewing <ClientSwitcher currentOrgId={impersonation.orgId} label={displayName} color="#ffffff" />. Read-only client view.
          </span>
        )}
        {modeError && <span className="imp-mode-error" role="status">{modeError}</span>}
        {!isTeamMember && isSuperAdmin && (
          acting ? (
            <button
              type="button"
              className="imp-mode"
              onClick={() => { void leaveActMode() }}
              disabled={modeBusy}
            >
              Back to read-only
            </button>
          ) : (
            <button
              type="button"
              className="imp-mode"
              onClick={() => { setModeError(null); setConfirmActOpen(true) }}
              disabled={modeBusy}
            >
              Act as client
            </button>
          )
        )}
        <button className="imp-exit" onClick={handleExit}>Exit preview</button>
      </div>
      <ConfirmDialog
        open={confirmActOpen}
        title="Act as this client?"
        description={`Requests, replies, approvals and queue changes you make from here land in ${displayName}'s workspace for real, attributed to you and written to the audit log. The studio is notified exactly as it is for a real client write, and no email goes to the client. Invoices and payments stay read-only.`}
        confirmLabel="Act as client"
        cancelLabel="Stay read-only"
        variant="warning"
        onConfirm={enterActMode}
        onCancel={() => setConfirmActOpen(false)}
      />
    </>
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
    // setImpersonation resets the mode to 'view' and drops the mode cookie, so
    // switching clients always lands read-only. Consent to act was given for
    // one client, not for whoever is next in this list.
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
        className="imp-switch"
        style={{ color }}
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
    /**
     * Act as client is on: portal writes from this tab land for real.
     *
     * The flag write affordances should read is `previewIsReadOnly` below;
     * this one is for the few places that need to say something different
     * rather than merely enable something.
     */
    actingAsClient: isClient && ((data as ClientImpersonationData).mode ?? 'view') === ACT_MODE_VALUE,
    /**
     * The one flag a portal write control should gate on: previewing AND not
     * acting. Spelled out here so a surface cannot accidentally keep gating on
     * `isImpersonatingClient` alone and stay dead in act mode.
     *
     * Money is the deliberate exception and does NOT use this: the invoice and
     * services surfaces stay read-only in both modes.
     */
    previewIsReadOnly:
      isClient && ((data as ClientImpersonationData).mode ?? 'view') !== ACT_MODE_VALUE,
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
