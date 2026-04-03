'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, X } from 'lucide-react'

interface ImpersonationData {
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
    const parsed = JSON.parse(stored) as ImpersonationData
    cachedSnapshot = parsed.orgId ? parsed : null
    return cachedSnapshot
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

/** Set impersonation (call from client detail page) */
export function setImpersonation(data: ImpersonationData) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  notify()
}

/** Clear impersonation */
export function clearImpersonation() {
  sessionStorage.removeItem(STORAGE_KEY)
  notify()
}

/**
 * Banner shown when impersonating a client.
 * Uses useSyncExternalStore for immediate reactivity.
 */
export function ImpersonationBanner() {
  const router = useRouter()
  const impersonation = useSyncExternalStore(subscribe, getSnapshot, () => null)

  const handleExit = useCallback(() => {
    clearImpersonation()
    router.push('/clients')
  }, [router])

  if (!impersonation) return null

  const displayName = impersonation.contactName
    ? `${impersonation.contactName} at ${impersonation.orgName}`
    : impersonation.orgName

  return (
    <div
      className="flex items-center justify-center gap-3 flex-shrink-0"
      style={{
        padding: '0.5rem 1rem',
        background: 'var(--color-warning-bg)',
        borderBottom: '1px solid var(--color-warning)',
        color: 'var(--color-warning)',
      }}
    >
      <Eye className="w-4 h-4 flex-shrink-0" />
      <span className="text-sm font-medium">
        Viewing as <strong>{displayName}</strong>
      </span>
      <button
        onClick={handleExit}
        className="flex items-center gap-1 text-sm font-medium transition-colors"
        style={{
          padding: '0.25rem 0.75rem',
          borderRadius: '0.375rem',
          border: '1px solid var(--color-warning)',
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--color-warning)',
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

  return {
    isImpersonating: data !== null,
    impersonatedOrgId: data?.orgId ?? null,
    impersonatedOrgName: data?.orgName ?? null,
    impersonatedContactId: data?.contactId ?? null,
    impersonatedContactName: data?.contactName ?? null,
  }
}
