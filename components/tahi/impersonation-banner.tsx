'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, X, UserCog } from 'lucide-react'

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
  notify()
}

/** Clear impersonation */
export function clearImpersonation() {
  sessionStorage.removeItem(STORAGE_KEY)
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
  let bannerIcon: React.ReactNode
  let bannerBg: string
  let bannerBorder: string
  let bannerColor: string

  if (isTeamMember) {
    displayName = impersonation.teamMemberName
    bannerIcon = <UserCog className="w-4 h-4 flex-shrink-0" />
    bannerBg = 'var(--color-info-bg)'
    bannerBorder = 'var(--color-info)'
    bannerColor = 'var(--color-info)'
  } else {
    displayName = impersonation.contactName
      ? `${impersonation.contactName} at ${impersonation.orgName}`
      : impersonation.orgName
    bannerIcon = <Eye className="w-4 h-4 flex-shrink-0" />
    bannerBg = 'var(--color-warning-bg)'
    bannerBorder = 'var(--color-warning)'
    bannerColor = 'var(--color-warning)'
  }

  return (
    <div
      className="flex items-center justify-center gap-3 flex-shrink-0"
      style={{
        padding: '0.5rem 1rem',
        background: bannerBg,
        borderBottom: `1px solid ${bannerBorder}`,
        color: bannerColor,
      }}
    >
      {bannerIcon}
      <span className="text-sm font-medium">
        Viewing as {isTeamMember ? 'team member' : ''} <strong>{displayName}</strong>
        {isTeamMember && impersonation.accessRules.length > 0 && (
          <span className="font-normal opacity-75">
            {' '}({impersonation.accessRules[0].role.replace(/_/g, ' ')})
          </span>
        )}
      </span>
      <button
        onClick={handleExit}
        className="flex items-center gap-1 text-sm font-medium transition-colors"
        style={{
          padding: '0.25rem 0.75rem',
          borderRadius: '0.375rem',
          border: `1px solid ${bannerBorder}`,
          background: 'transparent',
          cursor: 'pointer',
          color: bannerColor,
        }}
      >
        <X className="w-3.5 h-3.5" />
        Exit
      </button>
    </div>
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
