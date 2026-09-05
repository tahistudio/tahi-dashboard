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
 * tested without a DOM.
 */

import * as React from 'react'
import { ArrowRight, CalendarDays, Eye, GripVertical, Zap } from 'lucide-react'
import { EmptyState } from '@/components/tahi/empty-state'
import { Badge, priorityTone } from '@/components/tahi/badge'
import { Avatar } from '@/components/tahi/avatar'
import { buildWeekGroups, formatHours, weekSummary, type PlannerGroup } from '@/lib/tasks-planner'
import { taskPriorityLabel } from '@/lib/task-priorities'
import { levelOf, type TaskRow } from '@/lib/tasks-views'
import { LevelChip, RequestChip, TaskTick } from '@/components/tahi/tasks/task-chips'
import type { TaskPerson } from '@/components/tahi/tasks/task-types'

export interface TasksWeekProps {
  /** The caller passes the WHOLE fetched set; this component filters it to
   *  the viewer's own open work itself, so the rail cannot reach it. */
  allRows: readonly TaskRow[]
  /** The viewer's team member id. Null means nothing is assigned to them and
   *  the empty state is the honest answer. */
  meId: string | null
  people: Readonly<Record<string, TaskPerson>>
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

const WEEK_CSS = `
.tskw{ display: flex; flex-direction: column; gap: 0.875rem; }
.tskw-sum{
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  border: 1px solid var(--color-border);
  border-radius: 0.875rem;
  background: var(--color-bg);
  box-shadow: var(--shadow-sm);
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
.tskw-day.is-today .tskw-day-name{ color: var(--color-brand-dark); }
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
  color: var(--color-brand-dark);
  background: var(--color-bg);
}
@media (prefers-reduced-motion: reduce){
  .tskw-day,
  .tskw-row,
  .tskw-drop{ transition: none; }
}
`

export function TasksWeek({
  allRows,
  meId,
  people,
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

  // One clock for the whole render. Injected in tests, and stable per render
  // so the summary and the groups can never disagree by a millisecond.
  const clock = now ?? new Date()
  const clockMs = clock.getTime()

  const mine = React.useMemo(
    () => (meId ? allRows.filter(r => r.assigneeId === meId && r.status !== 'done') : []),
    [allRows, meId],
  )

  // Both memos key on clockMs rather than on `clock` itself: a new Date on
  // every render would rebuild the whole week on every render, and the
  // milliseconds are the stable identity of the value that matters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = React.useMemo(() => buildWeekGroups(mine, clock), [mine, clockMs])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const summary = React.useMemo(() => weekSummary(mine, clock), [mine, clockMs])

  if (mine.length === 0) {
    return (
      <div className="tskw">
        <style>{WEEK_CSS}</style>
        <EmptyState
          icon={<CalendarDays className="w-6 h-6" />}
          title="A clear week"
          description="Nothing open is assigned to you. Enjoy it, or pull something in from the list."
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

  function renderRow(task: TaskRow) {
    const level = levelOf(task)
    const person = task.assigneeId ? people[task.assigneeId] : undefined
    const blocked = task.status === 'blocked' || (task.blockedByCount ?? 0) > 0

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
            <RequestChip requestId={task.requestId} requestNumber={null} onOpen={onOpenRequest} />
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
        aria-label={group.name}
        className={[
          'tskw-day',
          group.key === 'overdue' ? 'is-overdue' : '',
          group.key === 'today' ? 'is-today' : '',
          overKey === group.key && droppable ? 'is-over' : '',
        ].filter(Boolean).join(' ')}
        onDragOver={droppable ? e => { e.preventDefault(); setOverKey(group.key) } : undefined}
        onDragLeave={droppable ? () => setOverKey(current => (current === group.key ? null : current)) : undefined}
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

  return (
    <div className="tskw">
      <style>{WEEK_CSS}</style>

      <div className="tskw-sum">
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

      {overdue && renderDay(overdue)}
      {today && renderDay(today)}
      {middle.length > 0 && <div className="tskw-cols">{middle.map(renderDay)}</div>}
      {tail.length > 0 && <div className="tskw-cols">{tail.map(renderDay)}</div>}
    </div>
  )
}
