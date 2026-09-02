/**
 * lib/timeline-domain.ts
 *
 * Pure maths behind the requests timeline (and the board's timeline
 * sub-view). Everything here is a plain function over numbers so the
 * component stays presentational and the awkward parts (domain padding,
 * week ticks, the overdue rule) are unit tested.
 *
 * The domain runs from the earliest start minus 14 days to the latest due
 * plus 21 days, and always contains today so the "Today" hairline has
 * somewhere to land. Scroll extension buffers widen it further as the
 * user reaches either edge, which is what makes the chart feel endless
 * without rendering the whole calendar up front.
 */

export const DAY_MS = 86_400_000
export const WEEK_MS = 7 * DAY_MS

/** Padding before the earliest plotted date. */
export const TIMELINE_LEAD_DAYS = 14
/** Padding after the latest plotted date. */
export const TIMELINE_TRAIL_DAYS = 21
/** How much further the domain grows each time the user hits an edge. */
export const TIMELINE_EDGE_EXTENSION_DAYS = 180
/** How wide one day draws before the chart starts scrolling. */
export const TIMELINE_PX_PER_DAY = 26
/** Floor so a one-week dataset still fills the card. */
export const TIMELINE_MIN_CHART_WIDTH = 640
/** Default sticky label column width, in px. The stylesheet owns the real
 *  value through a custom property; this is the fallback the scroll maths
 *  uses before the browser has computed it. */
export const TIMELINE_LABEL_WIDTH_PX = 260

const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

const MONTH_INDEX: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

/** Statuses that end a request's life. A finished request is never late,
 *  however far past its due date it sits. */
export const TERMINAL_STATUSES: readonly string[] = ['delivered', 'cancelled', 'archived']

const DONE_PATTERN = /done|complete|deliver|ship/i

/** One plotted item reduced to the two numbers the domain cares about.
 *  `startTs` is null for a milestone, which draws as a diamond on its
 *  due date rather than a bar across a range. */
export interface TimelineRange {
  startTs: number | null
  endTs: number
}

export interface TimelineDomain {
  /** Left edge of the chart, in epoch ms. */
  start: number
  /** Right edge of the chart, in epoch ms. */
  end: number
  /** end minus start, never zero. */
  span: number
}

export interface TimelineTick {
  ts: number
  /** Position along the chart, 0 at the left edge and 1 at the right. */
  ratio: number
  label: string
}

/**
 * Turn a stored date into a timestamp. ISO is the shape the APIs send;
 * the short "May 23" and "today" forms exist for demo and prototype data.
 * The short form is tried first because `Date.parse('May 23')` quietly
 * resolves to the year 2001 rather than failing.
 */
export function parseTimelineDate(value?: string | null, now: number = Date.now()): number | null {
  if (!value) return null
  const raw = value.trim()
  if (!raw) return null

  if (/^today$/i.test(raw)) return now

  const short = /^([a-z]+)\s+(\d{1,2})$/i.exec(raw)
  if (short) {
    const month = MONTH_INDEX[short[1].slice(0, 3).toLowerCase()]
    if (month !== undefined) {
      const day = Number.parseInt(short[2], 10)
      return new Date(new Date(now).getFullYear(), month, day).getTime()
    }
  }

  const iso = Date.parse(raw)
  return Number.isNaN(iso) ? null : iso
}

/**
 * The plotted window. Today is folded into the extent before padding, so
 * a board whose work all sits in the past or all in the future still
 * shows where the present is.
 */
export function computeTimelineDomain(
  ranges: ReadonlyArray<TimelineRange>,
  options: { now: number; pastExtensionDays?: number; futureExtensionDays?: number },
): TimelineDomain {
  const { now, pastExtensionDays = 0, futureExtensionDays = 0 } = options

  let lo = now
  let hi = now
  for (const r of ranges) {
    const from = r.startTs ?? r.endTs
    if (from < lo) lo = from
    if (from > hi) hi = from
    if (r.endTs < lo) lo = r.endTs
    if (r.endTs > hi) hi = r.endTs
  }

  const start = lo - (TIMELINE_LEAD_DAYS + pastExtensionDays) * DAY_MS
  const end = hi + (TIMELINE_TRAIL_DAYS + futureExtensionDays) * DAY_MS
  return { start, end, span: Math.max(DAY_MS, end - start) }
}

/** Chart width in px. Anything past the container scrolls sideways. */
export function timelineChartWidth(
  domain: TimelineDomain,
  options?: { pxPerDay?: number; minWidth?: number },
): number {
  const pxPerDay = options?.pxPerDay ?? TIMELINE_PX_PER_DAY
  const minWidth = options?.minWidth ?? TIMELINE_MIN_CHART_WIDTH
  return Math.max(minWidth, Math.round((domain.span / DAY_MS) * pxPerDay))
}

/** Where a timestamp sits along the chart. 0 is the left edge, 1 the right.
 *  Not clamped: a caller that plots outside the domain wants to know. */
export function ratioOf(ts: number, domain: TimelineDomain): number {
  return (ts - domain.start) / domain.span
}

export function todayRatio(domain: TimelineDomain, now: number): number {
  return ratioOf(now, domain)
}

/** One tick per week, aligned so a tick always lands exactly on today. */
export function weekTicks(domain: TimelineDomain, now: number): TimelineTick[] {
  const first = Math.ceil((domain.start - now) / WEEK_MS)
  const last = Math.floor((domain.end - now) / WEEK_MS)
  const out: TimelineTick[] = []
  for (let k = first; k <= last; k++) {
    const ts = now + k * WEEK_MS
    out.push({ ts, ratio: ratioOf(ts, domain), label: formatTimelineTick(ts) })
  }
  return out
}

/** Axis label: day then short month, e.g. "5 Sep". Built by hand rather
 *  than through toLocaleDateString so it reads the same everywhere. */
export function formatTimelineTick(ts: number): string {
  const d = new Date(ts)
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`
}

/** Long form for tooltips, e.g. "5 Sep 2026". */
export function formatTimelineDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * Which column statuses count as finished. Columns whose value or label
 * reads as done, complete, delivered or shipped qualify; when a board
 * names none of those, its last column is the finish line. The terminal
 * request statuses are always included so a cancelled or archived request
 * never turns red.
 */
export function doneStatusValues(
  columns: ReadonlyArray<{ statusValue: string; label: string }>,
): Set<string> {
  const explicit = columns
    .filter(c => DONE_PATTERN.test(c.statusValue) || DONE_PATTERN.test(c.label))
    .map(c => c.statusValue)
  const base = explicit.length > 0
    ? explicit
    : columns.length > 0 ? [columns[columns.length - 1].statusValue] : []
  return new Set([...base, ...TERMINAL_STATUSES])
}

/** Past its due date and still open. */
export function isTimelineOverdue(args: {
  status: string
  endTs: number
  now: number
  doneStatuses: ReadonlySet<string>
}): boolean {
  if (args.doneStatuses.has(args.status)) return false
  return args.endTs < args.now
}
