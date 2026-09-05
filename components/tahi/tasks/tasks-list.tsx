'use client'

/**
 * <TasksList>. The List view: the quick-add bar, the bulk bar when rows are
 * selected, and the table itself.
 *
 * Built on <DataTable> with expandedRowMode="rows", so a row's subtask panel
 * is real <tr>s in the same <tbody> and its columns line up with the parent's
 * for free. Below md the table is replaced by mobileCard, which is the one
 * layout DataTable mounts once it has measured the width.
 *
 * This component fetches nothing and stores nothing. Every mutation leaves
 * through a callback so the shell can make it optimistic in one place.
 */

import * as React from 'react'
import { Leaf, Plus, X } from 'lucide-react'
import {
  DataTable,
  type DataTableColumn,
  type DataTableExpandedContext,
} from '@/components/tahi/data-table'
import { pruneExpandedIds } from '@/components/tahi/data-table-expand'
import { BulkActionBar, type BulkAction } from '@/components/tahi/bulk-action-bar'
import { StatusChipSelect } from '@/components/tahi/status-chip-select'
import { Card } from '@/components/tahi/card'
import { Avatar } from '@/components/tahi/avatar'
import { Badge, priorityTone } from '@/components/tahi/badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import {
  DueDateChip,
  formatDueDateLabel,
  TASK_CLOSED_STATUSES,
} from '@/components/tahi/due-date-chip'
import {
  LevelChip,
  RequestChip,
  SubtaskBadge,
  TaskStatusBadge,
  TaskTick,
} from '@/components/tahi/tasks/task-chips'
import { TaskQuickAdd } from '@/components/tahi/tasks/task-quick-add'
import { TASK_STATUSES } from '@/lib/status-config'
import { taskPriorityLabel } from '@/lib/task-priorities'
import { levelOf, taskDayKey, taskShiftedDayKey, type TaskRow } from '@/lib/tasks-views'
import type { QuickAddParse } from '@/lib/tasks-quick-add'
// Shared shapes from Slice 1. Do NOT redeclare them here: Slice 5 imports the
// same two and cannot see this file until Wave B merges.
import type { TaskSubtask, TaskPerson } from '@/components/tahi/tasks/task-types'

export interface TasksListProps {
  rows: readonly TaskRow[]
  loading: boolean
  /** Team members by id, for the assignee cell and the bulk Assign menu. */
  people: Readonly<Record<string, TaskPerson>>
  /** Ordered list for the bulk Assign menu. */
  peopleList: readonly TaskPerson[]
  clients: readonly { id: string; name: string }[]
  readOnly: boolean

  /** Subtasks for the rows the user has expanded. The shell fetches them
   *  lazily; an id with no entry yet renders the skeleton. */
  subtasks: Readonly<Record<string, TaskSubtask[] | undefined>>
  onExpandRow: (taskId: string) => void

  onOpenTask: (taskId: string) => void
  onOpenRequest: (requestId: string) => void
  onToggleDone: (taskId: string, done: boolean) => void
  onStatusChange: (taskId: string, status: string) => Promise<void>
  onToggleSubtask: (taskId: string, subtaskId: string, completed: boolean) => void
  onAddSubtask: (taskId: string, title: string) => Promise<void>
  onQuickAdd: (parsed: QuickAddParse) => Promise<void>

  /** Bulk. `run` resolves to the shape BulkActionBar expects. */
  onBulkStatus: (ids: string[], status: string) => Promise<{ ok: number; failed?: number }>
  onBulkPriority: (ids: string[], priority: string) => Promise<{ ok: number; failed?: number }>
  onBulkAssignee: (ids: string[], assigneeId: string | null) => Promise<{ ok: number; failed?: number }>
  onBulkDueDate: (ids: string[], dueDate: string | null) => Promise<{ ok: number; failed?: number }>

  /** Empty states. `hasFilter` picks the "no matches" copy over "nothing on
   *  the list", and `onClearFilters` gives that one a way back. */
  hasFilter: boolean
  onClearFilters: () => void
  onNewTask: () => void
}

/** The group outline the subtask rows compose out of their single cells: the
 *  parent row's own bottom rule is the top edge, and each cell paints the
 *  other three, so the run reads as one closed box rather than a stack of
 *  one-sided rules. Same construction as <SubRequestRows>. */
const HAIRLINE = '1px solid var(--color-border-subtle)'
const PANEL_BG = 'var(--color-bg-secondary)'

/** Indent that puts a subtask tick under the row tick: the selection column,
 *  the cell padding, the chevron gutter and the row tick's own width. Below
 *  md the mobile cards take over, so the phone value only ever shows on a
 *  narrow tablet. */
const SUBTASK_INDENT_CLASS = 'pl-4 md:pl-[5.25rem]'

/**
 * Mirrors the rank `compareTasks` sorts on, negated so the header's first
 * (ascending) click reads as loudest first. Declared here rather than
 * imported because lib/tasks-views.ts keeps its rank private; three values
 * that only ever grow with the priority vocabulary itself.
 */
const PRIORITY_RANK: Record<string, number> = { urgent: 3, high: 2, standard: 1 }

/** Sorts undated work below dated work whichever direction the header is in,
 *  matching `compareTasks`'s own placeholder. */
const NO_DUE_DATE = '9999-12-31'

function firstName(name: string | null | undefined): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0] ?? ''
}

function isDone(row: TaskRow): boolean {
  return TASK_CLOSED_STATUSES.includes(row.status)
}

/** Decision 12: the tick's dashed ring reads either kind of stall, so it
 *  agrees with the Blocked saved view and the rail's count. */
function isStalled(row: TaskRow): boolean {
  return row.status === 'blocked' || (row.blockedByCount ?? 0) > 0
}

function subtaskTotal(row: TaskRow): number {
  return row.subtaskCount ?? 0
}

// ── Cells ───────────────────────────────────────────────────────────────────

function NoValue({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
      {children}
    </span>
  )
}

/**
 * The Task cell. A CSS container, so the chips inside it can give up their
 * icons when the cell runs short: the title never gives up width, the chips
 * give way first (the rule lives in app/globals.css, keyed on `tsk-task`).
 */
function TitleCell({
  row,
  readOnly,
  onToggleDone,
  onOpenRequest,
}: {
  row: TaskRow
  readOnly: boolean
  onToggleDone: (taskId: string, done: boolean) => void
  onOpenRequest: (requestId: string) => void
}) {
  const done = isDone(row)
  const total = subtaskTotal(row)
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.3125rem 0.5rem',
        width: '100%',
        minWidth: 0,
        containerType: 'inline-size',
        containerName: 'tsk-task',
      }}
    >
      <TaskTick
        done={done}
        blocked={isStalled(row)}
        disabled={readOnly}
        title={row.title}
        onToggle={() => onToggleDone(row.id, !done)}
      />
      <span
        data-task-row-title
        data-private
        style={{
          flex: '1 1 auto',
          minWidth: 'min(16rem, 100%)',
          fontSize: '0.84375rem',
          fontWeight: 600,
          lineHeight: 1.35,
          textWrap: 'pretty',
          color: done ? 'var(--color-text-subtle)' : 'var(--color-text)',
          textDecoration: done ? 'line-through' : 'none',
        }}
      >
        {row.title}
      </span>
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.375rem',
          minWidth: 0,
          flexShrink: 1,
        }}
      >
        <span style={{ display: 'inline-flex', opacity: done ? 0.7 : 1 }}>
          <LevelChip level={levelOf(row)} clientName={row.orgName} />
        </span>
        {row.requestId && (
          <span className="tsk-chip-thin-icon" style={{ display: 'inline-flex', opacity: done ? 0.7 : 1 }}>
            <RequestChip requestId={row.requestId} onOpen={onOpenRequest} />
          </span>
        )}
        {total > 0 && (
          <span className="tsk-chip-thin-icon" style={{ display: 'inline-flex' }}>
            <SubtaskBadge done={row.subtaskDone ?? 0} total={total} />
          </span>
        )}
      </span>
    </span>
  )
}

function AssigneeCell({ person }: { person: TaskPerson | undefined }) {
  if (!person) return <NoValue>Unassigned</NoValue>
  return (
    <span
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4375rem',
        minWidth: 0,
        fontSize: '0.78125rem',
        fontWeight: 500,
        color: 'var(--color-text-muted)',
      }}
    >
      <Avatar name={person.name} src={person.avatarUrl} size="sm" />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {firstName(person.name)}
      </span>
    </span>
  )
}

function DueCell({ row }: { row: TaskRow }) {
  if (isDone(row)) {
    const label = formatDueDateLabel(row.completedAt)
    return <NoValue>{label ? `Done ${label}` : 'Done'}</NoValue>
  }
  if (!row.dueDate) return <NoValue>No date</NoValue>
  return <DueDateChip dueDate={row.dueDate} status={row.status} closedStatuses={TASK_CLOSED_STATUSES} />
}

/** `standard` prints its own word rather than the prototype's bare dashes: a
 *  dash in a column reads as missing data, and a standard task is not
 *  missing anything. */
function PriorityCell({ priority }: { priority: string }) {
  return (
    <Badge tone={priorityTone(priority)} variant="soft" size="sm">
      {taskPriorityLabel(priority)}
    </Badge>
  )
}

// ── Subtask panel ───────────────────────────────────────────────────────────

/** One full-width cell under the parent row. The panel has no columns to line
 *  up with, so it spans them all and indents with padding, exactly as the
 *  prototype's `.tsk-subpanel` does. */
function PanelRow({
  table,
  children,
}: {
  table: DataTableExpandedContext
  children: React.ReactNode
}) {
  return (
    <tr style={{ background: PANEL_BG, animation: 'tahi-row-expand 180ms ease-out' }}>
      <td
        colSpan={table.colSpan}
        style={{
          padding: 0,
          borderLeft: HAIRLINE,
          borderRight: HAIRLINE,
          borderBottom: HAIRLINE,
        }}
      >
        {children}
      </td>
    </tr>
  )
}

function SubtaskRow({
  table,
  subtask,
  readOnly,
  onToggle,
}: {
  table: DataTableExpandedContext
  subtask: TaskSubtask
  readOnly: boolean
  onToggle: () => void
}) {
  return (
    <PanelRow table={table}>
      <div
        className={`flex items-center min-h-11 md:min-h-10 ${SUBTASK_INDENT_CLASS}`}
        style={{ gap: '0.625rem', paddingRight: '1rem' }}
      >
        <TaskTick
          done={subtask.completed}
          size="sm"
          disabled={readOnly}
          title={subtask.title}
          onToggle={onToggle}
        />
        <span
          data-private
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: '0.8125rem',
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: subtask.completed ? 'var(--color-text-subtle)' : 'var(--color-text)',
            textDecoration: subtask.completed ? 'line-through' : 'none',
          }}
        >
          {subtask.title}
        </span>
      </div>
    </PanelRow>
  )
}

/** Two grey lines while the shell's fetch is in flight. The panel mounts on
 *  the first expand, so this is the only moment a reader ever sees it. */
function SubtaskSkeleton({ table }: { table: DataTableExpandedContext }) {
  return (
    <>
      {[0, 1].map(i => (
        <PanelRow key={i} table={table}>
          <div
            className={`flex items-center min-h-11 md:min-h-10 ${SUBTASK_INDENT_CLASS}`}
            style={{ gap: '0.625rem', paddingRight: '1rem' }}
          >
            <span
              aria-hidden="true"
              className="animate-pulse"
              style={{
                width: '1.0625rem',
                height: '1.0625rem',
                flexShrink: 0,
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-bg-tertiary)',
              }}
            />
            <span
              aria-hidden="true"
              className="animate-pulse"
              style={{
                width: i === 0 ? '12rem' : '8rem',
                maxWidth: '60%',
                height: '0.625rem',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg-tertiary)',
              }}
            />
          </div>
        </PanelRow>
      ))}
    </>
  )
}

function AddSubtaskRow({
  table,
  taskId,
  onAddSubtask,
}: {
  table: DataTableExpandedContext
  taskId: string
  onAddSubtask: (taskId: string, title: string) => Promise<void>
}) {
  const [adding, setAdding] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  async function commit() {
    const title = draft.trim()
    if (!title || saving) return
    setSaving(true)
    try {
      await onAddSubtask(taskId, title)
      // The field stays open and empty: naming three subtasks in a row is
      // the normal case, and reopening it each time is three extra clicks.
      if (mountedRef.current) setDraft('')
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  if (adding) {
    return (
      <PanelRow table={table}>
        <div
          className={`flex items-center min-h-11 md:min-h-10 ${SUBTASK_INDENT_CLASS}`}
          style={{ gap: '0.5rem', paddingRight: '1rem', paddingTop: '0.375rem', paddingBottom: '0.5rem' }}
        >
          <input
            autoFocus
            value={draft}
            disabled={saving}
            aria-label="New subtask"
            placeholder="Name the subtask, press Enter"
            className="tahi-focus-ring"
            onChange={e => setDraft(e.target.value)}
            onBlur={() => { setAdding(false); setDraft('') }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); void commit() }
              if (e.key === 'Escape') { setAdding(false); setDraft('') }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              minHeight: '2rem',
              padding: '0.25rem 0.5rem',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg)',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--color-text)',
              opacity: saving ? 0.6 : 1,
            }}
          />
        </div>
      </PanelRow>
    )
  }

  return (
    <PanelRow table={table}>
      <button
        type="button"
        className={`tahi-focus-ring flex items-center w-full min-h-11 md:min-h-10 ${SUBTASK_INDENT_CLASS}`}
        onClick={e => { e.stopPropagation(); setAdding(true) }}
        style={{
          gap: '0.5rem',
          paddingRight: '1rem',
          border: 'none',
          background: 'transparent',
          fontFamily: 'inherit',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: 'var(--color-text-subtle)',
          textAlign: 'left',
          cursor: 'pointer',
          transition: 'background-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--color-bg-tertiary)'
          e.currentTarget.style.color = 'var(--color-brand-dark)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--color-text-subtle)'
        }}
      >
        <Plus size={13} strokeWidth={2.4} aria-hidden="true" />
        Add subtask
      </button>
    </PanelRow>
  )
}

// ── Mobile card ─────────────────────────────────────────────────────────────

function TaskMobileCard({
  row,
  person,
  readOnly,
  onOpenTask,
  onOpenRequest,
  onToggleDone,
}: {
  row: TaskRow
  person: TaskPerson | undefined
  readOnly: boolean
  onOpenTask: (taskId: string) => void
  onOpenRequest: (requestId: string) => void
  onToggleDone: (taskId: string, done: boolean) => void
}) {
  const done = isDone(row)
  const total = subtaskTotal(row)
  return (
    <div
      className="tsk-mc flex"
      onClick={() => onOpenTask(row.id)}
      // The hairline between cards lives in app/globals.css, not here: an
      // inline border would outrank the :last-child rule that drops it on
      // the final card.
      style={{
        gap: '0.75rem',
        padding: '0.8125rem 0.875rem',
        cursor: 'pointer',
        transition: 'background-color 120ms ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-hover-tint)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span
        className="flex items-start justify-center"
        style={{ width: '2.75rem', flexShrink: 0, paddingTop: '0.875rem' }}
      >
        <TaskTick
          done={done}
          blocked={isStalled(row)}
          disabled={readOnly}
          title={row.title}
          onToggle={() => onToggleDone(row.id, !done)}
        />
      </span>
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: '0.5rem' }}>
        <span
          data-task-row-title
          data-private
          style={{
            fontSize: '0.90625rem',
            fontWeight: 600,
            lineHeight: 1.35,
            textWrap: 'pretty',
            color: done ? 'var(--color-text-subtle)' : 'var(--color-text)',
            textDecoration: done ? 'line-through' : 'none',
          }}
        >
          {row.title}
        </span>
        <div className="flex items-center flex-wrap" style={{ gap: '0.5rem', minWidth: 0 }}>
          <LevelChip level={levelOf(row)} clientName={row.orgName} />
          {row.requestId && <RequestChip requestId={row.requestId} onOpen={onOpenRequest} />}
          {row.status === 'blocked' && <TaskStatusBadge status="blocked" />}
          {!done && row.dueDate && (
            <DueDateChip
              dueDate={row.dueDate}
              status={row.status}
              size="sm"
              closedStatuses={TASK_CLOSED_STATUSES}
            />
          )}
          <PriorityCell priority={row.priority} />
          {total > 0 && <SubtaskBadge done={row.subtaskDone ?? 0} total={total} />}
          {person && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
              <Avatar name={person.name} src={person.avatarUrl} size="sm" />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Empty states ────────────────────────────────────────────────────────────

function TasksEmpty({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: React.ReactNode
}) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: '3rem 1.5rem' }}
    >
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center"
        style={{
          width: '3.25rem',
          height: '3.25rem',
          marginBottom: '0.875rem',
          borderRadius: 'var(--radius-leaf-sm)',
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-brand)',
        }}
      >
        <Leaf size={26} aria-hidden="true" />
      </span>
      <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 600, color: 'var(--color-text)' }}>
        {title}
      </h3>
      <p
        style={{
          margin: '0.375rem 0 0',
          maxWidth: '20rem',
          fontSize: '0.8125rem',
          color: 'var(--color-text-muted)',
        }}
      >
        {body}
      </p>
      {action && <span style={{ marginTop: '1rem' }}>{action}</span>}
    </div>
  )
}

// ── Component ───────────────────────────────────────────────────────────────

export function TasksList(props: TasksListProps): React.ReactElement {
  const {
    rows, loading, people, peopleList, clients, readOnly,
    subtasks, onExpandRow,
    onOpenTask, onOpenRequest, onToggleDone, onStatusChange,
    onToggleSubtask, onAddSubtask, onQuickAdd,
    onBulkStatus, onBulkPriority, onBulkAssignee, onBulkDueDate,
    hasFilter, onClearFilters, onNewTask,
  } = props

  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const [expandedIds, setExpandedIds] = React.useState<ReadonlySet<string>>(() => new Set())
  // Which rows have already asked the shell for their subtasks. One request
  // per row per mount, however many times it is opened and closed.
  const requestedRef = React.useRef<Set<string>>(new Set())

  // A row that has left the lens can no longer be selected or open: a bulk
  // action on a row nobody can see is the kind of surprise this prune exists
  // to prevent. `pruneExpandedIds` returns the same Set when nothing changed,
  // which is what makes both effects safe.
  React.useEffect(() => {
    const ids = rows.map(r => r.id)
    setExpandedIds(prev => pruneExpandedIds(prev, ids))
    setSelectedIds(prev => pruneExpandedIds(prev, ids))
  }, [rows])

  const handleExpandedChange = React.useCallback((next: Set<string>) => {
    next.forEach(id => {
      if (!requestedRef.current.has(id)) {
        requestedRef.current.add(id)
        onExpandRow(id)
      }
    })
    setExpandedIds(next)
  }, [onExpandRow])

  const handleSelectionChange = React.useCallback((next: Set<string>) => {
    setSelectedIds(next)
  }, [])

  const clearSelection = React.useCallback(() => { setSelectedIds(new Set()) }, [])

  // ── Columns ───────────────────────────────────────────────────────────────
  //
  // Column sort is uncontrolled on purpose: DataTable sorts internally when
  // `sort` is omitted, so the rail's persisted sort arrives in the rows and a
  // header click re-sorts that array until the third click switches it off.
  // The one thing a header sort drops is the done-last rank, which lives in
  // compareTasks alone. That is the prototype's behaviour too.
  const columns = React.useMemo<DataTableColumn<TaskRow>[]>(() => [
    {
      key: 'title',
      header: 'Task',
      // A real table, not the prototype's grid: the fixed columns below take
      // what they need and the Task column absorbs everything else, which is
      // what `minmax(0, 2.2fr)` was saying in grid terms.
      width: 'auto',
      wrap: true,
      sortable: true,
      sortValue: r => r.title.toLowerCase(),
      render: r => (
        <TitleCell
          row={r}
          readOnly={readOnly}
          onToggleDone={onToggleDone}
          onOpenRequest={onOpenRequest}
        />
      ),
    },
    {
      key: 'assignee',
      header: 'Assignee',
      width: '6.5rem',
      render: r => <AssigneeCell person={r.assigneeId ? people[r.assigneeId] : undefined} />,
    },
    {
      key: 'due',
      header: 'Due',
      width: '7rem',
      sortable: true,
      sortValue: r => r.dueDate ?? NO_DUE_DATE,
      render: r => <DueCell row={r} />,
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '4.5rem',
      sortable: true,
      sortValue: r => -(PRIORITY_RANK[r.priority] ?? PRIORITY_RANK.standard),
      render: r => <PriorityCell priority={r.priority} />,
    },
    {
      key: 'status',
      header: 'Status',
      width: '6.5rem',
      // data-row-control is DataTable's own opt-out: a click inside it never
      // reaches the row handler, so picking a status cannot also open the
      // task.
      render: r => (
        <span data-row-control style={{ display: 'inline-flex' }}>
          <StatusChipSelect
            value={r.status}
            options={TASK_STATUSES}
            density="compact"
            disabled={readOnly}
            onChange={next => onStatusChange(r.id, next)}
            aria-label={`Change status of ${r.title}`}
          />
        </span>
      ),
    },
  ], [people, readOnly, onToggleDone, onOpenRequest, onStatusChange])

  // ── Expanded subtask rows ─────────────────────────────────────────────────

  const renderSubtaskRows = React.useCallback((row: TaskRow, table: DataTableExpandedContext) => {
    const list = subtasks[row.id]
    if (list === undefined) return <SubtaskSkeleton table={table} />
    return (
      <>
        {list.map(sub => (
          <SubtaskRow
            key={sub.id}
            table={table}
            subtask={sub}
            readOnly={readOnly}
            onToggle={() => onToggleSubtask(row.id, sub.id, !sub.completed)}
          />
        ))}
        {list.length === 0 && (
          <PanelRow table={table}>
            <span
              className={SUBTASK_INDENT_CLASS}
              style={{
                display: 'block',
                paddingTop: '0.625rem',
                paddingBottom: '0.625rem',
                paddingRight: '1rem',
                fontSize: '0.75rem',
                fontStyle: 'italic',
                color: 'var(--color-text-subtle)',
              }}
            >
              No subtasks yet.
            </span>
          </PanelRow>
        )}
        {!readOnly && (
          <AddSubtaskRow table={table} taskId={row.id} onAddSubtask={onAddSubtask} />
        )}
      </>
    )
  }, [subtasks, readOnly, onToggleSubtask, onAddSubtask])

  const isExpandable = React.useCallback(
    (row: TaskRow) => subtaskTotal(row) > 0 || !readOnly,
    [readOnly],
  )

  const renderMobileCard = React.useCallback((row: TaskRow) => (
    <TaskMobileCard
      row={row}
      person={row.assigneeId ? people[row.assigneeId] : undefined}
      readOnly={readOnly}
      onOpenTask={onOpenTask}
      onOpenRequest={onOpenRequest}
      onToggleDone={onToggleDone}
    />
  ), [people, readOnly, onOpenTask, onOpenRequest, onToggleDone])

  // ── Bulk actions ──────────────────────────────────────────────────────────

  const bulkActions = React.useMemo<BulkAction[]>(() => {
    const ids = [...selectedIds]
    // Read the clock when the action runs, not when the menu is built: a
    // board left open past midnight must not write yesterday's date.
    const today = () => taskDayKey(new Date())
    const shifted = (days: number) => taskShiftedDayKey(new Date(), days)
    return [
      { id: 'status-todo', section: 'Move to', label: 'To Do', verb: 'moved', run: () => onBulkStatus(ids, 'todo') },
      { id: 'status-in_progress', section: 'Move to', label: 'In Progress', verb: 'moved', run: () => onBulkStatus(ids, 'in_progress') },
      { id: 'status-blocked', section: 'Move to', label: 'Blocked', verb: 'moved', run: () => onBulkStatus(ids, 'blocked') },
      { id: 'priority-urgent', section: 'Priority', label: 'Urgent', verb: 'updated', run: () => onBulkPriority(ids, 'urgent') },
      { id: 'priority-high', section: 'Priority', label: 'High', verb: 'updated', run: () => onBulkPriority(ids, 'high') },
      { id: 'priority-standard', section: 'Priority', label: 'Standard', verb: 'updated', run: () => onBulkPriority(ids, 'standard') },
      { id: 'due-today', section: 'Due', label: 'Today', verb: 'dated', run: () => onBulkDueDate(ids, today()) },
      { id: 'due-tomorrow', section: 'Due', label: 'Tomorrow', verb: 'dated', run: () => onBulkDueDate(ids, shifted(1)) },
      { id: 'due-next-week', section: 'Due', label: 'Next week', verb: 'dated', run: () => onBulkDueDate(ids, shifted(7)) },
      { id: 'due-clear', section: 'Due', label: 'Clear date', verb: 'undated', run: () => onBulkDueDate(ids, null) },
      ...peopleList.map(p => ({
        id: `assign-${p.id}`,
        section: 'Assign to',
        label: p.name,
        verb: 'assigned',
        run: () => onBulkAssignee(ids, p.id),
      })),
      { id: 'assign-none', section: 'Assign to', label: 'Unassign', verb: 'unassigned', run: () => onBulkAssignee(ids, null) },
    ]
  }, [selectedIds, peopleList, onBulkStatus, onBulkPriority, onBulkAssignee, onBulkDueDate])

  const showBulk = !readOnly && selectedIds.size > 0

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <TaskQuickAdd clients={clients} onAdd={onQuickAdd} disabled={readOnly} />

      {showBulk && (
        <div style={{ marginTop: '1rem' }}>
          <BulkActionBar
            selectedCount={selectedIds.size}
            itemNoun="task"
            primaryAction={{
              id: 'complete',
              label: 'Complete',
              verb: 'marked done',
              run: () => onBulkStatus([...selectedIds], 'done'),
            }}
            actions={bulkActions}
            onClear={clearSelection}
            onResult={clearSelection}
          />
        </div>
      )}

      <Card padding="none" style={{ marginTop: '0.875rem' }}>
        <DataTable<TaskRow>
          ariaLabel="Tasks"
          columns={columns}
          rows={rows}
          getRowId={r => r.id}
          loading={loading}
          onRowClick={r => onOpenTask(r.id)}
          selectable={!readOnly}
          selectedIds={readOnly ? undefined : selectedIds}
          onSelectionChange={readOnly ? undefined : handleSelectionChange}
          expandable={isExpandable}
          renderExpanded={renderSubtaskRows}
          expandedRowMode="rows"
          expandedIds={expandedIds}
          onExpandedChange={handleExpandedChange}
          expandAllLabel="subtasks"
          mobileCard={renderMobileCard}
          empty={hasFilter ? (
            <TasksEmpty
              title="No tasks match"
              body="Try clearing a filter or the search."
              action={(
                <TahiButton variant="secondary" size="md" onClick={onClearFilters} iconLeft={<X className="w-4 h-4" />}>
                  Clear filters
                </TahiButton>
              )}
            />
          ) : (
            <TasksEmpty
              title="Nothing on the list"
              body="Add the first one above, or turn a request into work."
              action={readOnly ? undefined : (
                <TahiButton variant="secondary" size="md" onClick={onNewTask} iconLeft={<Plus className="w-4 h-4" />}>
                  New task
                </TahiButton>
              )}
            />
          )}
        />
      </Card>
    </div>
  )
}
