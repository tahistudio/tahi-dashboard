'use client'

/**
 * <TasksList>. The List view: the quick-add bar, the bulk bar when rows are
 * selected, and the table itself.
 *
 * Built on <DataTable> with expandedRowMode="rows", so a row's checklist
 * panel is real <tr>s in the same <tbody> and its columns line up with the
 * parent's for free. Below md the table is replaced by mobileCard, which is
 * the one layout DataTable mounts once it has measured the width.
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
import { useToast } from '@/components/tahi/toast'
import { TASK_STATUSES } from '@/lib/status-config'
import { taskPriorityLabel } from '@/lib/task-priorities'
import { isTaskBlocked, levelOf, taskDayKey, taskShiftedDayKey, type TaskRow } from '@/lib/tasks-views'
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
   *  lazily; an id with no entry yet renders the skeleton, unless the row's
   *  own `subtaskCount` is 0, which is the answer already and renders the
   *  empty line instead. */
  subtasks: Readonly<Record<string, TaskSubtask[] | undefined>>
  /** Fetch or revalidate this row's subtasks. Called on the first expand of a
   *  row that has any, and again after a subtask is added, so it has to be
   *  safe to call more than once for the same id. A row whose `subtaskCount`
   *  is 0 is never announced, so Expand all costs nothing on an empty page. */
  onExpandRow: (taskId: string) => void

  onOpenTask: (taskId: string) => void
  onOpenRequest: (requestId: string) => void
  onToggleDone: (taskId: string, done: boolean) => void
  onStatusChange: (taskId: string, status: string) => Promise<void>
  onToggleSubtask: (taskId: string, subtaskId: string, completed: boolean) => void
  onAddSubtask: (taskId: string, title: string) => Promise<void>
  /** Optional so the interface Slice 6 was written against still satisfies
   *  this component. Pass it and each subtask row grows its remove button;
   *  leave it out and the panel is add-and-tick only, with removal living in
   *  the detail slide-over. The plan pins the button but states no callback,
   *  and an additive optional prop is the only reading that honours both. */
  onRemoveSubtask?: (taskId: string, subtaskId: string) => void
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
 *  narrow tablet.
 *
 *  A read-only table has no selection column (`selectable={false}`), so every
 *  column shifts left by its 4.25rem and the fixed indent would push the
 *  subtask ticks that far to the right of the parent's. Both class strings are
 *  written out in full rather than composed, because Tailwind reads source
 *  text and a built class name is a class name that does not exist. */
function subtaskIndentClass(leadingCells: number): string {
  return leadingCells > 0 ? 'pl-4 md:pl-[5.25rem]' : 'pl-4 md:pl-4'
}

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

/** Stands in for a list the shell was never asked to fetch, because the row
 *  said there was nothing to fetch. One shared array rather than a fresh
 *  literal per render. */
const NO_SUBTASKS: readonly TaskSubtask[] = []

function firstName(name: string | null | undefined): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0] ?? ''
}

function isDone(row: TaskRow): boolean {
  return TASK_CLOSED_STATUSES.includes(row.status)
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
 *
 * `tsk-title` is not decoration. Inline-size containment means this box
 * contributes nothing to the intrinsic width of anything above it, and
 * DataTable wraps the first column's body in a flex row to seat the expand
 * chevron. That wrapper sizes to its content, so without the rule this class
 * hangs the fix off it would resolve to zero and take the title with it.
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
      className="tsk-title"
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
        blocked={isTaskBlocked(row)}
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
        {/* minWidth 0 is load-bearing, not tidiness: without it this wrapper's
            automatic minimum is the chip's min-content (icon, level word,
            separator and the full 7.5rem of client name, 204px measured), the
            chip's own maxWidth 100% resolves against that floor and never
            clamps, and a Task cell at its own 12rem minimum gets an
            overflowing chip instead of an ellipsed client name. */}
        <span style={{ display: 'inline-flex', minWidth: 0, opacity: done ? 0.7 : 1 }}>
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

/** `completedAt` is a full UTC instant, unlike `dueDate`, which is already a
 *  local calendar day. `formatDueDateLabel` slices the first ten characters
 *  and reads them as a local day, so handing it the raw timestamp prints the
 *  UTC date: a task ticked at 10am in Auckland would read as the day before.
 *  Convert to the reader's own day first, and fall back to the bare `Done`
 *  when the value is not a date at all. */
function completedDayKey(completedAt: string | null): string | null {
  if (!completedAt) return null
  const at = new Date(completedAt)
  if (Number.isNaN(at.getTime())) return null
  return taskDayKey(at)
}

function DueCell({ row }: { row: TaskRow }) {
  if (isDone(row)) {
    const label = formatDueDateLabel(completedDayKey(row.completedAt))
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

// ── Checklist panel ─────────────────────────────────────────────────────────

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
  onRemove,
}: {
  table: DataTableExpandedContext
  subtask: TaskSubtask
  readOnly: boolean
  onToggle: () => void
  /** Optional: the panel is one-way without it, and removal then lives only
   *  in the detail slide-over. See the note on `TasksListProps`. */
  onRemove?: () => void
}) {
  return (
    <PanelRow table={table}>
      <div
        className={`flex items-center min-h-11 md:min-h-10 ${subtaskIndentClass(table.leadingCells)}`}
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
        {!readOnly && onRemove && (
          <button
            type="button"
            aria-label={`Remove checklist item ${subtask.title}`}
            className="tahi-focus-ring inline-flex items-center justify-center w-11 h-11 md:w-[1.625rem] md:h-[1.625rem]"
            onClick={e => { e.stopPropagation(); onRemove() }}
            style={{
              flexShrink: 0,
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              background: 'transparent',
              color: 'var(--color-text-subtle)',
              cursor: 'pointer',
              transition: 'color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = 'var(--color-danger)'
              e.currentTarget.style.background = 'var(--color-danger-bg)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = 'var(--color-text-subtle)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <X size={13} strokeWidth={2.4} aria-hidden="true" />
          </button>
        )}
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
            className={`flex items-center min-h-11 md:min-h-10 ${subtaskIndentClass(table.leadingCells)}`}
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
  const { showToast } = useToast()
  const [adding, setAdding] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const mountedRef = React.useRef(true)
  // Read by the blur handler, which can fire inside the same commit that set
  // the flag, before React has handed that handler the new props.
  const savingRef = React.useRef(false)

  React.useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  async function commit() {
    const title = draft.trim()
    if (!title || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      await onAddSubtask(taskId, title)
      // The field stays open and empty: naming three checklist items in a row
      // is the normal case, and reopening it each time is three extra clicks.
      if (mountedRef.current) setDraft('')
    } catch {
      // The draft stays in the field on purpose, the same bargain the
      // quick-add strikes: retrying is one keypress, retyping is not.
      if (mountedRef.current) showToast("Couldn't add the checklist item", 'error')
    } finally {
      savingRef.current = false
      if (mountedRef.current) setSaving(false)
    }
  }

  if (adding) {
    return (
      <PanelRow table={table}>
        <div
          className={`flex items-center min-h-11 md:min-h-10 ${subtaskIndentClass(table.leadingCells)}`}
          style={{ gap: '0.5rem', paddingRight: '1rem', paddingTop: '0.375rem', paddingBottom: '0.5rem' }}
        >
          <input
            autoFocus
            value={draft}
            // readOnly, not disabled: disabling a focused input runs the
            // unfocusing steps, so the browser fires blur at the row that is
            // mid-write and the cancel below would collapse it. readOnly
            // freezes the text and keeps the caret exactly where it was.
            readOnly={saving}
            aria-busy={saving}
            aria-label="New checklist item"
            placeholder="Name a checklist item, press Enter"
            className="tahi-focus-ring"
            onChange={e => setDraft(e.target.value)}
            onBlur={() => {
              if (savingRef.current) return
              setAdding(false)
              setDraft('')
            }}
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
        className={`tahi-focus-ring flex items-center w-full min-h-11 md:min-h-10 ${subtaskIndentClass(table.leadingCells)}`}
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
        Add checklist item
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
          blocked={isTaskBlocked(row)}
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
    onToggleSubtask, onAddSubtask, onRemoveSubtask, onQuickAdd,
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

  // Counts travel on the row itself, so a row that has none already answers
  // the question the fetch would have asked. That matters most under Expand
  // all, which opens every row on the page at once: without this it would be
  // one round trip per row, up to a hundred at the largest page size.
  const subtaskCounts = React.useMemo(() => {
    const counts = new Map<string, number>()
    rows.forEach(r => counts.set(r.id, subtaskTotal(r)))
    return counts
  }, [rows])

  const handleExpandedChange = React.useCallback((next: Set<string>) => {
    next.forEach(id => {
      if (requestedRef.current.has(id)) return
      if ((subtaskCounts.get(id) ?? 0) === 0) return
      requestedRef.current.add(id)
      onExpandRow(id)
    })
    setExpandedIds(next)
  }, [onExpandRow, subtaskCounts])

  // A row whose count was zero never asked for its list, so after the first
  // subtask lands it has to ask now, or the panel would sit on a skeleton
  // with nothing on the way.
  const handleAddSubtask = React.useCallback(async (taskId: string, title: string) => {
    await onAddSubtask(taskId, title)
    requestedRef.current.add(taskId)
    onExpandRow(taskId)
  }, [onAddSubtask, onExpandRow])

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
      // A real table, not the prototype's grid, so `minmax(0, 2.2fr)` becomes
      // the table idiom for the same thing: the fixed columns below take what
      // they need and this one, left at `auto`, absorbs every remaining pixel.
      // It must NOT be given `width: '100%'`: with the cell's inline-size
      // containment contributing nothing intrinsic, a percentage width sends
      // the auto table layout to its 1,000,000px ceiling and the other four
      // columns land a screen away (measured live on the QA server). A floor
      // keeps the title readable when the table is narrow.
      minWidth: '12rem',
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

  // ── Expanded checklist rows ───────────────────────────────────────────────

  const renderSubtaskRows = React.useCallback((row: TaskRow, table: DataTableExpandedContext) => {
    // No entry yet AND a zero count is the empty case, not the loading one:
    // the row already carries the answer, so nothing was ever requested and
    // a skeleton would be waiting on a fetch that is not coming.
    const list = subtasks[row.id] ?? (subtaskTotal(row) === 0 ? NO_SUBTASKS : undefined)
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
            onRemove={onRemoveSubtask ? () => onRemoveSubtask(row.id, sub.id) : undefined}
          />
        ))}
        {list.length === 0 && (
          <PanelRow table={table}>
            <span
              className={subtaskIndentClass(table.leadingCells)}
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
              No checklist items yet.
            </span>
          </PanelRow>
        )}
        {!readOnly && (
          <AddSubtaskRow table={table} taskId={row.id} onAddSubtask={handleAddSubtask} />
        )}
      </>
    )
  }, [subtasks, readOnly, onToggleSubtask, onRemoveSubtask, handleAddSubtask])

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
          expandAllLabel="checklist items"
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
