'use client'

/**
 * <TasksWeek>. My week: your own open plate, laid out day by day, with drag
 * to plan.
 *
 * This view deliberately IGNORES the rail. Whatever saved view, filters or
 * search are set, it always shows the tasks assigned to you that are not
 * done. It is the answer to "what am I doing this week", and a filter would
 * only ever make that answer wrong.
 *
 * All the grouping maths is lib/tasks-planner.ts, so the shape of the week is
 * tested without a DOM. That now includes the seven cell strip inside the
 * summary plate, which is a second pass over the same rows: it shows the days
 * already gone, splits the flat Overdue bucket back out per day, and pages a
 * whole week at a time so a specific day next week is a drop target rather
 * than the one flattened Later date.
 */

import * as React from 'react'
import { ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Eye, GripVertical, Zap } from 'lucide-react'
import { EmptyState } from '@/components/tahi/empty-state'
import { Badge, priorityTone } from '@/components/tahi/badge'
import { Avatar } from '@/components/tahi/avatar'
import {
  buildWeekGroups,
  buildWeekStrip,
  formatHours,
  stripLoad,
  stripRangeLabel,
  weekSummary,
  type PlannerGroup,
  type StripDay,
} from '@/lib/tasks-planner'
import { taskPriorityLabel } from '@/lib/task-priorities'
import { isTaskBlocked, levelOf, taskDayKey, taskShiftedDayKey, type TaskRow } from '@/lib/tasks-views'
import { LevelChip, RequestChip, TaskTick } from '@/components/tahi/tasks/task-chips'
import type { TaskPerson, TaskRequestOption } from '@/components/tahi/tasks/task-types'

export interface TasksWeekProps {
  /** The caller passes the WHOLE fetched set; this component filters it to
   *  the viewer's own open work itself, so the rail cannot reach it. */
  allRows: readonly TaskRow[]
  /** The viewer's team member id. Null means nothing is assigned to them and
   *  the empty state is the honest answer. */
  meId: string | null
  people: Readonly<Record<string, TaskPerson>>
  /** Only so a linked row can print the repo's #042 reference instead of a
   *  bare "Request". Optional and additive: leave it out and the chip falls
   *  back to the unnumbered label. */
  requests?: readonly TaskRequestOption[]
  /** Show the assignee avatar on a planned row. False for a teammate looking
   *  at their own plate, where it is noise. */
  showAssignee: boolean
  readOnly: boolean
  /** Drop onto a day. `dueDate` is null when the drop cleared the date. */
  onPlan: (taskId: string, dueDate: string | null, groupName: string) => Promise<void>
  onToggleDone: (taskId: string, done: boolean) => void
  onOpenTask: (taskId: string) => void
  onOpenRequest: (requestId: string) => void
  /** Injected in tests; defaults to the wall clock. */
  now?: Date
}

/** Standard is the resting state and earns no chip, the way every other task
 *  surface in the repo reads it. */
function PriorityBadge({ priority }: { priority: string }) {
  if (priority === 'standard') return null
  return (
    <Badge tone={priorityTone(priority)} variant="soft" size="sm" leader="icon" icon={<Zap size={10} />}>
      {taskPriorityLabel(priority)}
    </Badge>
  )
}

/** A local Date at midnight from a YYYY-MM-DD key. */
function dateFromKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * 'Monday' for any day key, read back off the strip that day sits in rather
 * than formatted a second time here. A keyboard nudge and a drop onto the
 * same cell then word the toast identically.
 *
 * The weekday on its own, not the cell's 'Monday 8 Sep' label: the shell
 * lowercases whatever name it is handed before it toasts it, which one word
 * survives and a month abbreviation does not. That lowercasing is in a file
 * this slice does not own, so the string is chosen to read correctly either
 * way, and it matches what a drop on a day card already says.
 */
function dayNameFor(dayKey: string): string {
  const cell = buildWeekStrip([], dateFromKey(dayKey)).find(d => d.dayKey === dayKey)
  return cell?.name ?? dayKey
}

const WEEK_CSS = `
.tskw{ display: flex; flex-direction: column; gap: 0.875rem; }
.tskw-sum{
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 0.875rem;
  background: var(--color-bg);
  box-shadow: var(--shadow-sm);
}
.tskw-sum-row{
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.875rem;
}
.tskw-stat{ display: flex; flex-direction: column; gap: 0.125rem; min-width: 5.5rem; }
.tskw-stat b{
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.tskw-stat span{
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-subtle);
}
.tskw-stat.is-danger b{ color: var(--color-danger); }
.tskw-note{
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4375rem;
  font-size: 0.78125rem;
  font-weight: 500;
  color: var(--color-text-muted);
}
.tskw-cols{
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
  gap: 0.875rem;
}
@media (max-width: 47.9375rem){
  .tskw-cols{ grid-template-columns: 1fr; }
}
.tskw-cols .tskw-day{ min-height: 8rem; }
.tskw-day{
  border: 1px solid var(--color-border);
  border-radius: 0.875rem;
  background: var(--color-bg);
  box-shadow: var(--shadow-sm);
  transition:
    border-color var(--motion-quick) var(--ease-out),
    background-color var(--motion-quick) var(--ease-out),
    box-shadow var(--motion-quick) var(--ease-out);
}
.tskw-day.is-over{
  border-color: var(--color-brand);
  background: color-mix(in srgb, var(--color-brand-100) 45%, var(--color-bg));
  box-shadow: inset 0 0 0 1px var(--color-brand);
}
.tskw-day-head{ display: flex; align-items: baseline; gap: 0.5rem; padding: 0.75rem 1rem 0.5rem; }
.tskw-day-name{ font-size: 0.84375rem; font-weight: 700; color: var(--color-text); }
.tskw-day.is-overdue .tskw-day-name{ color: var(--color-danger); }
.tskw-day.is-today .tskw-day-name{ color: var(--color-link); }
.tskw-day-date{ font-size: 0.75rem; font-weight: 500; color: var(--color-text-subtle); }
.tskw-day-n{
  margin-left: auto;
  font-size: 0.71875rem;
  font-weight: 600;
  color: var(--color-text-subtle);
  font-variant-numeric: tabular-nums;
}
.tskw-day-hours{
  font-size: 0.71875rem;
  font-weight: 600;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.tskw-day-body{ display: flex; flex-direction: column; padding: 0 0.5rem 0.5rem; }
.tskw-row{
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.3125rem 0.625rem;
  min-height: 3rem;
  padding: 0.375rem 0.5rem 0.375rem 0.625rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: none;
  text-align: left;
  cursor: grab;
  container-type: inline-size;
  container-name: tsk-task;
  transition:
    background-color var(--motion-quick) var(--ease-out),
    border-color var(--motion-quick) var(--ease-out),
    opacity var(--motion-quick) var(--ease-out);
}
@media (min-width: 48rem){ .tskw-row{ min-height: 2.75rem; } }
.tskw-row:hover{ background: var(--color-bg-secondary); }
.tskw-row.is-dragging{ opacity: 0.4; border-style: dashed; border-color: var(--color-border); }
.tskw-row.is-static{ cursor: pointer; }
.tskw-title{
  flex: 1 1 auto;
  min-width: min(12rem, 100%);
  font-size: 0.84375rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--color-text);
  overflow-wrap: anywhere;
}
.tskw-chips{ display: inline-flex; align-items: center; flex-wrap: wrap; gap: 0.375rem; }
.tskw-est{ font-size: 0.71875rem; font-weight: 600; color: var(--color-text-subtle); font-variant-numeric: tabular-nums; }
.tskw-open{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  margin-left: auto;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  color: var(--color-text-subtle);
}
@media (min-width: 48rem){ .tskw-open{ width: 1.75rem; height: 1.75rem; } }
.tskw-row:hover .tskw-open{ color: var(--color-text); background: var(--color-bg-tertiary); }
.tskw-drop{
  margin: 0.125rem 0.25rem 0.25rem;
  padding: 0.75rem;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  text-align: center;
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-subtle);
  transition:
    border-color var(--motion-quick) var(--ease-out),
    color var(--motion-quick) var(--ease-out),
    background-color var(--motion-quick) var(--ease-out);
}
.tskw-day.is-over .tskw-drop{
  border-color: var(--color-brand);
  color: var(--color-link);
  background: var(--color-bg);
}
.tskw-day.is-flash{ box-shadow: var(--shadow-ring); }

/* The week strip. A second row inside the summary plate, not a second card:
   same border, same radius, one hairline divider above it. */
.tskw-strip{
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border-subtle);
}
.tskw-strip-head{
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.375rem;
}
.tskw-strip-range{
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
.tskw-page{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 2.75rem;
  height: 2.75rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: none;
  color: var(--color-text-subtle);
  cursor: pointer;
  transition:
    background-color var(--motion-quick) var(--ease-out),
    border-color var(--motion-quick) var(--ease-out),
    color var(--motion-quick) var(--ease-out);
}
.tskw-page:hover{
  background: var(--color-bg-secondary);
  border-color: var(--color-border);
  color: var(--color-text);
}
.tskw-now{
  margin-left: auto;
  min-height: 2.75rem;
  padding: 0 0.5rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: none;
  font-size: 0.71875rem;
  font-weight: 600;
  color: var(--color-link);
  cursor: pointer;
  transition:
    background-color var(--motion-quick) var(--ease-out),
    border-color var(--motion-quick) var(--ease-out);
}
.tskw-now:hover{ background: var(--color-bg-secondary); border-color: var(--color-border); }
@media (min-width: 48rem){
  .tskw-page{ width: 1.75rem; height: 1.75rem; }
  .tskw-now{ min-height: 1.75rem; }
}
.tskw-cells{
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.25rem;
}
.tskw-cell{
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.1875rem;
  min-width: 0;
  min-height: 2.75rem;
  padding: 0.3125rem 0.125rem 0.375rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  transition:
    background-color var(--motion-quick) var(--ease-out),
    border-color var(--motion-quick) var(--ease-out);
}
.tskw-cell:not(.is-past):hover,
.tskw-cell:not(.is-past):focus-visible{
  background: var(--color-bg-secondary);
  border-color: var(--color-border);
}
.tskw-cell.is-past{ opacity: 0.55; cursor: default; }
.tskw-cell.is-over{
  border-color: var(--color-brand);
  background: color-mix(in srgb, var(--color-brand-100) 45%, var(--color-bg));
}
.tskw-cell-letter{
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-subtle);
}
.tskw-cell-num{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.25rem;
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1;
  color: var(--color-text);
  font-variant-numeric: tabular-nums;
}
.tskw-cell.is-today .tskw-cell-num{
  border-radius: var(--radius-full);
  background: var(--color-brand);
  color: var(--color-bg);
}
.tskw-cell-bar{
  width: 100%;
  /* Capped so a wide plate draws a meter under the day number rather than a
     170px rule across the cell. */
  max-width: 3rem;
  height: 0.1875rem;
  border-radius: var(--radius-full);
  background: var(--color-border-subtle);
  overflow: hidden;
}
.tskw-cell-fill{
  display: block;
  height: 100%;
  border-radius: var(--radius-full);
  background: var(--color-brand-light);
}
.tskw-cell-n{
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1;
  color: var(--color-text-subtle);
  font-variant-numeric: tabular-nums;
}
@media (prefers-reduced-motion: reduce){
  .tskw-day,
  .tskw-row,
  .tskw-drop,
  .tskw-page,
  .tskw-now,
  .tskw-cell{ transition: none; }
}
`

export function TasksWeek({
  allRows,
  meId,
  people,
  requests,
  showAssignee,
  readOnly,
  onPlan,
  onToggleDone,
  onOpenTask,
  onOpenRequest,
  now,
}: TasksWeekProps): React.ReactElement {
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [overKey, setOverKey] = React.useState<string | null>(null)
  // The strip's whole state. No new prop and no API call: every cell is
  // derived from the rows the shell already fetched.
  const [weekOffset, setWeekOffset] = React.useState(0)
  const [stripIndex, setStripIndex] = React.useState<number | null>(null)
  const [flashKey, setFlashKey] = React.useState<string | null>(null)
  const cellRefs = React.useRef<Array<HTMLButtonElement | null>>([])
  const dayRefs = React.useRef(new Map<string, HTMLElement | null>())
  const refocusRef = React.useRef(false)
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // One clock for the whole render. Injected in tests, and stable per render
  // so the summary and the groups can never disagree by a millisecond.
  const clock = now ?? new Date()
  // Both memos key on the day rather than on `clock`, which is a fresh Date on
  // every render whenever `now` is left out: keying on the instant would make
  // the dep change every render and buy nothing. buildWeekGroups and
  // weekSummary only ever read the calendar day off this value, so the day key
  // is its whole identity here, and the week rebuilds exactly at midnight.
  const dayKey = taskDayKey(clock)

  const mine = React.useMemo(
    () => (meId ? allRows.filter(r => r.assigneeId === meId && r.status !== 'done') : []),
    [allRows, meId],
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = React.useMemo(() => buildWeekGroups(mine, clock), [mine, dayKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const summary = React.useMemo(() => weekSummary(mine, clock), [mine, dayKey])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const strip = React.useMemo(() => buildWeekStrip(mine, clock, weekOffset), [mine, dayKey, weekOffset])

  const todayIndex = strip.findIndex(d => d.isToday)
  // Roving tabindex: today while today is on screen, the first cell otherwise,
  // and whatever the user last landed on once they have moved.
  const activeIndex = Math.max(0, Math.min(6, stripIndex ?? (todayIndex >= 0 ? todayIndex : 0)))

  // Paging with the keyboard has to leave focus on the same weekday, and every
  // cell remounts when the week changes, so the focus call waits for the
  // commit. Paging with the chevrons sets no flag and steals no focus.
  React.useEffect(() => {
    if (!refocusRef.current) return
    refocusRef.current = false
    cellRefs.current[activeIndex]?.focus()
  }, [weekOffset, activeIndex])

  React.useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  if (mine.length === 0) {
    return (
      <div className="tskw">
        <style>{WEEK_CSS}</style>
        <EmptyState
          icon={<CalendarDays className="w-6 h-6" />}
          title="A clear week"
          description="Nothing open is assigned to you. Enjoy it, or pull something in from All tasks."
        />
      </div>
    )
  }

  const overdue = groups.find(g => g.key === 'overdue') ?? null
  const today = groups.find(g => g.key === 'today') ?? null
  const tailKeys = ['later', 'none']
  const middle = groups.filter(g => g.key !== 'overdue' && g.key !== 'today' && !tailKeys.includes(g.key))
  const tail = groups.filter(g => tailKeys.includes(g.key))

  function endDrag() {
    setDragId(null)
    setOverKey(null)
  }

  function handleDrop(group: PlannerGroup) {
    if (!dragId || !group.droppable) return
    const taskId = dragId
    endDrag()
    void onPlan(taskId, group.dueDate ?? null, group.name).catch(() => undefined)
  }

  /** The day card a strip cell points at. A day past this Sunday falls back
   *  to Later, because that is the card that actually holds those tasks, and
   *  buildWeekGroups always emits it. Only ever asked about a day that has
   *  not gone: a past cell takes neither a click nor a drop. */
  function dayCardKey(day: StripDay): string {
    const exact = groups.find(g => g.dueDate === day.dayKey)
    return exact ? exact.key : 'later'
  }

  /** 600ms of the focus ring on a day card, so a drop or a keyboard jump says
   *  where it landed. Skipped when the viewer has asked for less motion. */
  function flashDay(key: string) {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (flashTimer.current) clearTimeout(flashTimer.current)
    setFlashKey(key)
    flashTimer.current = setTimeout(() => setFlashKey(null), 600)
  }

  function revealDay(day: StripDay, focus: boolean) {
    const key = dayCardKey(day)
    const card = dayRefs.current.get(key)
    if (!card) return
    card.scrollIntoView({ block: 'nearest' })
    if (focus) card.focus({ preventScroll: true })
    flashDay(key)
  }

  function handleStripDrop(day: StripDay) {
    if (!dragId || !day.droppable || readOnly) return
    const taskId = dragId
    endDrag()
    // day.name, not day.label, for the reason dayNameFor states: the toast
    // this feeds is lowercased upstream, and one word survives that.
    void onPlan(taskId, day.dayKey, day.name).catch(() => undefined)
    revealDay(day, false)
  }

  function moveStripFocus(next: number) {
    const clamped = Math.max(0, Math.min(6, next))
    setStripIndex(clamped)
    cellRefs.current[clamped]?.focus()
  }

  function pageWeek(delta: number, keepIndex: number) {
    setStripIndex(Math.max(0, Math.min(6, keepIndex)))
    refocusRef.current = true
    setWeekOffset(current => current + delta)
  }

  function handleCellKey(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); moveStripFocus(index - 1); break
      case 'ArrowRight': e.preventDefault(); moveStripFocus(index + 1); break
      case 'Home': e.preventDefault(); moveStripFocus(0); break
      case 'End': e.preventDefault(); moveStripFocus(6); break
      case 'PageUp': e.preventDefault(); pageWeek(-1, index); break
      case 'PageDown': e.preventDefault(); pageWeek(1, index); break
      // A day already gone is announced as unavailable, so it does nothing
      // here either. Arrow, Home, End and the page keys stay live on it:
      // moving across the strip is navigation, not the cell's action.
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const day = strip[index]
        if (!day.isPast) revealDay(day, true)
        break
      }
      default: break
    }
  }

  /** Alt plus an arrow on a focused row: the keyboard equivalent of the drag,
   *  which this planner has never had. Right and left move the due date by a
   *  day, up clears it, and all three go through the same onPlan a drop uses. */
  function nudgeDueDate(task: TaskRow, key: string) {
    if (key === 'ArrowUp') {
      void onPlan(task.id, null, 'No date').catch(() => undefined)
      return
    }
    const base = task.dueDate ? task.dueDate.slice(0, 10) : dayKey
    const next = taskShiftedDayKey(dateFromKey(base), key === 'ArrowRight' ? 1 : -1)
    void onPlan(task.id, next, dayNameFor(next)).catch(() => undefined)
  }

  function renderRow(task: TaskRow) {
    const level = levelOf(task)
    const person = task.assigneeId ? people[task.assigneeId] : undefined
    const blocked = isTaskBlocked(task)

    return (
      <div
        key={task.id}
        role="button"
        tabIndex={0}
        aria-label={`Open ${task.title}`}
        className={[
          'tskw-row tahi-focus-ring',
          dragId === task.id ? 'is-dragging' : '',
          readOnly ? 'is-static' : '',
        ].filter(Boolean).join(' ')}
        draggable={!readOnly}
        onDragStart={readOnly ? undefined : e => {
          e.dataTransfer.effectAllowed = 'move'
          // Firefox refuses to start a drag without a payload.
          e.dataTransfer.setData('text/plain', '')
          setDragId(task.id)
        }}
        onDragEnd={readOnly ? undefined : endDrag}
        onClick={() => onOpenTask(task.id)}
        onKeyDown={e => {
          // Only the row itself. The tick inside it owns its own keys, and
          // without this guard Enter on the tick would also open the task.
          if (e.target !== e.currentTarget) return
          if (!readOnly && e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
            e.preventDefault()
            nudgeDueDate(task, e.key)
            return
          }
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpenTask(task.id)
          }
        }}
      >
        <TaskTick
          done={false}
          blocked={blocked}
          disabled={readOnly}
          title={task.title}
          onToggle={() => onToggleDone(task.id, true)}
        />
        <span className="tskw-title">{task.title}</span>
        <span className="tskw-chips">
          <LevelChip level={level} clientName={task.orgName} compact />
          {task.requestId && (
            <RequestChip
              requestId={task.requestId}
              requestNumber={requests?.find(r => r.id === task.requestId)?.requestNumber ?? null}
              onOpen={onOpenRequest}
            />
          )}
          <PriorityBadge priority={task.priority} />
          {task.estimatedHours != null && task.estimatedHours > 0 && (
            <span className="tskw-est">{formatHours(task.estimatedHours)}</span>
          )}
          {showAssignee && person && (
            <Avatar name={person.name} src={person.avatarUrl ?? undefined} size={18} noRing tooltip={person.name} />
          )}
        </span>
        <span className="tskw-open" aria-hidden="true">
          <ArrowRight size={14} />
        </span>
      </div>
    )
  }

  function renderDay(group: PlannerGroup) {
    const droppable = group.droppable && !readOnly
    const count = group.tasks.length
    const showDropZone = droppable && (count === 0 || dragId !== null)
    const dropCopy = dragId
      ? `Drop to plan for ${group.name.toLowerCase()}`
      : group.key === 'none'
        ? 'Undated tasks land here'
        : 'Nothing planned. Drag a task here.'

    return (
      <section
        key={group.key}
        ref={el => { dayRefs.current.set(group.key, el) }}
        // Not a tab stop: only the strip's Enter moves focus here, and a card
        // that answered Tab would put nine stops in front of the first task.
        tabIndex={-1}
        aria-label={group.name}
        className={[
          'tskw-day',
          group.key === 'overdue' ? 'is-overdue' : '',
          group.key === 'today' ? 'is-today' : '',
          overKey === group.key && droppable ? 'is-over' : '',
          flashKey === group.key ? 'is-flash' : '',
        ].filter(Boolean).join(' ')}
        onDragOver={droppable ? e => { e.preventDefault(); setOverKey(group.key) } : undefined}
        // dragleave bubbles out of the rows and the drop zone inside the card,
        // so an unguarded handler would clear the highlight and the next
        // dragover would set it again: the brand outline strobes while the
        // pointer crosses a populated day. Only a leave that actually left the
        // card counts.
        onDragLeave={droppable ? (e: React.DragEvent<HTMLElement>) => {
          const next = e.relatedTarget
          if (next instanceof Node && e.currentTarget.contains(next)) return
          setOverKey(current => (current === group.key ? null : current))
        } : undefined}
        onDrop={droppable ? e => { e.preventDefault(); handleDrop(group) } : undefined}
      >
        <div className="tskw-day-head">
          <span className="tskw-day-name">{group.name}</span>
          {group.date && <span className="tskw-day-date">{group.date}</span>}
          <span className="tskw-day-n">{count === 1 ? '1 task' : `${count} tasks`}</span>
          {group.tasks.some(t => (t.estimatedHours ?? 0) > 0) && (
            <span className="tskw-day-hours">{`· ${formatHours(group.estimatedHours)}`}</span>
          )}
        </div>
        <div className="tskw-day-body">
          {group.tasks.map(renderRow)}
          {showDropZone && <div className="tskw-drop">{dropCopy}</div>}
        </div>
      </section>
    )
  }

  function renderStrip() {
    // A bar on a week with nothing in it says nothing, so the track only
    // appears once something is planned. Inside such a week every cell keeps
    // its track, empty or not, for two reasons: the counts under them stay on
    // one line, and stripLoad reads hours first, so a day carrying two
    // unestimated tasks scores 0 next to a day with an estimate. Hiding its
    // track would read as an empty day while the count beneath said 2. An
    // empty track next to a full one is the honest picture.
    const hasLoad = strip.some(d => d.count > 0)

    return (
      <div className="tskw-strip">
        <div className="tskw-strip-head">
          <button
            type="button"
            className="tskw-page tahi-focus-ring"
            aria-label="Previous week"
            onClick={() => setWeekOffset(current => current - 1)}
          >
            <ChevronLeft size={15} aria-hidden="true" />
          </button>
          <span className="tskw-strip-range">{stripRangeLabel(strip)}</span>
          <button
            type="button"
            className="tskw-page tahi-focus-ring"
            aria-label="Next week"
            onClick={() => setWeekOffset(current => current + 1)}
          >
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          {weekOffset !== 0 && (
            <button
              type="button"
              className="tskw-now tahi-focus-ring"
              // This button unmounts itself the moment it does its job, so
              // without a deliberate hand-off the focus it was holding falls
              // to <body> and the next Tab restarts at the top of the page.
              // The same flag PageUp and PageDown set lands it on the roving
              // cell instead, which after a reset is today.
              onClick={() => { refocusRef.current = true; setWeekOffset(0) }}
            >
              This week
            </button>
          )}
        </div>

        <div className="tskw-cells" role="group" aria-label="Week">
          {strip.map((day, index) => {
            const canDrop = day.droppable && !readOnly
            return (
              <button
                key={day.key}
                type="button"
                ref={el => { cellRefs.current[index] = el }}
                className={[
                  'tskw-cell tahi-focus-ring',
                  day.isToday ? 'is-today' : '',
                  day.isPast ? 'is-past' : '',
                  overKey === day.key && canDrop ? 'is-over' : '',
                ].filter(Boolean).join(' ')}
                title={day.label}
                aria-label={`${day.label}, ${day.count} ${day.count === 1 ? 'task' : 'tasks'}`}
                // aria-disabled rather than disabled: a day that has gone
                // still reads out and still takes the roving tabindex. It is
                // announced as unavailable and it is, so it carries no click
                // and no Enter either. Its cursor already says so.
                aria-disabled={day.isPast ? true : undefined}
                tabIndex={index === activeIndex ? 0 : -1}
                onFocus={() => setStripIndex(index)}
                onClick={day.isPast ? undefined : () => revealDay(day, false)}
                onKeyDown={e => handleCellKey(e, index)}
                onDragOver={canDrop ? e => { e.preventDefault(); setOverKey(day.key) } : undefined}
                // The same guard the day cards use: a leave into a child is
                // not a leave, or the outline strobes as the pointer crosses.
                onDragLeave={canDrop ? (e: React.DragEvent<HTMLElement>) => {
                  const next = e.relatedTarget
                  if (next instanceof Node && e.currentTarget.contains(next)) return
                  setOverKey(current => (current === day.key ? null : current))
                } : undefined}
                onDrop={canDrop ? e => { e.preventDefault(); handleStripDrop(day) } : undefined}
              >
                <span className="tskw-cell-letter" aria-hidden="true">{day.letter}</span>
                <span className="tskw-cell-num">{day.dayOfMonth}</span>
                {hasLoad && (
                  <span className="tskw-cell-bar" aria-hidden="true">
                    <span
                      className="tskw-cell-fill"
                      style={{ width: `${Math.round(stripLoad(day, strip) * 100)}%` }}
                    />
                  </span>
                )}
                {day.count > 0 && <span className="tskw-cell-n" aria-hidden="true">{day.count}</span>}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="tskw">
      <style>{WEEK_CSS}</style>

      <div className="tskw-sum">
        <div className="tskw-sum-row">
          <div className={summary.overdue > 0 ? 'tskw-stat is-danger' : 'tskw-stat'}>
            <b>{summary.overdue}</b>
            <span>Overdue</span>
          </div>
          <div className="tskw-stat">
            <b>{summary.today}</b>
            <span>Today</span>
          </div>
          <div className="tskw-stat">
            <b>{summary.week}</b>
            <span>This week</span>
          </div>
          <div className="tskw-stat">
            <b>{formatHours(summary.estimatedHours)}</b>
            <span>Estimated</span>
          </div>
          <span className="tskw-note">
            {readOnly
              ? <><Eye size={14} aria-hidden="true" />Read-only</>
              : <><GripVertical size={14} aria-hidden="true" />Drag a task onto a day to plan it</>}
          </span>
        </div>
        {renderStrip()}
      </div>

      {overdue && renderDay(overdue)}
      {today && renderDay(today)}
      {middle.length > 0 && <div className="tskw-cols">{middle.map(renderDay)}</div>}
      {tail.length > 0 && <div className="tskw-cols">{tail.map(renderDay)}</div>}
    </div>
  )
}
