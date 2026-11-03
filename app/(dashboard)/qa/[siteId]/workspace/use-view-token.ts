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
  /** When the current token stops working (epoch ms), or null before one has arrived. */
  expiresAtMs: number | null
}

export type QaFreshViewUrl = { ok: true; baseUrl: string; expiresAtMs: number } | { ok: false; message: string }

/**
 * Asks for one new view token and returns its base URL, without touching the hook's state. Used
 * when a new tab must open and the cached token is about to expire. The message never contains
 * the token. Each call signs a new token; it is not retried.
 */
export async function fetchFreshViewBaseUrl(siteId: string, target: QaTarget): Promise<QaFreshViewUrl> {
  try {
    const res = await fetch(apiPath('/api/admin/qa/view-token'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteId, target }),
    })
    if (res.status === 503) return { ok: false, message: 'The QA viewer is not configured yet.' }
    if (!res.ok) return { ok: false, message: `Could not get a fresh view link (${res.status}).` }
    const json = (await res.json()) as { baseUrl?: unknown; expiresAt?: unknown }
    const expiresAtMs = typeof json.expiresAt === 'string' ? Date.parse(json.expiresAt) : Number.NaN
    if (typeof json.baseUrl !== 'string' || !Number.isFinite(expiresAtMs)) return { ok: false, message: 'The QA viewer sent an unreadable link.' }
    return { ok: true, baseUrl: json.baseUrl, expiresAtMs }
  } catch {
    return { ok: false, message: 'Could not reach the QA viewer.' }
  }
}

/**
 * Fetches a signed view token for one site and target and refreshes it ten
 * minutes before it expires. A 503 means the viewer is not configured yet.
 */
export function useViewToken(siteId: string, target: QaTarget): QaViewTokenState {
  const [baseUrl, setBaseUrl] = useState<string | null>(null)
  const [error, setError] = useState<QaViewTokenError>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [expiresAtMs, setExpiresAtMs] = useState<number | null>(null)

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
          setExpiresAtMs(null)
          setError('not_configured')
          setErrorMessage(null)
          return
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: unknown } | null
          setBaseUrl(null)
          setExpiresAtMs(null)
          setError('failed')
          setErrorMessage(typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`)
          return
        }
        const json = (await res.json()) as { baseUrl: string; expiresAt: string }
        const expires = Date.parse(json.expiresAt)
        setBaseUrl(json.baseUrl)
        setExpiresAtMs(Number.isFinite(expires) ? expires : null)
        setError(null)
        setErrorMessage(null)
        const wait = Number.isFinite(expires)
          ? Math.max(MIN_REFRESH_MS, expires - Date.now() - REFRESH_BEFORE_MS)
          : MIN_REFRESH_MS
        timer = setTimeout(() => void issue(), wait)
      } catch (err) {
        if (cancelled) return
        setBaseUrl(null)
        setExpiresAtMs(null)
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

  return { baseUrl, error, errorMessage, expiresAtMs }
}
