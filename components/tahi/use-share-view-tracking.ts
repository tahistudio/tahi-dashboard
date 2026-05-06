/**
 * useShareViewTracking — instruments a public-share viewer page with
 * the analytics lifecycle:
 *
 *  1. On mount: read or generate a stable browser sessionId in
 *     localStorage, then POST /api/public/views to create a new event.
 *  2. Heartbeat every 30s while the tab is visible (updates endedAt +
 *     durationMs server-side).
 *  3. On `visibilitychange` to hidden, fire one final heartbeat via
 *     navigator.sendBeacon (fire-and-forget, fastest path).
 *  4. On `pagehide` / `beforeunload`, same — sendBeacon for reliability
 *     even when the tab is closing.
 *
 * `pagesViewed` is appended to (server merges into a deduped set) so
 * proposal slide deck pages can be tracked individually later. Pass
 * undefined for single-page resources.
 *
 * No-ops gracefully when token / resource is missing or when
 * window/localStorage aren't available.
 */
import { useEffect, useRef } from 'react'
import { apiPath } from '@/lib/api'

const SESSION_KEY = 'tahi-share-session'
const HEARTBEAT_MS = 30_000

function getOrCreateSessionId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const existing = window.localStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const fresh = crypto.randomUUID()
    window.localStorage.setItem(SESSION_KEY, fresh)
    return fresh
  } catch {
    // localStorage blocked (private mode, cookie blockers). Generate a
    // per-session ID that lives in memory only — still gives us per-load
    // tracking even if unique-visitor count is overestimated.
    return crypto.randomUUID()
  }
}

interface Options {
  resourceType: 'schedule' | 'proposal' | 'contract'
  resourceId: string | null | undefined
  shareToken: string | null | undefined
  /** Optional list of currently-visible page/slide IDs (for slide decks). */
  initialPagesViewed?: string[]
}

export function useShareViewTracking({
  resourceType,
  resourceId,
  shareToken,
  initialPagesViewed,
}: Options): {
  /** Append additional pages to the tracked set (e.g. on slide change). */
  trackPages: (ids: string[]) => void
} {
  // Stable refs so the effect doesn't churn — only resourceId / token changes
  // should trigger a reset.
  const viewIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const pendingPagesRef = useRef<Set<string>>(new Set(initialPagesViewed ?? []))
  const startedRef = useRef<boolean>(false)

  useEffect(() => {
    if (!resourceId || !shareToken || typeof window === 'undefined') return

    const sessionId = getOrCreateSessionId()
    if (!sessionId) return
    sessionIdRef.current = sessionId

    let cancelled = false
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null

    async function start() {
      try {
        const initial = Array.from(pendingPagesRef.current)
        const res = await fetch(apiPath('/api/public/views'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceType,
            resourceId,
            shareToken,
            sessionId,
            pagesViewed: initial,
          }),
        })
        if (!res.ok || cancelled) return
        const data = await res.json() as { viewId?: string }
        if (cancelled || !data.viewId) return
        viewIdRef.current = data.viewId
        startedRef.current = true
        // Clear the pending set — they're now persisted server-side.
        pendingPagesRef.current = new Set()
      } catch {
        // Silent — analytics never blocks the viewer.
      }
    }

    function heartbeat(): void {
      const viewId = viewIdRef.current
      const sid = sessionIdRef.current
      if (!viewId || !sid) return
      const additional = Array.from(pendingPagesRef.current)
      const body = JSON.stringify({ sessionId: sid, pagesViewed: additional })
      try {
        // fetch + keepalive is the modern equivalent of sendBeacon: the
        // request continues even if the page is unloading. Unlike
        // sendBeacon it sets Content-Type: application/json cleanly, which
        // matters because the server parses with req.json(). sendBeacon's
        // Blob-based content-type behaviour caused beacons to silently
        // 400 in our earlier QA — keepalive is more reliable end-to-end.
        const url = apiPath(`/api/public/views/${viewId}`)
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {})
        // Whatever pages we just sent are persisted server-side; clear local.
        pendingPagesRef.current = new Set()
      } catch {
        // Silent.
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') heartbeat()
    }

    void start()
    heartbeatTimer = setInterval(heartbeat, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', heartbeat)
    window.addEventListener('beforeunload', heartbeat)

    return () => {
      cancelled = true
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', heartbeat)
      window.removeEventListener('beforeunload', heartbeat)
      // Final flush on unmount (e.g. SPA navigation).
      heartbeat()
    }
  }, [resourceType, resourceId, shareToken])

  function trackPages(ids: string[]) {
    for (const id of ids) pendingPagesRef.current.add(id)
  }

  return { trackPages }
}
