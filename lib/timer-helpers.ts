/**
 * Helpers for the live time tracker.
 * Pure functions, no DB, no I/O — safe to unit-test in isolation.
 */

/**
 * Compute elapsed seconds on an active-timer row, accounting for pauses.
 *
 *   active  : elapsed = now - startedAt - pausedSeconds
 *   paused  : elapsed = pausedAt - startedAt - pausedSeconds
 */
export function elapsedSeconds(timer: {
  startedAt: string
  pausedAt: string | null
  pausedSeconds: number
}, now: Date = new Date()): number {
  const start = new Date(timer.startedAt).getTime()
  const end = timer.pausedAt ? new Date(timer.pausedAt).getTime() : now.getTime()
  const elapsedMs = end - start - (timer.pausedSeconds ?? 0) * 1000
  return Math.max(0, Math.floor(elapsedMs / 1000))
}

/** Convert elapsed seconds to decimal hours (e.g. 3734s → 1.04h). */
export function secondsToHours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100
}

/** Format seconds as HH:MM:SS (for live display). */
export function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/**
 * Was the last heartbeat long enough ago that we should prompt the user
 * on app reload? Default threshold is 2 minutes, configurable for tests.
 */
export function isStaleTimer(lastPingAt: string, thresholdMs = 2 * 60 * 1000, now: Date = new Date()): boolean {
  const last = new Date(lastPingAt).getTime()
  return now.getTime() - last > thresholdMs
}
