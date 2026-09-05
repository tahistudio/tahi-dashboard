'use client'

/**
 * <NewTaskDialog>. Create a task from a template or from scratch.
 *
 * A centre-variant <SlideOver> rather than a right-hand drawer: creating is a
 * decision you finish before going back to the list, and the centre variant
 * is the repo's modal.
 *
 * The template picker is the one capability the prototype did not have and
 * the legacy page did, so it is carried across, with the priority mapped
 * through the alias table on the way in. A template's estimate and its
 * checklist now actually land, which they never did before: the old dialog
 * dropped both.
 *
 * Nothing here posts. The draft goes to `onCreate`, which is the shell's job,
 * so this file has no idea what an endpoint is.
 */

import * as React from 'react'
import { ListChecks, Plus, X } from 'lucide-react'
import { SlideOver } from '@/components/tahi/slide-over'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import { TahiButton } from '@/components/tahi/tahi-button'
import { TASK_PRIORITIES, taskPriorityLabel } from '@/lib/task-priorities'
import {
  coerceTaskLinks,
  setTaskClient,
  setTaskLevel,
  setTaskRequest,
  type TaskLinkState,
} from '@/lib/task-consistency'
import { TASK_LEVELS, TASK_LEVEL_HINTS, isTaskLevel, type TaskLevel } from '@/lib/tasks-views'
import { checklistCountLabel, LEVEL_ICON } from '@/components/tahi/tasks/task-chips'
import type { TaskTemplateOption } from '@/components/tahi/tasks/task-types'

export interface NewTaskDraft {
  title: string
  type: TaskLevel
  orgId: string | null
  requestId: string | null
  description: string | null
  status: string
  priority: string
  assigneeId: string | null
  dueDate: string | null
  estimatedHours: number | null
  subtasks: string[]
}

export interface NewTaskDialogProps {
  open: boolean
  onClose: () => void
  /** Pre-set the status, so the board's column plus creates in that column. */
  initialStatus?: string
  /** Pre-set the client, e.g. when a client filter is active. */
  initialOrgId?: string | null
  /** Pre-apply a template, so the header menu's "New from template" opens
   *  straight into a filled form. Applied on open, then the user owns it. */
  initialTemplateId?: string | null
  clients: readonly { id: string; name: string }[]
  peopleList: readonly { id: string; name: string }[]
  requests: readonly { id: string; orgId: string | null; requestNumber: number | null; title: string }[]
  templates: readonly TaskTemplateOption[]
  /** Rejecting keeps the dialog open with the draft intact. */
  onCreate: (draft: NewTaskDraft) => Promise<void>
}

/** Templates carry a six-value enum; a task takes three. */
const TEMPLATE_PRIORITY_ALIASES: Record<string, string> = {
  none: 'standard', low: 'standard', medium: 'standard',
  standard: 'standard', high: 'high', urgent: 'urgent',
}

/** The repo's reference for a request, everywhere: #042, never TR-0042. */
function requestRef(requestNumber: number | null): string {
  return requestNumber != null ? `#${String(requestNumber).padStart(3, '0')}` : 'Request'
}

const DIALOG_CSS = `
.tskn-input{
  width: 100%;
  min-height: 2.75rem;
  padding: 0 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-input);
  background: var(--color-bg);
  font-family: inherit;
  font-size: 0.875rem;
  color: var(--color-text);
  outline: none;
  box-sizing: border-box;
  transition:
    border-color var(--motion-quick) var(--ease-out),
    box-shadow var(--motion-quick) var(--ease-out);
}
.tskn-input::placeholder{ color: var(--color-text-subtle); }
.tskn-input:hover{ border-color: var(--color-brand-light); }
.tskn-input:focus{
  border-color: var(--focus-ring-color);
  box-shadow: var(--focus-ring);
}
.tskn-textarea{
  width: 100%;
  min-height: 5rem;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-input);
  background: var(--color-bg);
  font-family: inherit;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--color-text);
  resize: vertical;
  outline: none;
  box-sizing: border-box;
  transition:
    border-color var(--motion-quick) var(--ease-out),
    box-shadow var(--motion-quick) var(--ease-out);
}
.tskn-textarea::placeholder{ color: var(--color-text-subtle); }
.tskn-textarea:hover{ border-color: var(--color-brand-light); }
.tskn-textarea:focus{
  border-color: var(--focus-ring-color);
  box-shadow: var(--focus-ring);
}
.tskn-x{
  border: none;
  background: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-subtle);
  cursor: pointer;
  transition:
    color var(--motion-quick) var(--ease-out),
    background-color var(--motion-quick) var(--ease-out);
}
.tskn-x:hover,
.tskn-x:focus-visible{ color: var(--color-danger); background: var(--color-danger-bg); }
.tskn-grid{
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}
@media (min-width: 34rem){
  .tskn-grid{ grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce){
  .tskn-input,
  .tskn-textarea,
  .tskn-x{ transition: none; }
}
`

function FieldGroup({
  label,
  required,
  htmlFor,
  hint,
  children,
}: {
  label: string
  required?: boolean
  htmlFor?: string
  /** One quiet line under the field: what the choice above means. */
  hint?: string
  children: React.ReactNode
}) {
  // Half these fields are a SearchableSelect or a SegmentedControl, and
  // neither primitive exposes an id to point a label at. A <label> with no
  // htmlFor names no control and clicking it does nothing, so the caption is
  // a plain <span> unless there is a native input to bind to. The pickers
  // carry their own accessible name.
  const captionStyle: React.CSSProperties = {
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: 'var(--color-text)',
  }
  const captionInner = (
    <>
      {label}
      {required && <span style={{ color: 'var(--color-danger)', marginLeft: '0.125rem' }}>*</span>}
    </>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
      {htmlFor
        ? <label htmlFor={htmlFor} style={captionStyle}>{captionInner}</label>
        : <span style={captionStyle}>{captionInner}</span>}
      {children}
      {hint && (
        <p style={{ margin: 0, fontSize: '0.71875rem', fontWeight: 500, lineHeight: 1.45, color: 'var(--color-text-subtle)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function NewTaskDialog({
  open,
  onClose,
  initialStatus,
  initialOrgId,
  initialTemplateId,
  clients,
  peopleList,
  requests,
  templates,
  onCreate,
}: NewTaskDialogProps): React.ReactElement {
  const [templateId, setTemplateId] = React.useState<string | null>(null)
  const [links, setLinks] = React.useState<TaskLinkState>({
    level: 'tahi_internal',
    orgId: null,
    requestId: null,
  })
  const [title, setTitle] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [priority, setPriority] = React.useState<string>('standard')
  const [dueDate, setDueDate] = React.useState('')
  const [assigneeId, setAssigneeId] = React.useState<string | null>(null)
  const [estimate, setEstimate] = React.useState('')
  const [subtasks, setSubtasks] = React.useState<string[]>([])
  const [subtaskDraft, setSubtaskDraft] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)

  /**
   * Fill the form from a template. Called on open when the header menu chose
   * one, and again whenever the picker changes, so the two doors behave the
   * same. Everything it sets is then the user's to overwrite.
   */
  const applyTemplate = React.useCallback((template: TaskTemplateOption) => {
    setTitle(template.name)
    setDescription(template.description ?? '')
    setPriority(TEMPLATE_PRIORITY_ALIASES[template.defaultPriority] ?? 'standard')
    setEstimate(template.estimatedHours != null ? String(template.estimatedHours) : '')
    setSubtasks(template.subtasks.slice())
    setLinks(current => {
      const level: TaskLevel = isTaskLevel(template.type) ? template.type : current.level
      const orgId = template.orgId ?? current.orgId
      return coerceTaskLinks({ level, orgId, requestId: orgId === current.orgId ? current.requestId : null })
    })
  }, [])

  // Opening resets the form to whatever the caller asked for. Closing leaves
  // it alone: a rejected create keeps the draft on screen.
  React.useEffect(() => {
    if (!open) return
    const orgId = initialOrgId ?? null
    setTemplateId(initialTemplateId ?? null)
    setLinks(coerceTaskLinks({
      level: orgId ? 'internal_client_task' : 'tahi_internal',
      orgId,
      requestId: null,
    }))
    setTitle('')
    setDescription('')
    setPriority('standard')
    setDueDate('')
    setAssigneeId(null)
    setEstimate('')
    setSubtasks([])
    setSubtaskDraft('')
    setSubmitting(false)
    if (initialTemplateId) {
      const template = templates.find(t => t.id === initialTemplateId)
      if (template) applyTemplate(template)
    }
    // The dialog is filled once per opening. Later prop churn (a refetched
    // template list, a filter change behind the modal) must not wipe what the
    // user has typed since.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const linkableRequests = requests.filter(r => !links.orgId || r.orgId === links.orgId)
  const clientRequired = links.level !== 'tahi_internal'
  const missingClient = clientRequired && !links.orgId
  const canSubmit = title.trim().length > 0 && !missingClient && !submitting

  function addSubtask() {
    const next = subtaskDraft.trim()
    if (!next) return
    setSubtasks(list => [...list, next])
    setSubtaskDraft('')
  }

  async function submit() {
    if (!canSubmit) return
    const parsedEstimate = Number.parseFloat(estimate)
    // The links go through the coercion one last time, so a template that
    // disagrees with the chosen client cannot post an impossible triple.
    const settled = coerceTaskLinks(links)
    const draft: NewTaskDraft = {
      title: title.trim(),
      type: settled.level,
      orgId: settled.orgId,
      requestId: settled.requestId,
      description: description.trim() ? description.trim() : null,
      status: initialStatus ?? 'todo',
      priority,
      assigneeId,
      dueDate: dueDate ? dueDate : null,
      estimatedHours: Number.isFinite(parsedEstimate) && parsedEstimate > 0 ? parsedEstimate : null,
      subtasks,
    }
    setSubmitting(true)
    try {
      await onCreate(draft)
      onClose()
    } catch {
      // Rejecting keeps the dialog open with the draft intact; the shell owns
      // the failure toast.
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      variant="center"
      maxWidth="38.75rem"
      title="New task"
      subtitle="Studio work. A task can carry a client, a request, or neither."
      icon={<ListChecks size={15} aria-hidden />}
    >
      <style>{DIALOG_CSS}</style>

      {/* The scroll region and the gutters are SlideOver.Body's job. The form
          only owns its own rhythm, so this dialog keeps the same gutters as
          every other one in the repo instead of drifting to its own. The
          footer's submit reaches it by `form="new-task-form"`. */}
      <SlideOver.Body>
        <form
          id="new-task-form"
          onSubmit={e => { e.preventDefault(); void submit() }}
          style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
        >
          {templates.length > 0 && (
            <FieldGroup label="Start from a template">
              <SearchableSelect
                options={templates.map(t => ({
                  value: t.id,
                  label: t.name,
                  subtitle: t.subtasks.length > 0
                    ? checklistCountLabel(t.subtasks.length)
                    : undefined,
                }))}
                value={templateId}
                allowClear
                placeholder="No template"
                searchPlaceholder="Search templates..."
                onChange={next => {
                  setTemplateId(next)
                  if (!next) return
                  const template = templates.find(t => t.id === next)
                  if (template) applyTemplate(template)
                }}
              />
            </FieldGroup>
          )}

          <FieldGroup label="Level" hint={TASK_LEVEL_HINTS[links.level]}>
            <SegmentedControl
              value={links.level}
              onChange={next => setLinks(current => setTaskLevel(current, next))}
              role="radiogroup"
              size="sm"
              fill
              ariaLabel="Level"
              options={TASK_LEVELS.map(l => {
                const Glyph = LEVEL_ICON[l.value]
                return { value: l.value, label: l.label, title: l.hint, icon: <Glyph size={12} aria-hidden /> }
              })}
            />
          </FieldGroup>

          <div className="tskn-grid">
            <FieldGroup
              label="Client"
              required={clientRequired}
              hint={missingClient ? 'Pick a client, or set the level to Tahi.' : undefined}
            >
              <SearchableSelect
                options={clients.map(c => ({ value: c.id, label: c.name }))}
                value={links.orgId}
                allowClear
                placeholder="No client"
                searchPlaceholder="Search clients..."
                onChange={next => {
                  const linkedRequestOrgId = links.requestId
                    ? requests.find(r => r.id === links.requestId)?.orgId ?? null
                    : null
                  setLinks(current => setTaskClient(current, next, linkedRequestOrgId))
                }}
              />
            </FieldGroup>

            <FieldGroup label="Request">
              <SearchableSelect
                options={linkableRequests.map(r => ({
                  value: r.id,
                  label: `${requestRef(r.requestNumber)} ${r.title}`,
                }))}
                value={links.requestId}
                allowClear
                disabled={linkableRequests.length === 0}
                placeholder="Not linked"
                searchPlaceholder="Search requests..."
                onChange={next => {
                  const picked = next ? requests.find(r => r.id === next) ?? null : null
                  setLinks(current => setTaskRequest(current, picked))
                }}
              />
            </FieldGroup>
          </div>

          <FieldGroup label="Title" required htmlFor="new-task-title">
            <input
              id="new-task-title"
              type="text"
              className="tskn-input"
              value={title}
              autoFocus
              maxLength={200}
              required
              placeholder="What needs doing?"
              onChange={e => setTitle(e.target.value)}
            />
          </FieldGroup>

          <FieldGroup label="Note" htmlFor="new-task-note">
            <textarea
              id="new-task-note"
              className="tskn-textarea"
              value={description}
              placeholder="What good looks like, links, who to ask."
              onChange={e => setDescription(e.target.value)}
            />
          </FieldGroup>

          <FieldGroup label="Priority">
            <SegmentedControl
              value={priority}
              onChange={setPriority}
              role="radiogroup"
              size="sm"
              fill
              ariaLabel="Priority"
              options={TASK_PRIORITIES.map(p => ({ value: p, label: taskPriorityLabel(p) }))}
            />
          </FieldGroup>

          <div className="tskn-grid">
            <FieldGroup label="Due" htmlFor="new-task-due">
              <input
                id="new-task-due"
                type="date"
                className="tskn-input"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
              />
            </FieldGroup>

            <FieldGroup label="Estimate" htmlFor="new-task-estimate">
              <input
                id="new-task-estimate"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.25}
                className="tskn-input"
                value={estimate}
                placeholder="Hours"
                onChange={e => setEstimate(e.target.value)}
              />
            </FieldGroup>
          </div>

          <FieldGroup label="Assignee">
            <SearchableSelect
              options={peopleList.map(p => ({ value: p.id, label: p.name }))}
              value={assigneeId}
              allowClear
              placeholder="Unassigned"
              searchPlaceholder="Search people..."
              onChange={setAssigneeId}
            />
          </FieldGroup>

          <FieldGroup label="Checklist" htmlFor="new-task-subtask">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {subtasks.map((s, index) => (
                <div key={`${index}-${s}`} className="flex items-center" style={{ gap: '0.375rem' }}>
                  <span
                    className="truncate"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '0.375rem 0.5rem',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--color-bg-secondary)',
                      fontSize: '0.8125rem',
                      fontWeight: 500,
                      color: 'var(--color-text)',
                    }}
                  >
                    {s}
                  </span>
                  <button
                    type="button"
                    className="tskn-x tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-8 md:w-8"
                    aria-label={`Remove checklist item ${s}`}
                    title="Remove checklist item"
                    onClick={() => setSubtasks(list => list.filter((_, i) => i !== index))}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <div className="flex items-center" style={{ gap: '0.375rem' }}>
                <input
                  id="new-task-subtask"
                  type="text"
                  className="tskn-input"
                  value={subtaskDraft}
                  placeholder="Name a checklist item, press Enter"
                  onChange={e => setSubtaskDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); addSubtask() }
                  }}
                />
                <button
                  type="button"
                  className="tahi-focus-ring inline-flex items-center justify-center flex-shrink-0 h-11 w-11 md:h-9 md:w-9"
                  aria-label="Add checklist item"
                  title="Add checklist item"
                  onClick={addSubtask}
                  style={{
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  <Plus size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          </FieldGroup>
        </form>
      </SlideOver.Body>

      <SlideOver.Footer style={{ justifyContent: 'flex-end' }}>
        <TahiButton
          variant="secondary"
          size="md"
          style={{ minHeight: '2.75rem' }}
          disabled={submitting}
          onClick={onClose}
        >
          Cancel
        </TahiButton>
        <TahiButton
          type="submit"
          form="new-task-form"
          variant="primary"
          size="md"
          style={{ minHeight: '2.75rem' }}
          loading={submitting}
          disabled={!canSubmit}
        >
          Create task
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}
