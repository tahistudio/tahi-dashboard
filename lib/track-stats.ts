/**
 * lib/track-stats.ts — pure stats for the client track mini-kanban.
 *
 * Computes the per-track "what you're paying for" header numbers from the
 * recently-delivered requests: how many delivered in the window, and the average
 * turnaround (deliveredAt - createdAt) in days. Pure + unit-tested.
 */

export interface DeliveredItem {
  deliveredAt?: string | null
  createdAt?: string | null
}

export interface DeliveredStats {
  /** Count delivered within the window. */
  count: number
  /** Average turnaround in whole days over items with both dates, or null. */
  avgTurnaroundDays: number | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Items delivered within the last `windowDays` of `nowISO`. */
export function deliveredInWindow<T extends DeliveredItem>(
  items: ReadonlyArray<T>,
  nowISO: string,
  windowDays = 30,
): T[] {
  const now = new Date(nowISO).getTime()
  if (!Number.isFinite(now)) return []
  const cutoff = now - windowDays * DAY_MS
  return items.filter(i => {
    if (!i.deliveredAt) return false
    const d = new Date(i.deliveredAt).getTime()
    return Number.isFinite(d) && d >= cutoff && d <= now
  })
}

export function trackDeliveredStats(
  items: ReadonlyArray<DeliveredItem>,
  nowISO: string,
  windowDays = 30,
): DeliveredStats {
  const win = deliveredInWindow(items, nowISO, windowDays)
  const turnarounds: number[] = []
  for (const i of win) {
    if (!i.createdAt || !i.deliveredAt) continue
    const created = new Date(i.createdAt).getTime()
    const delivered = new Date(i.deliveredAt).getTime()
    if (Number.isFinite(created) && Number.isFinite(delivered) && delivered >= created) {
      turnarounds.push((delivered - created) / DAY_MS)
    }
  }
  const avg = turnarounds.length
    ? Math.max(1, Math.round(turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length))
    : null
  return { count: win.length, avgTurnaroundDays: avg }
}
