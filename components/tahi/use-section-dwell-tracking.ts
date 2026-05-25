/**
 * useSectionDwellTracking — instruments a public deliverable viewer with
 * per-section dwell tracking via IntersectionObserver.
 *
 * Pairs with useShareViewTracking: that one tracks the SESSION; this one
 * tracks each SECTION's visibility within the session. Batches enter/exit
 * pairs into POSTs to /api/public/section-views (capped at 50 per batch).
 *
 * Usage:
 *
 *   const observe = useSectionDwellTracking({
 *     resourceType: 'schedule',
 *     resourceId: schedule.id,
 *     shareToken: token,
 *   })
 *   // For each rendered section:
 *   <section ref={el => observe(el, 'cover')}>...</section>
 *   <section ref={el => observe(el, sectionRow.id)}>...</section>
 *
 * Behaviours baked in:
 *   - IntersectionObserver threshold 0.4 (40% of section visible → enter)
 *   - Closes any open enter timestamp when the section leaves view OR the
 *     tab is hidden, then queues a {sectionId, enteredAt, exitedAt, dwellMs} record
 *   - Flushes every 15s while open, again on visibilitychange→hidden and
 *     on unmount, via fetch keepalive (so the final batch survives a tab close)
 *   - Caps each batch at 50 records — older entries flush first
 *   - No-ops gracefully if window/IntersectionObserver missing
 *
 * Why dwellMs is computed client-side: avoids a round-trip per event AND
 * keeps the analytics readable without an exit timestamp (some browsers
 * don't fire visibility events reliably).
 */

import { useEffect, useRef } from 'react'
import { apiPath } from '@/lib/api'

const FLUSH_INTERVAL_MS = 15_000
const MAX_BATCH = 50
const VISIBLE_THRESHOLD = 0.4
const SESSION_KEY = 'tahi-share-session'

interface QueuedEvent {
  sectionId: string
  enteredAt: string
  exitedAt: string
  dwellMs: number
}

interface Options {
  resourceType: 'schedule' | 'proposal' | 'contract'
  resourceId: string | null | undefined
  shareToken: string | null | undefined
}

function readSessionId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export function useSectionDwellTracking({
  resourceType,
  resourceId,
  shareToken,
}: Options): (el: Element | null, sectionId: string) => void {
  const observerRef = useRef<IntersectionObserver | null>(null)
  const observedRef = useRef<Map<Element, string>>(new Map())
  const enteredAtRef = useRef<Map<string, number>>(new Map())
  const queueRef = useRef<QueuedEvent[]>([])

  // Flush queued events to the server. Idempotent — clears queue on success.
  useEffect(() => {
    if (!resourceId || !shareToken || typeof window === 'undefined') return

    function flush(): void {
      if (queueRef.current.length === 0) return
      const sessionId = readSessionId()
      if (!sessionId) return
      const batch = queueRef.current.splice(0, MAX_BATCH)
      try {
        fetch(apiPath('/api/public/section-views'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resourceType,
            resourceId,
            shareToken,
            sessionId,
            events: batch,
          }),
          keepalive: true,
        }).catch(() => {})
      } catch {
        // Silent.
      }
    }

    // Close any still-open enters as if the section just exited — gives
    // every flush a complete picture even if the user idles or unloads.
    function closeOpen(): void {
      const now = Date.now()
      for (const [sectionId, enteredAt] of enteredAtRef.current) {
        const enteredAtMs = enteredAt
        const dwellMs = Math.max(0, now - enteredAtMs)
        if (dwellMs >= 200) {
          queueRef.current.push({
            sectionId,
            enteredAt: new Date(enteredAtMs).toISOString(),
            exitedAt: new Date(now).toISOString(),
            dwellMs,
          })
        }
        // Re-arm the timer so dwell keeps accumulating after a flush.
        enteredAtRef.current.set(sectionId, now)
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        closeOpen()
        flush()
      }
    }

    function periodic() {
      closeOpen()
      flush()
    }

    const timer = setInterval(periodic, FLUSH_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', periodic)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', periodic)
      // Final flush on unmount.
      closeOpen()
      flush()
    }
  }, [resourceType, resourceId, shareToken])

  // IntersectionObserver — create once, observe each registered section.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      const now = Date.now()
      for (const entry of entries) {
        const sectionId = observedRef.current.get(entry.target)
        if (!sectionId) continue
        const isVisible = entry.isIntersecting && entry.intersectionRatio >= VISIBLE_THRESHOLD
        const wasOpen = enteredAtRef.current.has(sectionId)
        if (isVisible && !wasOpen) {
          enteredAtRef.current.set(sectionId, now)
        } else if (!isVisible && wasOpen) {
          const enteredAtMs = enteredAtRef.current.get(sectionId)!
          enteredAtRef.current.delete(sectionId)
          const dwellMs = Math.max(0, now - enteredAtMs)
          if (dwellMs >= 200) {
            queueRef.current.push({
              sectionId,
              enteredAt: new Date(enteredAtMs).toISOString(),
              exitedAt: new Date(now).toISOString(),
              dwellMs,
            })
          }
        }
      }
    }, { threshold: [0, VISIBLE_THRESHOLD, 1] })
    observerRef.current = observer
    // Observe anything that was registered before the observer existed.
    for (const el of observedRef.current.keys()) {
      observer.observe(el)
    }
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [])

  // Ref callback. Stable identity per (el, sectionId) by storing the
  // element → sectionId map at the time of attach. Re-observing the same
  // element with a new sectionId is rare (sections don't usually re-key)
  // so we don't try to detach + reattach on every render.
  return function observe(el: Element | null, sectionId: string) {
    if (!el) return
    if (observedRef.current.get(el) === sectionId) return
    observedRef.current.set(el, sectionId)
    if (observerRef.current) observerRef.current.observe(el)
  }
}
