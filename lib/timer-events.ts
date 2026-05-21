/**
 * Tiny client-side event bus for cross-component timer sync.
 *
 * Why this exists: the nav TimerChip and the per-request TimeCard / Request
 * timer control all poll /api/admin/timers every 30s. When the user stops
 * the timer in one of them, the others would otherwise keep ticking until
 * their next poll completed — looked broken on the request page when you
 * stopped from the nav.
 *
 * Now: every component that mutates timer state calls `notifyTimerChanged()`
 * after a successful POST/PATCH/DELETE. Every component that displays timer
 * state subscribes via `subscribeToTimerChanges(cb)` in a useEffect and
 * re-fetches when it fires. SSR-safe (no-ops on the server).
 */

const EVENT_NAME = 'tahi:timer-changed'

export function notifyTimerChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function subscribeToTimerChanges(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}
