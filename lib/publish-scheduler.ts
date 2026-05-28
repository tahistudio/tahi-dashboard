/**
 * lib/publish-scheduler.ts — Phase I · Slice 5.
 *
 * Pure scheduling logic for the blog publish pipeline. Three modes:
 *
 *   - 'now'    — publish immediately
 *   - 'custom' — caller-picked datetime, no snapping
 *   - 'auto'   — derive the next Mon/Wed/Fri 09:00 UK slot that respects
 *                the "max 3 posts / rolling 7 days" cap. Starts the
 *                search 2 days after the most recent scheduled slot
 *                (or now if no slots).
 *
 * Cooldown is ALWAYS evaluated regardless of mode: if a post on the
 * same cluster was published in the last 14 days, the conflicting
 * titles surface in the output. The UI surfaces them as a warning,
 * the caller can publish anyway — never blocking.
 *
 * Pure functions only. No DB, no fetch, no IO. Tested deterministically.
 */

export type PublishMode = 'now' | 'custom' | 'auto'

export interface RecentClusterEntry {
  cluster: string
  publishedAt: string  // ISO
  title?: string
}

export interface ComputeSlotInput {
  mode: PublishMode
  // ISO datetime, required when mode === 'custom'. Anything else is ignored.
  customDate?: string
  // Existing scheduled / published slots — ISO datetimes. Used by 'auto'
  // to enforce the rolling 7-day cap and to find "the last slot we
  // chose" as the starting anchor for the next pick.
  recentSlots: string[]
  // The cluster slug for the post being scheduled. Drives cooldown
  // detection. Pass empty string to skip cooldown evaluation.
  newCluster: string
  // Posts published in the recent past, with their cluster.
  recentClusters: RecentClusterEntry[]
  // Override the "current time" — defaults to Date.now(). Test-only.
  nowMs?: number
}

export interface ComputeSlotOutput {
  scheduledFor: string  // ISO datetime
  reason: string
  cooldownConflicts?: Array<{ title?: string; publishedAt: string }>
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const COOLDOWN_DAYS = 14
const WEEKLY_CAP = 3
const ROLLING_WINDOW_DAYS = 7

// Publish days: 1=Mon, 3=Wed, 5=Fri (UTC numbering). 09:00 UK in
// summer (BST, +01) = 08:00 UTC; in winter (GMT, +00) = 09:00 UTC.
// We anchor to BRITISH wall-clock 09:00, then convert. See ukNineAm().
const PUBLISH_DOW = [1, 3, 5] as const // Mon/Wed/Fri

/**
 * Returns true when the given UTC date falls inside British Summer Time.
 * BST: last Sunday of March 01:00 UTC -> last Sunday of October 01:00 UTC.
 * Cheap manual computation — avoids pulling in tz libs which don't bundle
 * cleanly for Cloudflare Workers.
 */
function isBst(date: Date): boolean {
  const year = date.getUTCFullYear()
  // Last Sunday of March
  const marchEnd = new Date(Date.UTC(year, 2, 31, 1, 0, 0))
  const marchStart = new Date(Date.UTC(year, 2, 31 - marchEnd.getUTCDay(), 1, 0, 0))
  // Last Sunday of October
  const octEnd = new Date(Date.UTC(year, 9, 31, 1, 0, 0))
  const octStart = new Date(Date.UTC(year, 9, 31 - octEnd.getUTCDay(), 1, 0, 0))
  return date >= marchStart && date < octStart
}

/**
 * Build a Date pinned to UK wall-clock 09:00 on the given UTC year/month/day.
 * Returns a UTC Date. So during BST -> 08:00 UTC. During GMT -> 09:00 UTC.
 */
function ukNineAm(year: number, monthIndex: number, day: number): Date {
  // Pin at 09:00 GMT first
  const provisional = new Date(Date.UTC(year, monthIndex, day, 9, 0, 0))
  // If that date is in BST, the wall-clock is actually 10:00 — back up 1h.
  return isBst(provisional) ? new Date(provisional.getTime() - 3_600_000) : provisional
}

/**
 * Snap forward to the next Mon/Wed/Fri @ 09:00 UK strictly AFTER the
 * given anchor instant. Anchors that already sit at a publish slot snap
 * to the *next* one.
 */
function nextPublishSlotAfter(anchorMs: number): Date {
  // Walk day-by-day for up to 14 iterations (safe upper bound — there
  // is always a Mon/Wed/Fri within any 5-day window).
  const anchor = new Date(anchorMs)
  let probe = new Date(Date.UTC(
    anchor.getUTCFullYear(),
    anchor.getUTCMonth(),
    anchor.getUTCDate(),
    0, 0, 0,
  ))
  for (let i = 0; i < 14; i++) {
    const candidate = ukNineAm(
      probe.getUTCFullYear(),
      probe.getUTCMonth(),
      probe.getUTCDate(),
    )
    if (candidate.getTime() > anchorMs && PUBLISH_DOW.includes(probe.getUTCDay() as 1 | 3 | 5)) {
      return candidate
    }
    probe = new Date(probe.getTime() + ONE_DAY_MS)
  }
  // Should be unreachable — fall back to anchor + 2 days.
  return new Date(anchorMs + 2 * ONE_DAY_MS)
}

/**
 * Count how many of the given ISO timestamps fall within the 7-day
 * window ENDING at the candidate slot. Used to enforce the 3/week cap.
 */
function countInRollingWindow(candidateMs: number, recentSlots: string[]): number {
  const windowStart = candidateMs - ROLLING_WINDOW_DAYS * ONE_DAY_MS
  let count = 0
  for (const iso of recentSlots) {
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) continue
    if (t > windowStart && t <= candidateMs) count++
  }
  return count
}

function detectCooldown(
  newCluster: string,
  recentClusters: RecentClusterEntry[],
  candidateMs: number,
): Array<{ title?: string; publishedAt: string }> {
  if (!newCluster) return []
  const cutoff = candidateMs - COOLDOWN_DAYS * ONE_DAY_MS
  const target = newCluster.toLowerCase()
  const conflicts: Array<{ title?: string; publishedAt: string }> = []
  for (const r of recentClusters) {
    if (!r.cluster || r.cluster.toLowerCase() !== target) continue
    const t = Date.parse(r.publishedAt)
    if (!Number.isFinite(t)) continue
    // Only conflicts within the last 14 days *before* the candidate.
    if (t > cutoff && t <= candidateMs) {
      conflicts.push({ title: r.title, publishedAt: r.publishedAt })
    }
  }
  return conflicts
}

export function computeNextSlot(input: ComputeSlotInput): ComputeSlotOutput {
  const now = input.nowMs ?? Date.now()
  const cooldownConflicts = (slotMs: number) => {
    const c = detectCooldown(input.newCluster, input.recentClusters, slotMs)
    return c.length > 0 ? c : undefined
  }

  if (input.mode === 'now') {
    const slot = new Date(now).toISOString()
    return {
      scheduledFor: slot,
      reason: 'Publish immediately',
      cooldownConflicts: cooldownConflicts(now),
    }
  }

  if (input.mode === 'custom') {
    if (!input.customDate) {
      throw new Error("computeNextSlot: customDate is required when mode='custom'")
    }
    const parsedMs = Date.parse(input.customDate)
    if (!Number.isFinite(parsedMs)) {
      throw new Error(`computeNextSlot: customDate is not a valid ISO datetime: ${input.customDate}`)
    }
    return {
      scheduledFor: new Date(parsedMs).toISOString(),
      reason: 'Custom datetime (no snapping)',
      cooldownConflicts: cooldownConflicts(parsedMs),
    }
  }

  // mode === 'auto'
  // Anchor: most recent recentSlot OR now. Add 2 days, then snap to
  // next Mon/Wed/Fri 09:00 UK. Walk forward day-by-day until the
  // rolling-7-day cap allows it.
  const sortedSlots = input.recentSlots
    .map(s => Date.parse(s))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  const anchorMs = sortedSlots.length > 0
    ? Math.max(sortedSlots[sortedSlots.length - 1], now)
    : now

  // 2-day breathing room after the anchor
  const breathingRoom = anchorMs + 2 * ONE_DAY_MS

  let candidate = nextPublishSlotAfter(breathingRoom - 1)  // -1 so equality counts
  // Cap iterations so a misconfigured input can't infinite-loop.
  for (let i = 0; i < 30; i++) {
    const inWindow = countInRollingWindow(candidate.getTime(), input.recentSlots)
    if (inWindow < WEEKLY_CAP) {
      return {
        scheduledFor: candidate.toISOString(),
        reason: sortedSlots.length === 0
          ? 'Auto: first slot, next Mon/Wed/Fri at 09:00 UK'
          : 'Auto: 2 days after last slot, snapped to next Mon/Wed/Fri at 09:00 UK',
        cooldownConflicts: cooldownConflicts(candidate.getTime()),
      }
    }
    candidate = nextPublishSlotAfter(candidate.getTime())
  }

  // Fallback — give up the cap and return the latest candidate anyway.
  return {
    scheduledFor: candidate.toISOString(),
    reason: 'Auto: weekly cap exhausted in search window; using latest candidate',
    cooldownConflicts: cooldownConflicts(candidate.getTime()),
  }
}
