'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, X } from 'lucide-react'

interface ImpersonationData {
  orgId: string
  orgName: string
}

/**
 * Reads impersonation state from sessionStorage and shows a banner.
 * Also provides the impersonated orgId to child components via context.
 *
 * This is a client-side-only preview feature. API calls still use
 * the admin's real auth. The purpose is to see what the client portal
 * looks like for a specific org.
 */
export function ImpersonationBanner() {
  const router = useRouter()
  const [impersonation, setImpersonation] = useState<ImpersonationData | null>(null)

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('tahi-impersonate')
      if (stored) {
        const parsed = JSON.parse(stored) as ImpersonationData
        if (parsed.orgId && parsed.orgName) {
          setImpersonation(parsed)
        }
      }
    } catch {
      // Invalid or missing data
    }
  }, [])

  const handleExit = useCallback(() => {
    sessionStorage.removeItem('tahi-impersonate')
    setImpersonation(null)
    router.push('/clients')
  }, [router])

  if (!impersonation) return null

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
        Viewing as <strong>{impersonation.orgName}</strong>
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
 * Returns { isImpersonating, impersonatedOrgId, impersonatedOrgName } or null values.
 */
export function useImpersonation(): {
  isImpersonating: boolean
  impersonatedOrgId: string | null
  impersonatedOrgName: string | null
} {
  const [data, setData] = useState<ImpersonationData | null>(null)

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem('tahi-impersonate')
      if (stored) {
        const parsed = JSON.parse(stored) as ImpersonationData
        if (parsed.orgId && parsed.orgName) {
          setData(parsed)
        }
      }
    } catch {
      // Invalid data
    }
  }, [])

  return {
    isImpersonating: data !== null,
    impersonatedOrgId: data?.orgId ?? null,
    impersonatedOrgName: data?.orgName ?? null,
  }
}
