'use client'

import { useEffect, useState } from 'react'
import { apiPath } from '@/lib/api'
import type { QaTarget } from '@/lib/qa/types'

const REFRESH_BEFORE_MS = 10 * 60 * 1000
const MIN_REFRESH_MS = 30 * 1000

export type QaViewTokenError = 'not_configured' | 'failed' | null

export interface QaViewTokenState {
  baseUrl: string | null
  error: QaViewTokenError
  errorMessage: string | null
}

/**
 * Fetches a signed view token for one site and target and refreshes it ten
 * minutes before it expires. A 503 means the viewer is not configured yet.
 */
export function useViewToken(siteId: string, target: QaTarget): QaViewTokenState {
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [error, setError] = useState<QaViewTokenError>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    async function issue() {
      try {
        const res = await fetch(apiPath('/api/admin/qa/view-token'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ siteId, target }),
        })
        if (cancelled) return
        if (res.status === 503) {
          setBaseUrl(null)
          setError('not_configured')
          setErrorMessage(null)
          return
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: unknown } | null
          setBaseUrl(null)
          setError('failed')
          setErrorMessage(typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`)
          return
        }
        const json = (await res.json()) as { baseUrl: string; expiresAt: string }
        setBaseUrl(json.baseUrl)
        setError(null)
        setErrorMessage(null)
        const expires = Date.parse(json.expiresAt)
        const wait = Number.isFinite(expires)
          ? Math.max(MIN_REFRESH_MS, expires - Date.now() - REFRESH_BEFORE_MS)
          : MIN_REFRESH_MS
        timer = setTimeout(() => void issue(), wait)
      } catch (err) {
        if (cancelled) return
        setBaseUrl(null)
        setError('failed')
        setErrorMessage(err instanceof Error ? err.message : 'Could not reach the QA viewer.')
      }
    }

    void issue()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [siteId, target])

  return { baseUrl, error, errorMessage }
}
