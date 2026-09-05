'use client'

/**
 * <TaskDetailPanel>. The task detail, as a right-hand <SlideOver> opened from
 * whichever view you were in. There is no separate detail page: /tasks/[id]
 * redirects here, so a notification link and a row click land in the same
 * place.
 *
 * Everything edits in place. There is no save button, because there is
 * nothing here worth staging: every field is one write, and the list
 * underneath updates as you go.
 *
 * The panel stays mounted when you follow a blocker: only the task id
 * changes, so the whole body remounts on its key and no stale editor state
 * survives the swap. `contentKey` on the SlideOver re-runs focus-into-panel
 * at the same moment, so the keyboard follows the body.
 *
 * The three link rows (level, client, request) never write a raw value: they
 * run through lib/task-consistency.ts, which is the one place the invariants
 * between them live.
 */

import * as React from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Eye,
  Inbox,
  Link2,
  ListChecks,
  MoreHorizontal,
  Plus,
  Tag,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { SlideOver } from '@/components/tahi/slide-over'
import { SidebarCard } from '@/components/tahi/rail/sidebar-card'
import {
  InlineDateField,
  InlineMenuField,
  InlineNone,
  InlineNumberField,
  type InlineMenuOption,
} from '@/components/tahi/inline-field'
import { StatusChipSelect } from '@/components/tahi/status-chip-select'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import { TimeCard } from '@/components/tahi/time-card'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { Menu } from '@/components/tahi/menu'
import { Badge, priorityTone } from '@/components/tahi/badge'
import { Avatar } from '@/components/tahi/avatar'
import { TahiButton } from '@/components/tahi/tahi-button'
import { DueDateChip } from '@/components/tahi/due-date-chip'
import { useToast } from '@/components/tahi/toast'
import { CATEGORY_CONFIG, TASK_CLOSED_STATUSES, TASK_STATUSES } from '@/lib/status-config'
import { TASK_PRIORITIES, taskPriorityLabel } from '@/lib/task-priorities'
import { formatHours } from '@/lib/tasks-planner'
import {
  setTaskClient,
  setTaskLevel,
  setTaskRequest,
  type TaskLinkState,
} from '@/lib/task-consistency'
import {
  TASK_LEVELS,
  TASK_LEVEL_HINTS,
  levelOf,
  type TaskLevel,
  type TaskRow,
} from '@/lib/tasks-views'
import {
  LEVEL_ICON,
  LevelChip,
  RequestChip,
  TaskStatusBadge,
  TaskTick,
} from '@/components/tahi/tasks/task-chips'
// All five come from Slice 1's shared module, never from a sibling leaf.
import type {
  TaskSubtask,
  TaskPerson,
  TaskClientOption,
  TaskRequestOption,
  TaskDependencyRow,
} from '@/components/tahi/tasks/task-types'

export interface TaskDetailPanelProps {
  open: boolean
  onClose: () => void
  /** Null while the shell is still fetching a deep-linked task. */
  task: TaskRow | null
  loading: boolean
  readOnly: boolean

  clients: readonly TaskClientOption[]
  peopleList: readonly TaskPerson[]
  people: Readonly<Record<string, TaskPerson>>
  /** Every request the studio could link, unfiltered. The panel narrows it
   *  to the task's client itself. */
  requests: readonly TaskRequestOption[]

  subtasks: readonly TaskSubtask[] | undefined
  blockedBy: readonly TaskDependencyRow[] | undefined
  /** Candidates for the add-dependency picker: every other open task. */
  blockerCandidates: readonly { id: string; title: string }[]

  /**
   * One patch per edit. The shell makes it optimistic.
   *
   * Two keys the shell owes the API that this panel cannot carry, because
   * `Partial<TaskRow>` has no field for either. Both are wiring work for the
   * slice that mounts this panel, and both are silent data bugs if missed:
   *
   * - `type`. The Level control patches `{ type }` alongside `orgId` and
   *   `requestId`, but PATCH /api/admin/tasks/[id] has no `type` in its body
   *   allowlist, so changing Client to Tahi clears the links and leaves the
   *   stored level untouched. The route needs `type`, validated through
   *   `isTaskLevel`.
   * - `assigneeType`. See the note on the Assignee row: the route already
   *   accepts the key, and only ever writes it when it is present.
   */
  onPatch: (taskId: string, patch: Partial<TaskRow>) => Promise<void>
  onDelete: (taskId: string) => Promise<void>
  onDuplicate: (taskId: string) => Promise<void>
  onPromote: (taskId: string, input: { category: string; size: 'small_task' | 'large_task' }) => Promise<void>

  onAddSubtask: (taskId: string, title: string) => Promise<void>
  onToggleSubtask: (taskId: string, subtaskId: string, completed: boolean) => Promise<void>
  onDeleteSubtask: (taskId: string, subtaskId: string) => Promise<void>

  onAddBlocker: (taskId: string, blockerTaskId: string) => Promise<void>
  onRemoveBlocker: (taskId: string, depId: string) => Promise<void>

  /** Follow a blocker without closing: the shell just changes the selection. */
  onOpenTask: (taskId: string) => void
  onOpenRequest: (requestId: string) => void
}

// ---- Shared bits -------------------------------------------------------------

/** The repo's reference for a request, everywhere: #042, never TR-0042. */
function requestRef(requestNumber: number | null | undefined): string {
  return requestNumber != null ? `#${String(requestNumber).padStart(3, '0')}` : 'the request'
}

/** Standard is the resting state and earns no chip, the way the requests
 *  list reads it. Local rather than shared because every surface in the repo
 *  carries its own (request-list, kanban-board, the legacy tasks page). */
function PriorityBadge({ priority }: { priority: string }) {
  if (priority === 'standard') return null
  return (
    <Badge tone={priorityTone(priority)} variant="soft" size="sm" leader="icon" icon={<Zap size={10} />}>
      {taskPriorityLabel(priority)}
    </Badge>
  )
}

function PersonInline({ person }: { person: TaskPerson }) {
  return (
    <span className="inline-flex items-center" style={{ gap: '0.375rem', minWidth: 0 }}>
      <Avatar name={person.name} src={person.avatarUrl ?? undefined} size={18} noRing tooltip={false} />
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {person.name}
      </span>
    </span>
  )
}

/**
 * One row of the Links or Details card: a fixed key column and the value hard
 * right. Same rhythm as the request detail's own rows, drawn here rather than
 * imported because that copy is local to a page component.
 *
 * `stack` puts the label above a full-width value instead. The Level control
 * is three labelled buttons, which cannot share a 35rem panel with a 5.25rem
 * key column at 375px without pushing the panel sideways.
 */
function DetailRow({
  label,
  stack = false,
  children,
}: {
  label: string
  stack?: boolean
  children: React.ReactNode
}) {
  if (stack) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', padding: '0.375rem 0' }}>
        <span style={{ fontSize: '0.78125rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
          {label}
        </span>
        <span style={{ display: 'block', minWidth: 0 }}>{children}</span>
      </div>
    )
  }

  return (
    <div className="flex items-center" style={{ gap: '0.625rem', padding: '0.375rem 0', minHeight: '2.25rem' }}>
      <span
        className="flex-shrink-0"
        style={{ width: '5.25rem', fontSize: '0.78125rem', fontWeight: 500, color: 'var(--color-text-muted)' }}
      >
        {label}
      </span>
      <span
        className="flex items-center justify-end text-right"
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          gap: '0.4375rem',
          fontSize: '0.78125rem',
          fontWeight: 600,
          color: 'var(--color-text)',
        }}
      >
        {children}
      </span>
    </div>
  )
}

const PANEL_CSS = `
.tskd-title{
  flex: 1;
  min-width: 0;
  width: 100%;
  margin: 0;
  padding: 0.25rem 0.375rem;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: none;
  font-family: inherit;
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: -0.01em;
  color: var(--color-text);
  resize: none;
  overflow: hidden;
  transition:
    border-color var(--motion-quick) var(--ease-out),
    background-color var(--motion-quick) var(--ease-out);
}
.tskd-title:hover{ background: var(--color-bg-secondary); }
.tskd-title:focus{
  outline: none;
  border-color: var(--focus-ring-color);
  background: var(--color-bg);
  box-shadow: var(--focus-ring);
}
.tskd-title::placeholder{ color: var(--color-text-subtle); font-weight: 600; }
.tskd-title.is-done{ color: var(--color-text-subtle); text-decoration: line-through; }
.tskd-title:read-only{ cursor: default; }
.tskd-title:read-only:hover{ background: none; }

.tskd-desc{
  width: 100%;
  min-height: 5rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
  font-family: inherit;
  font-size: 0.84375rem;
  font-weight: 400;
  line-height: 1.6;
  color: var(--color-text);
  resize: vertical;
  transition:
    border-color var(--motion-quick) var(--ease-out),
    background-color var(--motion-quick) var(--ease-out);
}
.tskd-desc::placeholder{ color: var(--color-text-subtle); }
.tskd-desc:hover{ border-color: var(--color-border); }
.tskd-desc:focus{
  outline: none;
  border-color: var(--focus-ring-color);
  background: var(--color-bg);
  box-shadow: var(--focus-ring);
}
.tskd-desc:read-only:hover{ border-color: var(--color-border-subtle); }

/* The quiet head action every card shares: add a subtask, open the menu. */
.tskd-head-action{
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-subtle);
  cursor: pointer;
  transition:
    color var(--motion-quick) var(--ease-out),
    background-color var(--motion-quick) var(--ease-out);
}
.tskd-head-action:hover,
.tskd-head-action:focus-visible{ color: var(--color-text); background: var(--color-bg-secondary); }

.tskd-x{
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-subtle);
  cursor: pointer;
  transition:
    color var(--motion-quick) var(--ease-out),
    background-color var(--motion-quick) var(--ease-out);
}
.tskd-x:hover,
.tskd-x:focus-visible{ color: var(--color-danger); background: var(--color-danger-bg); }

/* Follow a blocker. Quiet until you reach for it. */
.tskd-open{
  padding: 0.125rem 0.375rem;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-brand-dark);
  cursor: pointer;
  transition: background-color var(--motion-quick) var(--ease-out);
}
.tskd-open:hover,
.tskd-open:focus-visible{ background: var(--color-bg-secondary); }

.tskd-sub{
  display: flex;
  align-items: center;
  gap: 0.625rem;
  flex: 1;
  min-width: 0;
  padding: 0.4375rem 0;
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tskd-sub-box{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 1.125rem;
  height: 1.125rem;
  border: 0.09375rem solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg);
  color: transparent;
  transition:
    background-color var(--motion-quick) var(--ease-out),
    border-color var(--motion-quick) var(--ease-out),
    color var(--motion-quick) var(--ease-out);
}
.tskd-sub.is-done .tskd-sub-box{
  background: var(--color-brand);
  border-color: var(--color-brand);
  color: var(--color-text-on-dark);
}
.tskd-sub:hover .tskd-sub-box,
.tskd-sub:focus-visible .tskd-sub-box{ border-color: var(--color-brand); }
.tskd-sub-label{
  min-width: 0;
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.4;
  color: var(--color-text);
  transition: color var(--motion-quick) var(--ease-out);
}
.tskd-sub.is-done .tskd-sub-label{ color: var(--color-text-subtle); text-decoration: line-through; }

.tskd-input{
  min-width: 0;
  width: 100%;
  height: 2.75rem;
  padding: 0 0.5625rem;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  font-family: inherit;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-text);
  outline: none;
  transition:
    border-color var(--motion-quick) var(--ease-out),
    box-shadow var(--motion-quick) var(--ease-out);
}
@media (min-width: 48rem){ .tskd-input{ height: 2rem; } }
.tskd-input::placeholder{ color: var(--color-text-subtle); }
.tskd-input:focus{
  border-color: var(--focus-ring-color);
  box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce){
  .tskd-title,
  .tskd-desc,
  .tskd-head-action,
  .tskd-x,
  .tskd-open,
  .tskd-sub-box,
  .tskd-sub-label,
  .tskd-input{ transition: none; }
}
`

// ---- Panel -------------------------------------------------------------------

type ConfirmKind = 'delete' | 'promote'

export function TaskDetailPanel(props: TaskDetailPanelProps): React.ReactElement {
  const { open, onClose, task, loading, readOnly, onDelete, onPromote } = props
  const [confirm, setConfirm] = React.useState<ConfirmKind | null>(null)

  const taskId = task?.id ?? null
  // Following a blocker swaps the whole body. A confirm raised against the
  // task you just left must not survive into the one you landed on.
  React.useEffect(() => { setConfirm(null) }, [taskId])

  const level: TaskLevel = task ? levelOf(task) : 'tahi_internal'
  const LevelGlyph = LEVEL_ICON[level]
  const clientName = task?.orgId
    ? (props.clients.find(c => c.id === task.orgId)?.name ?? task.orgName ?? 'the client')
    : 'the client'

  return (
    <>
      <SlideOver
        open={open}
        onClose={onClose}
        variant="right"
        maxWidth="35rem"
        title="Task"
        icon={<LevelGlyph size={15} aria-hidden />}
        ariaLabel="Task detail"
        contentKey={task?.id ?? 'none'}
      >
        <style>{PANEL_CSS}</style>
        {task ? (
          <TaskDetailBody
            key={task.id}
            {...props}
            task={task}
            level={level}
            onRequestConfirm={setConfirm}
          />
        ) : (
          <SlideOver.Body>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-subtle)' }}>
              {loading ? 'Loading this task…' : 'That task is no longer here.'}
            </p>
          </SlideOver.Body>
        )}
      </SlideOver>

      {/* Both confirms are siblings of the drawer rather than children of it,
          so the drawer's own Tab trap never competes with theirs. Escape is
          settled by the shared overlay stack: the topmost layer answers. */}
      <ConfirmDialog
        open={confirm === 'delete' && !!task && !readOnly}
        title="Delete this task?"
        description="It goes for good, along with its subtasks and its logged time."
        confirmLabel="Delete"
        variant="danger"
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          if (!task) return
          try {
            await onDelete(task.id)
            setConfirm(null)
          } catch {
            // The shell reports the failure. Leaving the confirm open keeps
            // the action one click away rather than pretending it happened.
          }
        }}
      />

      {/* The promote confirm needs a stacking context of its own. A centred
          <SlideOver> splits into a backdrop at z-index 60 and a frame at 70,
          while the drawer's panel is also 70 and sits earlier in the DOM, so
          the drawer would paint above the confirm's scrim: the confirm would
          be modal by declaration and the drawer behind it would still take
          clicks. At 375px the drawer is full width, so every tap outside the
          centred panel would edit the task instead of dismissing. This
          wrapper is a zero-height positioned box, which is enough to contain
          both fixed layers and put them above 70. <ConfirmDialog> above needs
          nothing of the sort: it is one z-70 element that is its own scrim. */}
      <div style={{ position: 'relative', zIndex: 80 }}>
        <PromoteDialog
          open={confirm === 'promote' && !!task && !readOnly}
          clientName={clientName}
          onCancel={() => setConfirm(null)}
          onConfirm={async input => {
            if (!task) return
            try {
              await onPromote(task.id, input)
              setConfirm(null)
            } catch {
              // Same rule as the delete confirm: the shell owns the message,
              // and the dialog keeps the choices the user already made.
            }
          }}
        />
      </div>
    </>
  )
}

// ---- Body --------------------------------------------------------------------

interface TaskDetailBodyProps extends Omit<TaskDetailPanelProps, 'task'> {
  task: TaskRow
  level: TaskLevel
  onRequestConfirm: (kind: ConfirmKind) => void
}

function TaskDetailBody({
  task,
  level,
  readOnly,
  clients,
  peopleList,
  people,
  requests,
  subtasks,
  blockedBy,
  blockerCandidates,
  onPatch,
  onDuplicate,
  onAddSubtask,
  onToggleSubtask,
  onDeleteSubtask,
  onAddBlocker,
  onRemoveBlocker,
  onOpenTask,
  onOpenRequest,
  onRequestConfirm,
}: TaskDetailBodyProps): React.ReactElement {
  const { showToast } = useToast()
  const titleRef = React.useRef<HTMLTextAreaElement | null>(null)
  const [titleDraft, setTitleDraft] = React.useState(task.title)
  const [descDraft, setDescDraft] = React.useState(task.description ?? '')
  const [addingSubtask, setAddingSubtask] = React.useState(false)
  const [subtaskDraft, setSubtaskDraft] = React.useState('')

  const done = task.status === 'done'
  const linkedRequest = task.requestId ? requests.find(r => r.id === task.requestId) ?? null : null
  const canPromote = !task.requestId && task.type !== 'tahi_internal' && !!task.orgId
  const clientName = task.orgId
    ? (clients.find(c => c.id === task.orgId)?.name ?? task.orgName ?? null)
    : null

  /**
   * Every write goes through here. The shell owns the optimistic update, the
   * rollback and the failure toast, so this only has to make sure a rejected
   * promise never escapes into an unhandled rejection.
   */
  const patch = React.useCallback((next: Partial<TaskRow>) => {
    void onPatch(task.id, next).catch(() => undefined)
  }, [onPatch, task.id])

  // The parent can update the row underneath an open panel (a refetch, an
  // optimistic patch from the list). Take the new value unless the field is
  // the one being typed in.
  React.useEffect(() => {
    if (document.activeElement === titleRef.current) return
    setTitleDraft(task.title)
  }, [task.title])

  React.useEffect(() => {
    setDescDraft(current => (current === (task.description ?? '') ? current : task.description ?? ''))
  }, [task.description])

  // Auto-grow: reset to auto first, or the box can only ever get taller.
  React.useEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [titleDraft])

  function commitTitle() {
    const next = titleDraft.trim()
    if (!next) {
      setTitleDraft(task.title)
      return
    }
    if (next !== task.title) patch({ title: next })
  }

  function commitDescription() {
    const next = descDraft.trim() ? descDraft : ''
    const current = task.description ?? ''
    if (next === current) return
    patch({ description: next ? next : null })
  }

  function setStatus(next: string): Promise<void> {
    return onPatch(task.id, {
      status: next,
      completedAt: next === 'done' ? new Date().toISOString() : null,
    })
  }

  // ---- Links -----------------------------------------------------------------

  const linkState: TaskLinkState = { level, orgId: task.orgId, requestId: task.requestId }

  function applyLinks(next: TaskLinkState) {
    if (next.level === level && next.orgId === task.orgId && next.requestId === task.requestId) return
    const orgName = next.orgId
      ? (clients.find(c => c.id === next.orgId)?.name ?? (next.orgId === task.orgId ? task.orgName : null))
      : null
    patch({ type: next.level, orgId: next.orgId, requestId: next.requestId, orgName })
  }

  const clientOptions: InlineMenuOption[] = [
    { value: 'none', label: 'No client' },
    ...clients.map(c => ({
      value: c.id,
      label: c.name,
      keywords: c.name,
      node: (
        <span className="inline-flex items-center" style={{ gap: '0.375rem', minWidth: 0 }}>
          <Avatar name={c.name} size={18} noRing tooltip={false} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.name}
          </span>
        </span>
      ),
    })),
  ]

  const linkableRequests = requests.filter(r => !task.orgId || r.orgId === task.orgId)
  const requestOptions: InlineMenuOption[] = [
    { value: 'none', label: 'Not linked' },
    ...linkableRequests.map(r => {
      const label = `${requestRef(r.requestNumber)} ${r.title}`
      return { value: r.id, label, keywords: label }
    }),
  ]

  const assigneeOptions: InlineMenuOption[] = [
    ...peopleList.map(p => ({
      value: p.id,
      label: p.name,
      keywords: p.name,
      node: <PersonInline person={p} />,
    })),
    { value: 'none', label: 'Unassigned' },
  ]

  // ---- Blockers --------------------------------------------------------------

  const blockers = blockedBy ?? []
  const blockedIds = new Set(blockers.map(b => b.taskId))
  const blockerOptions: InlineMenuOption[] = blockerCandidates
    .filter(c => c.id !== task.id && !blockedIds.has(c.id))
    .map(c => ({ value: c.id, label: c.title, keywords: c.title }))

  async function addBlocker(blockerTaskId: string) {
    try {
      await onAddBlocker(task.id, blockerTaskId)
    } catch (err) {
      const message = err instanceof Error ? err.message.toLowerCase() : ''
      showToast(
        message.includes('circular') || message.includes('loop') || message.includes('cycle')
          ? 'That would make a loop'
          : 'Could not add that blocker',
        'error',
      )
    }
  }

  // ---- Subtasks --------------------------------------------------------------

  const subtaskRows = subtasks ?? []
  const subtaskTotal = subtaskRows.length
  const subtaskDone = subtaskRows.filter(s => s.completed).length
  const subtaskProgress = subtaskTotal > 0 ? Math.round((subtaskDone / subtaskTotal) * 100) : 0

  function submitSubtask() {
    const title = subtaskDraft.trim()
    if (!title) return
    setSubtaskDraft('')
    void onAddSubtask(task.id, title).catch(() => undefined)
  }

  return (
    <>
      <SlideOver.Body
        style={{
          padding: '1rem 1.125rem 1.5rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {/* Tools. The status chip is the one control worth a permanent seat;
            everything rarer sits behind the menu beside it. */}
        <div className="flex items-center" style={{ gap: '0.5rem' }}>
          <StatusChipSelect
            value={task.status}
            options={TASK_STATUSES}
            onChange={next => setStatus(next).catch(() => undefined)}
            disabled={readOnly}
            density="compact"
            aria-label="Change task status"
          />
          {!readOnly && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
              <Menu
                align="end"
                width="14.75rem"
                trigger={
                  <button
                    type="button"
                    aria-label="Task actions"
                    title="Task actions"
                    className="tskd-head-action tahi-focus-ring inline-flex items-center justify-center h-11 w-11 md:h-8 md:w-8"
                  >
                    <MoreHorizontal size={17} aria-hidden="true" />
                  </button>
                }
              >
                <Menu.Item icon={<Copy size={14} />} onClick={() => { void onDuplicate(task.id).catch(() => undefined) }}>
                  Duplicate
                </Menu.Item>
                {canPromote && (
                  <Menu.Item icon={<Inbox size={14} />} onClick={() => onRequestConfirm('promote')}>
                    Create request from task
                  </Menu.Item>
                )}
                <Menu.Divider />
                <Menu.Item icon={<Trash2 size={14} />} tone="danger" onClick={() => onRequestConfirm('delete')}>
                  Delete
                </Menu.Item>
              </Menu>
            </span>
          )}
        </div>

        {/* Head: the tick, then the title as an auto-growing textarea. */}
        <div className="flex" style={{ alignItems: 'flex-start', gap: '0.75rem' }}>
          <span style={{ marginTop: '0.375rem', display: 'inline-flex' }}>
            <TaskTick
              done={done}
              blocked={task.status === 'blocked' || (task.blockedByCount ?? 0) > 0}
              size="lg"
              disabled={readOnly}
              title={task.title}
              onToggle={() => { void setStatus(done ? 'todo' : 'done').catch(() => undefined) }}
            />
          </span>
          <textarea
            ref={titleRef}
            rows={1}
            value={titleDraft}
            readOnly={readOnly}
            aria-label="Task title"
            placeholder="What needs doing?"
            className={done ? 'tskd-title is-done' : 'tskd-title'}
            onChange={e => setTitleDraft(e.target.value.replace(/\n/g, ''))}
            onBlur={commitTitle}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                e.currentTarget.blur()
              }
            }}
          />
        </div>

        {/* Meta. Everything the row already told you, restated where the
            editing happens. */}
        <div className="flex items-center flex-wrap" style={{ gap: '0.5rem', paddingLeft: '2.25rem' }}>
          <LevelChip level={level} clientName={clientName} />
          {task.requestId && (
            <RequestChip
              requestId={task.requestId}
              requestNumber={linkedRequest?.requestNumber ?? null}
              onOpen={onOpenRequest}
            />
          )}
          <PriorityBadge priority={task.priority} />
          {task.dueDate && !done && (
            <DueDateChip dueDate={task.dueDate} status={task.status} closedStatuses={TASK_CLOSED_STATUSES} />
          )}
          {readOnly && (
            <span
              className="inline-flex items-center"
              style={{ gap: '0.375rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}
            >
              <Eye size={13} aria-hidden="true" />
              Read-only
            </span>
          )}
        </div>

        {/* The one leaf radius on this surface besides the New task button: it
            marks the single place work crossed a boundary. */}
        {task.requestId && level === 'client_task' && (
          <div
            className="flex"
            style={{
              alignItems: 'flex-start',
              gap: '0.625rem',
              padding: '0.75rem 0.875rem',
              border: '1px solid var(--color-brand)',
              borderRadius: 'var(--radius-leaf)',
              background: 'color-mix(in srgb, var(--color-brand) 7%, var(--color-bg))',
              fontSize: '0.78125rem',
              fontWeight: 500,
              lineHeight: 1.5,
              color: 'var(--color-text-muted)',
            }}
          >
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center flex-shrink-0"
              style={{
                width: '1.625rem',
                height: '1.625rem',
                borderRadius: '0 0.5rem 0 0.5rem',
                background: 'var(--color-brand)',
                color: 'var(--color-text-on-dark)',
              }}
            >
              <Inbox size={14} />
            </span>
            <span>
              This task is linked to{' '}
              <b style={{ color: 'var(--color-brand-dark)', fontWeight: 700 }}>
                {requestRef(linkedRequest?.requestNumber ?? null)}
              </b>
              . The request carries the client conversation, files and delivery. The task stays here for your own
              follow-ups.
            </span>
          </div>
        )}

        <textarea
          className="tskd-desc"
          value={descDraft}
          readOnly={readOnly}
          aria-label="Description"
          placeholder="Add a note: what good looks like, links, who to ask."
          onChange={e => setDescDraft(e.target.value)}
          onBlur={commitDescription}
        />

        {/* 1. Waiting on. */}
        {(blockers.length > 0 || !readOnly) && (
          <SidebarCard
            title="Waiting on"
            icon={<AlertTriangle size={14} />}
            count={blockers.length > 0 ? blockers.length : undefined}
          >
            {blockers.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
                Nothing is holding this up.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                {blockers.map(b => (
                  <div
                    key={b.depId}
                    className="flex items-center"
                    style={{ gap: '0.5rem', padding: '0.25rem 0', fontSize: '0.78125rem' }}
                  >
                    <TaskStatusBadge status={b.taskStatus} />
                    <span
                      className="truncate"
                      style={{ flex: 1, minWidth: 0, fontWeight: 600, color: 'var(--color-text)' }}
                      title={b.taskTitle}
                    >
                      {b.taskTitle}
                    </span>
                    <button
                      type="button"
                      className="tskd-open tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 min-h-11 md:min-h-6"
                      onClick={() => onOpenTask(b.taskId)}
                    >
                      Open
                    </button>
                    {!readOnly && (
                      <button
                        type="button"
                        className="tskd-x tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-6 md:w-6"
                        aria-label={`Stop waiting on ${b.taskTitle}`}
                        title="Remove blocker"
                        onClick={() => { void onRemoveBlocker(task.id, b.depId).catch(() => undefined) }}
                      >
                        <X size={13} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!readOnly && blockerOptions.length > 0 && (
              <div className="flex items-center" style={{ marginTop: blockers.length > 0 ? '0.375rem' : '0.5rem' }}>
                <InlineMenuField
                  value="none"
                  options={blockerOptions}
                  onChange={next => { void addBlocker(next) }}
                  renderValue={() => (
                    <span
                      className="inline-flex items-center"
                      style={{ gap: '0.375rem', color: 'var(--color-text-muted)', fontWeight: 600 }}
                    >
                      <Plus size={13} aria-hidden="true" />
                      Add blocker
                    </span>
                  )}
                  ariaLabel="Add a blocker"
                  searchable
                  searchPlaceholder="Search tasks…"
                  emptyMessage="No other open task to wait on"
                  width="18rem"
                />
              </div>
            )}
          </SidebarCard>
        )}

        {/* 2. Links. */}
        <SidebarCard title="Links" icon={<Link2 size={14} />} bodyPadding="0.5rem 0.875rem 0.625rem">
          <DetailRow label="Level" stack>
            {readOnly ? (
              <LevelChip level={level} clientName={clientName} />
            ) : (
              <SegmentedControl
                value={level}
                onChange={next => applyLinks(setTaskLevel(linkState, next))}
                role="radiogroup"
                size="sm"
                fill
                ariaLabel="Level"
                options={TASK_LEVELS.map(l => {
                  const Glyph = LEVEL_ICON[l.value]
                  return {
                    value: l.value,
                    label: l.label,
                    title: l.hint,
                    icon: <Glyph size={12} aria-hidden />,
                  }
                })}
              />
            )}
          </DetailRow>

          <DetailRow label="Client">
            <InlineMenuField
              value={task.orgId ?? 'none'}
              options={clientOptions}
              readOnly={readOnly}
              searchable
              searchPlaceholder="Search clients…"
              ariaLabel="Link a client"
              onChange={next => {
                const orgId = next === 'none' ? null : next
                applyLinks(setTaskClient(linkState, orgId, linkedRequest?.orgId ?? null))
              }}
              renderValue={value => {
                const client = clients.find(c => c.id === value)
                if (!client) return <InlineNone>No client</InlineNone>
                return (
                  <span className="inline-flex items-center" style={{ gap: '0.375rem', minWidth: 0 }}>
                    <Avatar name={client.name} size={18} noRing tooltip={false} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {client.name}
                    </span>
                  </span>
                )
              }}
            />
          </DetailRow>

          <DetailRow label="Request">
            <InlineMenuField
              value={task.requestId ?? 'none'}
              options={requestOptions}
              readOnly={readOnly}
              searchable
              searchPlaceholder="Search requests…"
              ariaLabel="Link a request"
              width="20rem"
              onChange={next => {
                const picked = next === 'none' ? null : requests.find(r => r.id === next) ?? null
                applyLinks(setTaskRequest(linkState, picked))
              }}
              renderValue={value => {
                const request = requests.find(r => r.id === value)
                if (!request) return <InlineNone>Not linked</InlineNone>
                return <span>{requestRef(request.requestNumber)}</span>
              }}
            />
          </DetailRow>

          <p
            style={{
              margin: '0.5rem 0 0',
              fontSize: '0.71875rem',
              fontWeight: 500,
              lineHeight: 1.45,
              color: 'var(--color-text-subtle)',
            }}
          >
            {TASK_LEVEL_HINTS[level]}
          </p>
        </SidebarCard>

        {/* 3. Details. */}
        <SidebarCard title="Details" icon={<Tag size={14} />} bodyPadding="0.25rem 0.875rem">
          <DetailRow label="Assignee">
            <InlineMenuField
              value={task.assigneeId ?? 'none'}
              options={assigneeOptions}
              readOnly={readOnly}
              searchable
              searchPlaceholder="Search people…"
              ariaLabel="Change assignee"
              // WIRING CONTRACT, and the one thing on this surface that
              // cannot be closed from inside this file. `tasks.assigneeType`
              // is a real column and PATCH /api/admin/tasks/[id] routes the
              // assignment notification off it, so a task last held by a
              // contact keeps assignee_type='contact' after a reassignment to
              // a team member and the notification is addressed to a contact
              // id that is really a teamMembers.id: it reaches nobody. Slice
              // 1's TaskRow carries no assigneeType, and this patch is pinned
              // to Partial<TaskRow>, so the pair cannot travel from here.
              // Slice 6's PATCH mapper MUST send assigneeType 'team_member'
              // alongside a non-null assigneeId, and null when clearing.
              onChange={next => {
                if (next === 'none') patch({ assigneeId: null })
                else patch({ assigneeId: next })
              }}
              renderValue={value => {
                const person = people[value]
                if (!person) return <InlineNone>Unassigned</InlineNone>
                return <PersonInline person={person} />
              }}
            />
          </DetailRow>

          <DetailRow label="Due">
            <InlineDateField
              value={task.dueDate ? task.dueDate.slice(0, 10) : null}
              readOnly={readOnly}
              ariaLabel="Change due date"
              onChange={next => patch({ dueDate: next })}
              render={value =>
                value
                  ? <DueDateChip dueDate={value} status={task.status} closedStatuses={TASK_CLOSED_STATUSES} />
                  : <InlineNone>No date</InlineNone>
              }
            />
          </DetailRow>

          <DetailRow label="Priority">
            <InlineMenuField
              value={task.priority}
              options={TASK_PRIORITIES.map(p => ({ value: p, label: taskPriorityLabel(p) }))}
              readOnly={readOnly}
              ariaLabel="Change priority"
              width="11rem"
              onChange={next => patch({ priority: next })}
              renderValue={value =>
                value === 'standard'
                  ? <InlineNone>Standard</InlineNone>
                  : <PriorityBadge priority={value} />
              }
            />
          </DetailRow>

          <DetailRow label="Estimate">
            <InlineNumberField
              value={task.estimatedHours}
              readOnly={readOnly}
              ariaLabel="Change the estimate in hours"
              suffix="h"
              min={0}
              step={0.25}
              onChange={next => patch({ estimatedHours: next })}
              render={value => (value ? <span>{formatHours(value)}</span> : <InlineNone>None</InlineNone>)}
            />
          </DetailRow>
        </SidebarCard>

        {/* 4. Subtasks. */}
        <SidebarCard
          title="Subtasks"
          icon={<ListChecks size={14} />}
          action={!readOnly && !addingSubtask ? (
            <button
              type="button"
              onClick={() => setAddingSubtask(true)}
              aria-label="Add subtask"
              title="Add subtask"
              className="tskd-head-action tahi-focus-ring inline-flex items-center justify-center h-11 w-11 md:h-6 md:w-6"
            >
              <Plus size={15} aria-hidden="true" />
            </button>
          ) : undefined}
        >
          {subtaskTotal > 0 && (
            <div className="flex items-center" style={{ gap: '0.5625rem', marginBottom: '0.375rem' }}>
              <div
                role="progressbar"
                aria-valuenow={subtaskProgress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Subtask progress"
                style={{
                  flex: 1,
                  height: '0.375rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-bg-secondary)',
                  overflow: 'hidden',
                }}
              >
                <span
                  style={{
                    display: 'block',
                    height: '100%',
                    width: `${subtaskProgress}%`,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-brand)',
                    transition: 'width 0.3s var(--ease-out)',
                  }}
                />
              </div>
              <span
                className="tabular-nums flex-shrink-0"
                style={{ fontSize: '0.71875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}
              >
                {subtaskDone}/{subtaskTotal}
              </span>
            </div>
          )}

          {subtaskTotal === 0 && !addingSubtask ? (
            <p style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 500, lineHeight: 1.55, color: 'var(--color-text-subtle)' }}>
              Break it down if it helps. Subtasks show as progress on the row.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
              {subtaskRows.map(s => (
                <div key={s.id} className="flex items-center" style={{ gap: '0.375rem' }}>
                  {readOnly ? (
                    <span
                      role="img"
                      aria-label={`${s.title}: ${s.completed ? 'completed' : 'not completed'}`}
                      className={s.completed ? 'tskd-sub is-done' : 'tskd-sub'}
                      style={{ cursor: 'default' }}
                    >
                      <span aria-hidden="true" className="tskd-sub-box">
                        <Check size={12} strokeWidth={3} />
                      </span>
                      <span className="tskd-sub-label">{s.title}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-pressed={s.completed}
                      aria-label={s.completed ? `Mark ${s.title} incomplete` : `Mark ${s.title} complete`}
                      className={`tskd-sub tahi-focus-ring min-h-11 md:min-h-0${s.completed ? ' is-done' : ''}`}
                      onClick={() => { void onToggleSubtask(task.id, s.id, !s.completed).catch(() => undefined) }}
                    >
                      <span aria-hidden="true" className="tskd-sub-box">
                        <Check size={12} strokeWidth={3} />
                      </span>
                      <span className="tskd-sub-label">{s.title}</span>
                    </button>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      className="tskd-x tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-6 md:w-6"
                      aria-label={`Remove ${s.title}`}
                      title="Remove subtask"
                      style={{ marginLeft: 'auto' }}
                      onClick={e => {
                        e.stopPropagation()
                        void onDeleteSubtask(task.id, s.id).catch(() => undefined)
                      }}
                    >
                      <X size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {addingSubtask && !readOnly && (
            <input
              type="text"
              className="tskd-input"
              autoFocus
              value={subtaskDraft}
              aria-label="New subtask"
              placeholder="Name the subtask, press Enter"
              style={{ marginTop: subtaskTotal > 0 ? '0.375rem' : '0.5rem' }}
              onChange={e => setSubtaskDraft(e.target.value)}
              onBlur={() => { setAddingSubtask(false); setSubtaskDraft('') }}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); submitSubtask() }
                if (e.key === 'Escape') { setAddingSubtask(false); setSubtaskDraft('') }
              }}
            />
          )}
        </SidebarCard>

        {/* 5. Time. The card owns the timer, the manual log and the entries. */}
        <TimeCard target={{ kind: 'task', id: task.id }} />
      </SlideOver.Body>

      <SlideOver.Footer style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        {canPromote && !readOnly && (
          <TahiButton
            variant="primary"
            size="md"
            iconLeft={<Inbox size={14} aria-hidden="true" />}
            title="Turn this into client-facing work with its own thread, files and delivery"
            style={{ minHeight: '2.75rem' }}
            onClick={() => onRequestConfirm('promote')}
          >
            Create request from task
          </TahiButton>
        )}
        {task.requestId && (
          <TahiButton
            variant="secondary"
            size="md"
            iconLeft={<ExternalLink size={14} aria-hidden="true" />}
            style={{ minHeight: '2.75rem' }}
            onClick={() => { if (task.requestId) onOpenRequest(task.requestId) }}
          >
            {`Open ${requestRef(linkedRequest?.requestNumber ?? null)}`}
          </TahiButton>
        )}
        <span style={{ flex: 1 }} />
        {!readOnly && (
          <TahiButton
            variant="danger"
            size="md"
            style={{ minHeight: '2.75rem' }}
            onClick={() => onRequestConfirm('delete')}
          >
            Delete
          </TahiButton>
        )}
      </SlideOver.Footer>
    </>
  )
}

// ---- Promote -----------------------------------------------------------------

const PROMOTE_CATEGORIES: readonly { value: string; label: string }[] = Object.keys(CATEGORY_CONFIG).map(key => ({
  value: key,
  label: key.charAt(0).toUpperCase() + key.slice(1),
}))

const PROMOTE_SIZES: readonly { value: 'small_task' | 'large_task'; label: string }[] = [
  { value: 'small_task', label: '1 day or less' },
  { value: 'large_task', label: 'Multi-day' },
]

/**
 * The promote confirm. It carries two real inputs, which is why it is a
 * centred <SlideOver> rather than a <ConfirmDialog>: the shared confirm takes
 * a title and a description and nothing else, and it is not this slice's file
 * to widen. Everything else about it behaves the same, including standing
 * down the drawer's Escape through the shared overlay stack.
 *
 * It draws its own heading rather than passing `title`, because <SlideOver>
 * hardcodes `id="slide-over-title"` on the heading it renders. Two open
 * slide-overs would carry that id at once and the confirm's aria-labelledby
 * would resolve to the drawer's heading, announcing this dialog as "Task".
 * `ariaLabel` names it instead, and there stays exactly one slide-over-title
 * in the document.
 */
function PromoteDialog({
  open,
  clientName,
  onCancel,
  onConfirm,
}: {
  open: boolean
  clientName: string
  onCancel: () => void
  onConfirm: (input: { category: string; size: 'small_task' | 'large_task' }) => Promise<void>
}) {
  const [category, setCategory] = React.useState('design')
  const [size, setSize] = React.useState<'small_task' | 'large_task'>('small_task')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setCategory('design')
    setSize('small_task')
    setBusy(false)
  }, [open])

  return (
    <SlideOver
      open={open}
      onClose={onCancel}
      variant="center"
      maxWidth="27rem"
      ariaLabel="Create a request from this task"
    >
      <SlideOver.Body style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="flex items-center" style={{ gap: '0.625rem' }}>
          <span
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: '2rem',
              height: '2rem',
              borderRadius: 'var(--radius-leaf-sm)',
              background: 'var(--color-brand-50)',
              color: 'var(--color-brand)',
            }}
          >
            <Inbox size={15} aria-hidden="true" />
          </span>
          <h2
            style={{
              margin: 0,
              fontSize: 'var(--text-md)',
              fontWeight: 600,
              letterSpacing: '-0.005em',
              color: 'var(--color-text)',
            }}
          >
            Create a request from this task?
          </h2>
        </div>

        <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.55, color: 'var(--color-text-muted)' }}>
          A new request opens for {clientName} with this title and note. The task stays linked to it, so your own
          follow-ups keep living here.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
            What kind of work?
          </span>
          <span className="flex items-center justify-start">
            <InlineMenuField
              value={category}
              options={PROMOTE_CATEGORIES.map(c => ({ value: c.value, label: c.label }))}
              onChange={setCategory}
              ariaLabel="Request category"
              width="12rem"
              renderValue={value => (
                <span>{PROMOTE_CATEGORIES.find(c => c.value === value)?.label ?? value}</span>
              )}
            />
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>How big is it?</span>
          <SegmentedControl
            value={size}
            onChange={setSize}
            role="radiogroup"
            size="sm"
            fill
            ariaLabel="Request size"
            options={PROMOTE_SIZES.map(s => ({ value: s.value, label: s.label }))}
          />
        </div>
      </SlideOver.Body>

      <SlideOver.Footer style={{ justifyContent: 'flex-end' }}>
        <TahiButton variant="secondary" size="md" style={{ minHeight: '2.75rem' }} disabled={busy} onClick={onCancel}>
          Cancel
        </TahiButton>
        <TahiButton
          variant="primary"
          size="md"
          style={{ minHeight: '2.75rem' }}
          loading={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onConfirm({ category, size })
            } finally {
              setBusy(false)
            }
          }}
        >
          Create request
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}
