/**
 * lib/tasks-planner.ts
 *
 * My week: the day-by-day plate the third view renders. Pure and
 * node-testable; `now` is injected so the week's shape is deterministic.
 *
 * The week runs from today through Sunday, so it shrinks as the week does.
 * Sunday itself still gets one forward day rather than collapsing to nothing,
 * because a planner with only Today and Later is not a planner.
 *
 * Overdue is the one group you cannot drop into: you plan work forward, and
 * "make this late" is not a thing anyone means to do.
 */

import { taskDayKey, taskShiftedDayKey, type TaskRow } from '@/lib/tasks-views'

export interface PlannerGroup {
  /** 'overdue' | 'today' | 'd1'..'d6' | 'later' | 'none'. Stable, so React
   *  keys and drag targets do not churn. */
  key: string
  name: string
  /** The secondary line under the name. Empty for Overdue and No date. */
  date: string
  /** The YYYY-MM-DD a drop into this group writes. Null for No date, which
   *  clears the due date. Undefined only on the non-droppable Overdue group. */
  dueDate: string | null | undefined
  droppable: boolean
  tasks: TaskRow[]
  estimatedHours: number
}

const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

function dateAt(now: Date, offset: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
}

/** "9 Sep". Built by hand so it reads the same in every locale the studio
 *  works in, and so it never differs between server and client render. */
function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

function sumEstimate(rows: readonly TaskRow[]): number {
  let total = 0
  for (const r of rows) total += r.estimatedHours ?? 0
  return total
}

/** Hours in the studio's shorthand: quarter-hour granularity, no trailing
 *  zeros, always suffixed. */
export function formatHours(hours: number): string {
  if (!hours) return '0h'
  // A quarter-hour round can never leave a trailing zero of its own: 2 is
  // "2", not "2.0", so there is nothing left to strip.
  return `${Math.round(hours * 4) / 4}h`
}

/**
 * The groups the planner draws, in render order. Overdue is present only when
 * it has something in it; every other group is always present, empty or not,
 * because an empty day still has to accept a drop.
 */
export function buildWeekGroups(rows: readonly TaskRow[], now: Date): PlannerGroup[] {
  const today = taskDayKey(now)
  const todayDow = now.getDay()
  // Days left before Sunday closes the week. On Sunday itself we still offer
  // one forward day rather than nothing at all.
  const daysLeft = todayDow === 0 ? 1 : Math.max(1, 7 - todayDow)
  const lastDayKey = taskShiftedDayKey(now, daysLeft)

  const byDay = new Map<string, TaskRow[]>()
  const overdue: TaskRow[] = []
  const later: TaskRow[] = []
  const undated: TaskRow[] = []

  for (const row of rows) {
    const d = row.dueDate ? row.dueDate.slice(0, 10) : null
    if (d === null) { undated.push(row); continue }
    if (d < today) { overdue.push(row); continue }
    if (d > lastDayKey) { later.push(row); continue }
    const bucket = byDay.get(d)
    if (bucket) bucket.push(row)
    else byDay.set(d, [row])
  }

  const groups: PlannerGroup[] = []

  if (overdue.length > 0) {
    groups.push({
      key: 'overdue',
      name: 'Overdue',
      date: '',
      dueDate: undefined,
      droppable: false,
      tasks: overdue,
      estimatedHours: sumEstimate(overdue),
    })
  }

  for (let i = 0; i <= daysLeft; i += 1) {
    const d = dateAt(now, i)
    const key = i === 0 ? 'today' : `d${i}`
    const name = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_NAMES[d.getDay()]
    const dayKey = taskShiftedDayKey(now, i)
    const tasks = byDay.get(dayKey) ?? []
    groups.push({
      key,
      name,
      date: i === 0 ? `${DAY_NAMES[d.getDay()]} ${shortDate(d)}` : shortDate(d),
      dueDate: dayKey,
      droppable: true,
      tasks,
      estimatedHours: sumEstimate(tasks),
    })
  }

  groups.push({
    key: 'later',
    name: 'Later',
    date: 'after this week',
    // A drop into Later means "the day after the week ends", which is the
    // soonest date that is honestly still Later.
    dueDate: taskShiftedDayKey(now, daysLeft + 1),
    droppable: true,
    tasks: later,
    estimatedHours: sumEstimate(later),
  })

  groups.push({
    key: 'none',
    name: 'No date',
    date: '',
    dueDate: null,
    droppable: true,
    tasks: undated,
    estimatedHours: sumEstimate(undated),
  })

  return groups
}

export interface WeekSummary {
  overdue: number
  today: number
  /** Today through seven days out, inclusive. */
  week: number
  /** Summed estimate across the `week` set. */
  estimatedHours: number
}

/** The four numbers in the strip above the day cards. */
export function weekSummary(rows: readonly TaskRow[], now: Date): WeekSummary {
  const today = taskDayKey(now)
  const weekEnd = taskShiftedDayKey(now, 7)
  let overdue = 0
  let dueToday = 0
  let week = 0
  let estimatedHours = 0

  for (const row of rows) {
    const d = row.dueDate ? row.dueDate.slice(0, 10) : null
    if (d === null) continue
    if (d < today) { overdue += 1; continue }
    if (d === today) dueToday += 1
    if (d <= weekEnd) {
      week += 1
      estimatedHours += row.estimatedHours ?? 0
    }
  }

  return { overdue, today: dueToday, week, estimatedHours }
}

/** One cell of the week strip. */
export interface StripDay {
  /** Namespaced so it can never collide with a PlannerGroup key in the
   *  component's single drag-over state. */
  key: string
  dayKey: string
  /** 'M', 'T', 'W'... the header letter. Two of them repeat, which is what a
   *  calendar does. */
  letter: string
  dayOfMonth: number
  name: string
  /** 'Monday 8 Sep'. The aria-label and the title attribute. */
  label: string
  count: number
  estimatedHours: number
  isToday: boolean
  isPast: boolean
  /** You plan work forward. A day that has gone takes no drops, the same rule
   *  buildWeekGroups states for Overdue. */
  droppable: boolean
}

/** Monday of the week containing `now`, shifted by whole weeks. */
function weekStart(now: Date, weekOffset: number): Date {
  const dow = now.getDay()
  // getDay is 0 for Sunday, and the studio's week ends on Sunday, so Sunday
  // belongs to the week that started six days earlier, not the next one.
  const backToMonday = dow === 0 ? 6 : dow - 1
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - backToMonday + weekOffset * 7)
}

/**
 * The seven cells above the day cards.
 *
 * Three things buildWeekGroups cannot give the strip, which is why this is a
 * second pass over the same rows rather than a projection of the first:
 * the days already gone this week (that loop starts at offset 0), a per day
 * split of the flat Overdue bucket, and a weekday letter plus day number per
 * cell. The cross-check test asserts the two agree wherever they overlap.
 */
export function buildWeekStrip(
  rows: readonly TaskRow[],
  now: Date,
  weekOffset = 0,
): StripDay[] {
  const start = weekStart(now, weekOffset)
  const todayKey = taskDayKey(now)

  const byDay = new Map<string, TaskRow[]>()
  for (const row of rows) {
    const d = row.dueDate ? row.dueDate.slice(0, 10) : null
    if (d === null) continue
    const bucket = byDay.get(d)
    if (bucket) bucket.push(row)
    else byDay.set(d, [row])
  }

  const days: StripDay[] = []
  for (let i = 0; i < 7; i += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const dayKey = taskDayKey(date)
    const name = DAY_NAMES[date.getDay()]
    const tasks = byDay.get(dayKey) ?? []
    const isPast = dayKey < todayKey
    days.push({
      key: `strip:${dayKey}`,
      dayKey,
      letter: name.charAt(0),
      dayOfMonth: date.getDate(),
      name,
      label: `${name} ${shortDate(date)}`,
      count: tasks.length,
      estimatedHours: sumEstimate(tasks),
      isToday: dayKey === todayKey,
      isPast,
      droppable: !isPast,
    })
  }

  return days
}

/**
 * Relative load, 0 to 1, for the bar under a cell.
 *
 * Scaled to the busiest day in the strip, not to an invented eight hour day:
 * teamMembers.weeklyCapacityHours exists but is not on the wire, and a made
 * up ceiling would be a lie rendered as a bar. Hours when anything carries an
 * estimate, counts otherwise, so a week with no estimates still shows shape.
 */
export function stripLoad(day: StripDay, days: readonly StripDay[]): number {
  const maxHours = days.reduce((max, d) => Math.max(max, d.estimatedHours), 0)
  if (maxHours > 0) return day.estimatedHours / maxHours
  const maxCount = days.reduce((max, d) => Math.max(max, d.count), 0)
  if (maxCount > 0) return day.count / maxCount
  return 0
}

/** '7 to 13 Sep', or '28 Sep to 4 Oct' when the week crosses a month. */
export function stripRangeLabel(days: readonly StripDay[]): string {
  if (days.length === 0) return ''
  const first = days[0]
  const last = days[days.length - 1]
  const firstMonth = first.dayKey.slice(5, 7)
  const lastMonth = last.dayKey.slice(5, 7)
  const monthOf = (dayKey: string): string => MONTHS[Number(dayKey.slice(5, 7)) - 1]
  if (firstMonth === lastMonth) {
    return `${first.dayOfMonth} to ${last.dayOfMonth} ${monthOf(last.dayKey)}`
  }
  return `${first.dayOfMonth} ${monthOf(first.dayKey)} to ${last.dayOfMonth} ${monthOf(last.dayKey)}`
}
