'use client'

/**
 * <TasksSuggestions>. The body of the 'suggestions' Tasks view: call
 * transcripts turned into task suggestions, grouped by the call they came
 * from, each with a verbatim quote and four actions (Approve, Tweak, Snooze,
 * Reject) plus a per-call Approve all.
 *
 * The rail is inert here, the same way it is for My week: a suggestion has
 * no status/priority/client/assignee/due filters that mean anything before
 * it becomes a task, so this view ignores rail.filters/sort entirely and
 * fetches its own pending queue.
 *
 * Every write is optimistic: the row leaves the list the moment a decision
 * is sent, and comes back (via a full revalidate) if the request fails. This
 * mirrors the rest of the Tasks surface's reject-and-toast contract rather
 * than inventing a new one.
 *
 * GET /api/admin/task-suggestions, POST .../[id]/decide and POST
 * .../decide-bulk are slice S1's routes (see the CN.1 build contract). This
 * file calls them by path only; nothing here imports S1's server code.
 */

import * as React from 'react'
import useSWR from 'swr'
import { Check, ChevronDown, Clock, Leaf, Pencil, X } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Menu } from '@/components/tahi/menu'
import { NewTaskDialog } from '@/components/tahi/tasks/new-task-dialog'
import { TASK_STATUSES } from '@/lib/status-config'
import { TASK_PRIORITIES, taskPriorityLabel } from '@/lib/task-priorities'
import type {
  TaskClientOption,
  TaskPerson,
  TaskRequestOption,
  TaskTemplateOption,
} from '@/components/tahi/tasks/task-types'
import type { TaskFields } from '@/lib/task-wizard-drafts'
import {
  buildApproveRequest,
  buildRejectRequest,
  buildSnoozeRequest,
  confidenceLabel,
  createProposalToTaskFields,
  groupSuggestionsByCall,
  suggestionKeyAction,
  suggestionKindLabel,
  summariseProposal,
  taskFieldsToCreateProposal,
  type SuggestionCallGroup,
} from '@/app/(dashboard)/tasks/suggestions-logic'
import type {
  AddSubtasksProposal,
  CompleteTaskProposal,
  CreateTaskProposal,
  DecideBulkResponse,
  DecideSuggestionResponse,
  DecoratedSuggestion,
  NoteProposal,
  SnoozePreset,
  TaskSuggestionsResponse,
  UpdateTaskProposal,
} from '@/app/(dashboard)/tasks/suggestions-types'

const SUGGESTIONS_KEY = '/api/admin/task-suggestions?status=pending'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

const NO_TEMPLATES: readonly TaskTemplateOption[] = []
const NO_SUGGESTIONS: readonly DecoratedSuggestion[] = []

// ── Wire helpers ──────────────────────────────────────────────────────────

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json() as { error?: string }
    return data.error || 'That did not save'
  } catch {
    return 'That did not save'
  }
}

async function decide(id: string, body: unknown): Promise<DecideSuggestionResponse> {
  const res = await fetch(apiPath(`/api/admin/task-suggestions/${id}/decide`), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<DecideSuggestionResponse>
}

async function decideBulk(ids: string[], action: 'approve' | 'reject'): Promise<DecideBulkResponse> {
  const res = await fetch(apiPath('/api/admin/task-suggestions/decide-bulk'), {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ ids, action }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json() as Promise<DecideBulkResponse>
}

// ── Empty state ───────────────────────────────────────────────────────────

function SuggestionsEmpty() {
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
        No suggestions waiting
      </h3>
      <p style={{ margin: '0.375rem 0 0', maxWidth: '22rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>
        Suggestions arrive after a call is transcribed. Review them here before anything is created.
      </p>
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="tahi-shimmer"
          style={{ height: '5.5rem', borderRadius: 'var(--radius-leaf-sm)', background: 'var(--color-bg-secondary)' }}
        />
      ))}
    </div>
  )
}

// ── Inline editor for non-create kinds ───────────────────────────────────

interface InlineEditorProps {
  suggestion: DecoratedSuggestion
  peopleList: readonly TaskPerson[]
  onSave: (proposal: unknown) => Promise<void>
  onCancel: () => void
  busy: boolean
}

function UpdateTaskEditor({ suggestion, peopleList, onSave, onCancel, busy }: InlineEditorProps) {
  const original = suggestion.proposal as UpdateTaskProposal
  const [status, setStatus] = React.useState(original.fields.status ?? '')
  const [priority, setPriority] = React.useState(original.fields.priority ?? '')
  const [dueDate, setDueDate] = React.useState(original.fields.dueDate ?? '')
  const [assigneeId, setAssigneeId] = React.useState(original.fields.assigneeId ?? '')
  const [note, setNote] = React.useState(original.note ?? '')

  function save() {
    const fields: UpdateTaskProposal['fields'] = {}
    if (status) fields.status = status
    if (priority) fields.priority = priority
    if (dueDate) fields.dueDate = dueDate
    if (assigneeId) fields.assigneeId = assigneeId
    const proposal: UpdateTaskProposal = note.trim() ? { fields, note: note.trim() } : { fields }
    void onSave(proposal)
  }

  return (
    <div style={editorGrid}>
      <label style={editorLabel}>
        Status
        <select value={status} onChange={e => setStatus(e.target.value)} style={editorInput}>
          <option value="">Unchanged</option>
          {TASK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>
      <label style={editorLabel}>
        Priority
        <select value={priority} onChange={e => setPriority(e.target.value)} style={editorInput}>
          <option value="">Unchanged</option>
          {TASK_PRIORITIES.map(p => <option key={p} value={p}>{taskPriorityLabel(p)}</option>)}
        </select>
      </label>
      <label style={editorLabel}>
        Due date
        <input type="date" value={dueDate ?? ''} onChange={e => setDueDate(e.target.value)} style={editorInput} />
      </label>
      <label style={editorLabel}>
        Assignee
        <select value={assigneeId ?? ''} onChange={e => setAssigneeId(e.target.value)} style={editorInput}>
          <option value="">Unchanged</option>
          {peopleList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label style={{ ...editorLabel, gridColumn: '1 / -1' }}>
        Note
        <textarea value={note} onChange={e => setNote(e.target.value)} style={{ ...editorInput, minHeight: '3.5rem' }} />
      </label>
      <EditorActions onSave={save} onCancel={onCancel} busy={busy} />
    </div>
  )
}

function CompleteTaskEditor({ suggestion, onSave, onCancel, busy }: InlineEditorProps) {
  const original = suggestion.proposal as CompleteTaskProposal
  const [note, setNote] = React.useState(original.note ?? '')
  return (
    <div style={editorGrid}>
      <label style={{ ...editorLabel, gridColumn: '1 / -1' }}>
        Note
        <textarea value={note} onChange={e => setNote(e.target.value)} style={{ ...editorInput, minHeight: '3.5rem' }} />
      </label>
      <EditorActions
        onSave={() => void onSave(note.trim() ? { note: note.trim() } as CompleteTaskProposal : {})}
        onCancel={onCancel}
        busy={busy}
      />
    </div>
  )
}

function AddSubtasksEditor({ suggestion, onSave, onCancel, busy }: InlineEditorProps) {
  const original = suggestion.proposal as AddSubtasksProposal
  const [text, setText] = React.useState((original.subtasks ?? []).join('\n'))
  return (
    <div style={editorGrid}>
      <label style={{ ...editorLabel, gridColumn: '1 / -1' }}>
        One subtask per line
        <textarea value={text} onChange={e => setText(e.target.value)} style={{ ...editorInput, minHeight: '4.5rem' }} />
      </label>
      <EditorActions
        onSave={() => {
          const subtasks = text.split('\n').map(s => s.trim()).filter(Boolean)
          void onSave({ subtasks } as AddSubtasksProposal)
        }}
        onCancel={onCancel}
        busy={busy}
      />
    </div>
  )
}

function NoteEditor({ suggestion, onSave, onCancel, busy }: InlineEditorProps) {
  const original = suggestion.proposal as NoteProposal
  const [body, setBody] = React.useState(original.body ?? '')
  return (
    <div style={editorGrid}>
      <label style={{ ...editorLabel, gridColumn: '1 / -1' }}>
        Comment body
        <textarea value={body} onChange={e => setBody(e.target.value)} style={{ ...editorInput, minHeight: '4.5rem' }} />
      </label>
      <EditorActions onSave={() => void onSave({ body } as NoteProposal)} onCancel={onCancel} busy={busy} />
    </div>
  )
}

function EditorActions({ onSave, onCancel, busy }: { onSave: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
      <TahiButton variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</TahiButton>
      <TahiButton variant="primary" size="sm" onClick={onSave} loading={busy}>Save and approve</TahiButton>
    </div>
  )
}

const snoozeTriggerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.375rem',
  fontSize: '0.75rem',
  fontWeight: 500,
  fontFamily: 'inherit',
  color: 'var(--color-text-muted)',
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  padding: '0.375rem 0.625rem',
  cursor: 'pointer',
}

const editorGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
  gap: '0.625rem',
  padding: '0.75rem',
  marginTop: '0.5rem',
  borderRadius: 'var(--radius-leaf-sm)',
  background: 'var(--color-bg-secondary)',
}

const editorLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
}

const editorInput: React.CSSProperties = {
  fontSize: '0.8125rem',
  fontFamily: 'inherit',
  color: 'var(--color-text)',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
  borderRadius: '0.5rem',
  padding: '0.375rem 0.5rem',
}

// ── The row ─────────────────────────────────────────────────────────────

interface SuggestionRowProps {
  suggestion: DecoratedSuggestion
  peopleList: readonly TaskPerson[]
  focused: boolean
  onFocus: () => void
  onApprove: () => void
  onReject: () => void
  onSnooze: (preset: SnoozePreset) => void
  onTweakCreate: () => void
  onTweakOther: (proposal: unknown) => Promise<void>
  busy: boolean
}

function SuggestionRow({
  suggestion, peopleList, focused, onFocus, onApprove, onReject, onSnooze, onTweakCreate, onTweakOther, busy,
}: SuggestionRowProps) {
  const [editing, setEditing] = React.useState(false)
  const confidence = confidenceLabel(suggestion.confidence)
  const summary = summariseProposal(suggestion.kind, suggestion.proposal)

  function handleTweak() {
    if (suggestion.kind === 'create_task') {
      onTweakCreate()
      return
    }
    setEditing(e => !e)
  }

  async function handleEditorSave(proposal: unknown) {
    await onTweakOther(proposal)
    setEditing(false)
  }

  return (
    <div
      id={`suggestion-row-${suggestion.id}`}
      role="button"
      tabIndex={0}
      onFocus={onFocus}
      onKeyDown={e => {
        const action = suggestionKeyAction(e.key)
        if (action === 'approve') { e.preventDefault(); onApprove() }
        else if (action === 'reject') { e.preventDefault(); onReject() }
      }}
      className="tahi-focus-ring"
      style={{
        borderRadius: 'var(--radius-leaf-sm)',
        border: '1px solid var(--color-border-subtle)',
        background: focused ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
        padding: '0.875rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: '0.6875rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
            padding: '0.125rem 0.5rem',
            borderRadius: '999px',
            background: 'var(--color-brand-50)',
            color: 'var(--color-brand-dark)',
          }}
        >
          {suggestionKindLabel(suggestion.kind)}
        </span>
        {confidence && (
          <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{confidence}</span>
        )}
        {suggestion.targetTaskTitle && (
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            on &quot;{suggestion.targetTaskTitle}&quot;
          </span>
        )}
      </div>

      <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text)', fontWeight: 500 }}>{summary}</p>

      <blockquote
        style={{
          margin: 0,
          padding: '0.5rem 0.75rem',
          borderRadius: '0.5rem',
          background: 'var(--color-bg-secondary)',
          color: 'var(--color-text-muted)',
          fontSize: '0.8125rem',
          fontStyle: 'italic',
        }}
      >
        &quot;{suggestion.quote}&quot;
      </blockquote>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <TahiButton variant="primary" size="sm" iconLeft={<Check size={14} />} onClick={onApprove} loading={busy}>
          Approve
        </TahiButton>
        <TahiButton variant="secondary" size="sm" iconLeft={<Pencil size={14} />} onClick={handleTweak} disabled={busy}>
          Tweak
        </TahiButton>
        <Menu
          trigger={
            <button
              type="button"
              disabled={busy}
              className="tahi-btn-sm tahi-focus-ring"
              style={snoozeTriggerStyle}
            >
              <Clock size={14} aria-hidden="true" />
              Snooze
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          }
        >
          <Menu.Item onClick={() => onSnooze('tonight')}>Tonight</Menu.Item>
          <Menu.Item onClick={() => onSnooze('this_week')}>This week</Menu.Item>
        </Menu>
        <TahiButton variant="ghost" size="sm" iconLeft={<X size={14} />} onClick={onReject} disabled={busy}>
          Reject
        </TahiButton>
      </div>

      {editing && suggestion.kind === 'update_task' && (
        <UpdateTaskEditor suggestion={suggestion} peopleList={peopleList} onSave={handleEditorSave} onCancel={() => setEditing(false)} busy={busy} />
      )}
      {editing && suggestion.kind === 'complete_task' && (
        <CompleteTaskEditor suggestion={suggestion} peopleList={peopleList} onSave={handleEditorSave} onCancel={() => setEditing(false)} busy={busy} />
      )}
      {editing && suggestion.kind === 'add_subtasks' && (
        <AddSubtasksEditor suggestion={suggestion} peopleList={peopleList} onSave={handleEditorSave} onCancel={() => setEditing(false)} busy={busy} />
      )}
      {editing && suggestion.kind === 'note' && (
        <NoteEditor suggestion={suggestion} peopleList={peopleList} onSave={handleEditorSave} onCancel={() => setEditing(false)} busy={busy} />
      )}
    </div>
  )
}

// ── The call group ──────────────────────────────────────────────────────

interface CallGroupProps {
  group: SuggestionCallGroup
  peopleList: readonly TaskPerson[]
  focusedId: string | null
  onFocusRow: (id: string) => void
  onApprove: (id: string) => void
  onReject: (id: string) => void
  onSnooze: (id: string, preset: SnoozePreset) => void
  onTweakCreate: (suggestion: DecoratedSuggestion) => void
  onTweakOther: (id: string, proposal: unknown) => Promise<void>
  onApproveAll: (ids: string[]) => void
  busyIds: ReadonlySet<string>
}

function CallGroupBlock({
  group, peopleList, focusedId, onFocusRow, onApprove, onReject, onSnooze, onTweakCreate, onTweakOther, onApproveAll, busyIds,
}: CallGroupProps) {
  const when = group.callScheduledAt ? new Date(group.callScheduledAt) : null
  const whenLabel = when && Number.isFinite(when.getTime())
    ? when.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>{group.callTitle}</h3>
          {group.orgName && <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{group.orgName}</span>}
          {whenLabel && <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>{whenLabel}</span>}
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
            {group.items.length} suggestion{group.items.length === 1 ? '' : 's'}
          </span>
        </div>
        {group.items.length > 1 && (
          <TahiButton
            variant="secondary"
            size="sm"
            onClick={() => onApproveAll(group.items.map(i => i.id))}
          >
            Approve all
          </TahiButton>
        )}
      </div>
      {group.items.map(item => (
        <SuggestionRow
          key={item.id}
          suggestion={item}
          peopleList={peopleList}
          focused={focusedId === item.id}
          onFocus={() => onFocusRow(item.id)}
          onApprove={() => onApprove(item.id)}
          onReject={() => onReject(item.id)}
          onSnooze={preset => onSnooze(item.id, preset)}
          onTweakCreate={() => onTweakCreate(item)}
          onTweakOther={proposal => onTweakOther(item.id, proposal)}
          busy={busyIds.has(item.id)}
        />
      ))}
    </div>
  )
}

// ── The view ────────────────────────────────────────────────────────────

export interface TasksSuggestionsProps {
  clients: readonly TaskClientOption[]
  peopleList: readonly TaskPerson[]
  requests: readonly TaskRequestOption[]
  /** Called after a create_task suggestion is applied, so the shell can
   *  refetch the task list and offer to open the new row. */
  onTaskCreated: (taskId: string) => void
  /** The pending count, lifted so the rail's toolbar can show it the same
   *  way My week reports its own count while that view is on screen. */
  onCountChange?: (count: number) => void
}

export function TasksSuggestions({ clients, peopleList, requests, onTaskCreated, onCountChange }: TasksSuggestionsProps) {
  const { showToast } = useToast()
  const { data, mutate, isLoading } = useSWR<TaskSuggestionsResponse>(SUGGESTIONS_KEY)
  const items = data?.items ?? NO_SUGGESTIONS
  const groups = React.useMemo(() => groupSuggestionsByCall(items), [items])

  React.useEffect(() => {
    onCountChange?.(items.length)
  }, [items.length, onCountChange])

  const [focusedId, setFocusedId] = React.useState<string | null>(null)
  const [busyIds, setBusyIds] = React.useState<ReadonlySet<string>>(new Set())
  const [tweakTarget, setTweakTarget] = React.useState<DecoratedSuggestion | null>(null)

  const orderedIds = React.useMemo(() => groups.flatMap(g => g.items.map(i => i.id)), [groups])

  function setBusy(id: string, busy: boolean) {
    setBusyIds(current => {
      const next = new Set(current)
      if (busy) next.add(id)
      else next.delete(id)
      return next
    })
  }

  /** Drops a row from the local view immediately; a failed request restores
   *  it via a full revalidate rather than trying to splice it back by hand,
   *  which is what keeps the rollback honest when two decisions race. */
  async function removeOptimistically(ids: readonly string[], run: () => Promise<void>) {
    const idSet = new Set(ids)
    const previous = data
    await mutate(
      async () => {
        try {
          await run()
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'That did not save', 'error')
          throw err
        }
        return previous
      },
      {
        optimisticData: previous
          ? {
              items: previous.items.filter(i => !idSet.has(i.id)),
              counts: {
                pending: Math.max(0, previous.counts.pending - ids.length),
                snoozed: previous.counts.snoozed,
                calls: previous.counts.calls,
              },
            }
          : previous,
        rollbackOnError: true,
        populateCache: false,
        revalidate: true,
      },
    )
  }

  async function handleApprove(suggestion: DecoratedSuggestion, proposalOverride?: unknown) {
    setBusy(suggestion.id, true)
    try {
      await removeOptimistically([suggestion.id], async () => {
        const result = await decide(suggestion.id, buildApproveRequest(proposalOverride))
        if (suggestion.kind === 'create_task' && result.appliedTaskId) {
          const proposal = (proposalOverride as CreateTaskProposal | undefined) ?? (suggestion.proposal as CreateTaskProposal)
          const taskId = result.appliedTaskId
          showToast(`Task created: ${proposal.title}`, 'success', {
            action: { label: 'Open', onClick: () => onTaskCreated(taskId) },
          })
        } else {
          showToast('Suggestion approved')
        }
      })
    } catch {
      // removeOptimistically already toasted the failure.
    } finally {
      setBusy(suggestion.id, false)
    }
  }

  async function handleReject(id: string) {
    setBusy(id, true)
    try {
      await removeOptimistically([id], async () => {
        await decide(id, buildRejectRequest())
        showToast('Suggestion rejected')
      })
    } catch {
      // handled above
    } finally {
      setBusy(id, false)
    }
  }

  async function handleSnooze(id: string, preset: SnoozePreset) {
    setBusy(id, true)
    try {
      await removeOptimistically([id], async () => {
        await decide(id, buildSnoozeRequest(preset))
        showToast(preset === 'tonight' ? 'Snoozed until tonight' : 'Snoozed until this week')
      })
    } catch {
      // handled above
    } finally {
      setBusy(id, false)
    }
  }

  async function handleApproveAll(ids: string[]) {
    setBusyIds(current => new Set([...current, ...ids]))
    try {
      await removeOptimistically(ids, async () => {
        const result = await decideBulk(ids, 'approve')
        const failed = result.results.filter(r => r.error)
        if (failed.length > 0) {
          showToast(`${result.results.length - failed.length} approved, ${failed.length} failed`, 'warning')
        } else {
          showToast(`${result.results.length} suggestions approved`)
        }
      })
    } catch {
      // handled above
    } finally {
      setBusyIds(current => {
        const next = new Set(current)
        for (const id of ids) next.delete(id)
        return next
      })
    }
  }

  async function handleTweakOther(id: string, proposal: unknown) {
    const suggestion = items.find(i => i.id === id)
    if (!suggestion) return
    await handleApprove(suggestion, proposal)
  }

  function handleFocusRow(id: string) {
    setFocusedId(id)
  }

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!focusedId) return
      const action = suggestionKeyAction(e.key)
      if (action !== 'focus_next' && action !== 'focus_prev') return
      const idx = orderedIds.indexOf(focusedId)
      if (idx === -1) return
      const nextIdx = action === 'focus_next'
        ? Math.min(orderedIds.length - 1, idx + 1)
        : Math.max(0, idx - 1)
      const nextId = orderedIds[nextIdx]
      if (nextId) {
        setFocusedId(nextId)
        const el = document.getElementById(`suggestion-row-${nextId}`)
        el?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedId, orderedIds])

  const initialDraft: TaskFields | null = tweakTarget && tweakTarget.kind === 'create_task'
    ? createProposalToTaskFields(tweakTarget.proposal as CreateTaskProposal)
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {tweakTarget && (
        <NewTaskDialog
          open={!!tweakTarget}
          onClose={() => setTweakTarget(null)}
          initialDraft={initialDraft}
          clients={clients}
          peopleList={peopleList}
          requests={requests}
          templates={NO_TEMPLATES}
          onCreate={async draft => {
            const target = tweakTarget
            setTweakTarget(null)
            if (!target) return
            await handleApprove(target, taskFieldsToCreateProposal({
              title: draft.title,
              type: draft.type,
              orgId: draft.orgId,
              requestId: draft.requestId,
              description: draft.description,
              status: draft.status,
              priority: draft.priority,
              assigneeId: draft.assigneeId,
              dueDate: draft.dueDate,
              estimatedHours: draft.estimatedHours,
              subtasks: draft.subtasks,
            }))
          }}
        />
      )}

      {isLoading ? (
        <Skeleton />
      ) : groups.length === 0 ? (
        <SuggestionsEmpty />
      ) : (
        groups.map(group => (
          <CallGroupBlock
            key={group.key}
            group={group}
            peopleList={peopleList}
            focusedId={focusedId}
            onFocusRow={handleFocusRow}
            onApprove={id => {
              const suggestion = items.find(i => i.id === id)
              if (suggestion) void handleApprove(suggestion)
            }}
            onReject={id => void handleReject(id)}
            onSnooze={(id, preset) => void handleSnooze(id, preset)}
            onTweakCreate={suggestion => setTweakTarget(suggestion)}
            onTweakOther={(id, proposal) => handleTweakOther(id, proposal)}
            onApproveAll={ids => void handleApproveAll(ids)}
            busyIds={busyIds}
          />
        ))
      )}
    </div>
  )
}
