'use client'

/**
 * TaskTemplatesSection - reusable task templates the team drops onto new tasks.
 * Each template carries a type (who the work is for), a default priority, an
 * optional description, a checklist that becomes subtasks, an estimate and a
 * default assignee.
 *
 * Global by default (orgId null). In Per-client mode the list shows that
 * client's templates plus the inherited global ones; editing an inherited
 * global template copies it for the client (copy-on-write) so the global set
 * is never mutated from a client view.
 *
 * Data is real: GET /api/admin/task-templates (optional ?orgId=), POST
 * (create), PATCH /[id] (edit) and DELETE /[id].
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCheck, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  PerClientHeader,
  EditDialog,
  RowActions,
  EmptyRow,
  Chip,
  Toasts,
  useToasts,
  type ChipTone,
} from '@/components/tahi/settings/primitives'

interface TaskTemplate {
  id: string
  name: string
  type: string
  category: string | null
  description: string | null
  defaultPriority: string | null
  subtasks: string | null
  estimatedHours: number | null
  orgId: string | null
  defaultAssignee: string | null
}

interface TemplatesResponse {
  items: TaskTemplate[]
}

interface ClientsResponse {
  organisations: Array<{ id: string; name: string }>
}

type Mode = 'global' | 'client'

// -- type <-> label (schema values are the source of truth) --
const TYPE_TO_LABEL: Record<string, string> = {
  client_task: 'Client external',
  internal_client_task: 'Internal client',
  tahi_internal: 'Tahi internal',
}
const TYPE_OPTS = ['Client external', 'Internal client', 'Tahi internal']
function labelToType(label: string): string {
  const hit = Object.entries(TYPE_TO_LABEL).find(([, l]) => l === label)
  return hit ? hit[0] : 'tahi_internal'
}

// -- priority <-> label (design vocabulary; legacy 'standard' reads as Medium) --
const PRIORITIES: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]
const PRI_OPTS = PRIORITIES.map(p => p.label)
function priLabel(value: string | null): string {
  if (value === 'standard') return 'Medium'
  return PRIORITIES.find(p => p.value === value)?.label ?? 'Medium'
}
function priValue(label: string): string {
  return PRIORITIES.find(p => p.label === label)?.value ?? 'medium'
}
// Design chip tones: High is brand, everything else neutral.
function priTone(value: string | null): ChipTone {
  return value === 'high' ? 'brand' : 'neutral'
}

// -- estimate <-> estimatedHours --
const ESTIMATES: Array<{ hours: number; label: string }> = [
  { hours: 0.25, label: '15 min' },
  { hours: 0.5, label: '30 min' },
  { hours: 1, label: '1 hour' },
  { hours: 2, label: '2 hours' },
  { hours: 4, label: 'Half day' },
  { hours: 8, label: 'Full day' },
]
const ESTIMATE_OPTS = ESTIMATES.map(e => e.label)
function estimateLabel(hours: number | null): string {
  return ESTIMATES.find(e => e.hours === hours)?.label ?? ''
}
function estimateHours(label: string): number | null {
  return ESTIMATES.find(e => e.label === label)?.hours ?? null
}

const ASSIGNEE_OPTS = ['Unassigned', 'On-call PM', 'Design lead', 'Dev lead', 'Account lead']

function parseChecklist(raw: string | null): string[] {
  if (!raw) return []
  try {
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

export function TaskTemplatesSection(_props: { isAdmin?: boolean } = {}) {
  const [mode, setMode] = useState<Mode>('global')
  const [orgId, setOrgId] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [newId, setNewId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const newTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { toasts, toast } = useToasts()

  useEffect(() => () => {
    if (newTimer.current) clearTimeout(newTimer.current)
  }, [])

  const { data: clientsData } = useResource<ClientsResponse>(
    mode === 'client' ? '/api/admin/clients' : null,
  )
  const clients = useMemo(() => clientsData?.organisations ?? [], [clientsData])
  const clientName = clients.find(c => c.id === orgId)?.name ?? ''

  // Default the client selection to the first org once the list loads.
  useEffect(() => {
    if (mode === 'client' && !orgId && clients.length > 0) {
      setOrgId(clients[0].id)
    }
  }, [mode, orgId, clients])

  const listUrl =
    mode === 'global'
      ? '/api/admin/task-templates'
      : orgId
        ? `/api/admin/task-templates?orgId=${orgId}`
        : null

  const { data, isLoading, mutate } = useResource<TemplatesResponse>(listUrl)
  const rows = data?.items ?? []
  const waiting = isLoading || (mode === 'client' && !clientsData)

  function markNew(id: string) {
    setNewId(id)
    if (newTimer.current) clearTimeout(newTimer.current)
    newTimer.current = setTimeout(() => setNewId(null), 1400)
  }

  async function createTemplate() {
    if (busy) return
    if (mode === 'client' && !orgId) return
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/task-templates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New template',
          type: 'tahi_internal',
          defaultPriority: 'medium',
          subtasks: [],
          orgId: mode === 'client' ? orgId : null,
        }),
      })
      if (!res.ok) throw new Error('Failed to create template')
      const json = (await res.json()) as { id: string }
      markNew(json.id)
      await mutate()
      setEditId(json.id)
    } catch {
      toast('Could not create the template', 'err')
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  async function saveTemplate(id: string, values: Record<string, string>) {
    const target = rows.find(r => r.id === id)
    const checklist = (values.checklist ?? '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
    const estimate = estimateHours(values.estimate ?? '')
    const payload: Record<string, unknown> = {
      name: values.name?.trim() || 'Untitled template',
      type: labelToType(values.type ?? ''),
      defaultPriority: priValue(values.pri ?? ''),
      description: values.desc?.trim() || null,
      subtasks: checklist,
      defaultAssignee:
        !values.assignee || values.assignee === 'Unassigned' ? null : values.assignee,
    }
    // Only write the estimate when the picker matched a known bucket, so an
    // untouched blank select never wipes a stored custom hours value.
    if (estimate !== null) payload.estimatedHours = estimate
    setEditId(null)
    try {
      if (mode === 'client' && orgId && target && !target.orgId) {
        // Copy-on-write: editing an inherited global template from a client
        // view creates a client-scoped copy instead of mutating the global.
        const res = await fetch(apiPath('/api/admin/task-templates'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, orgId }),
        })
        if (!res.ok) throw new Error('Failed to save template')
        const json = (await res.json()) as { id: string }
        markNew(json.id)
      } else {
        const res = await fetch(apiPath(`/api/admin/task-templates/${id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to save template')
      }
    } catch {
      toast('Could not save the template', 'err')
    } finally {
      await mutate()
    }
  }

  function requestDelete(r: TaskTemplate) {
    if (mode === 'client' && !r.orgId) {
      toast('This is a global template. Switch to All clients to remove it for everyone.', 'err')
      return
    }
    setConfirmId(r.id)
  }

  async function deleteTemplate(id: string) {
    setConfirmId(null)
    try {
      const res = await fetch(apiPath(`/api/admin/task-templates/${id}`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete template')
    } catch {
      toast('Could not delete the template', 'err')
    } finally {
      await mutate()
    }
  }

  const editing = editId ? rows.find(r => r.id === editId) : null
  const editRow = editing
    ? {
        name: editing.name,
        type: TYPE_TO_LABEL[editing.type] ?? 'Tahi internal',
        pri: priLabel(editing.defaultPriority),
        desc: editing.description ?? '',
        checklist: parseChecklist(editing.subtasks).join('\n'),
        estimate: estimateLabel(editing.estimatedHours),
        assignee: editing.defaultAssignee ?? 'Unassigned',
      }
    : null
  // Keep a stored free-text assignee selectable rather than silently blanking.
  const assigneeOpts =
    editing?.defaultAssignee && !ASSIGNEE_OPTS.includes(editing.defaultAssignee)
      ? [...ASSIGNEE_OPTS, editing.defaultAssignee]
      : ASSIGNEE_OPTS

  const confirming = confirmId ? rows.find(r => r.id === confirmId) ?? null : null

  return (
    <SectionShell
      title="Task templates"
      lede="Reusable task templates for the team. Tailor per client where a workflow differs."
      action={
        <button type="button" className="btn1" onClick={createTemplate} disabled={busy}>
          <Plus size={15} />
          New template
        </button>
      }
    >
      <PerClientHeader
        mode={mode}
        setMode={v => setMode(v as Mode)}
        client={clientName}
        setClient={name => {
          const hit = clients.find(c => c.name === name)
          if (hit) setOrgId(hit.id)
        }}
        clients={clients.map(c => c.name)}
      />

      <div className="set-card lrow-wrap">
        {waiting ? (
          <SkeletonRows />
        ) : mode === 'client' && clients.length === 0 ? (
          <EmptyRow text="No clients yet - add a client first." />
        ) : rows.length === 0 ? (
          <EmptyRow text="No templates yet." />
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              className={'lrow' + (r.id === newId ? ' lrow-enter' : '')}
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <span className="lrow-ic leaf">
                <ClipboardCheck size={16} />
              </span>
              <div className="lrow-t">
                <b>{r.name}</b>
                <small>{TYPE_TO_LABEL[r.type] ?? r.type}</small>
              </div>
              <div className="lrow-r">
                {mode === 'client' && (
                  <Chip tone="neutral">{r.orgId ? 'Override' : 'Global'}</Chip>
                )}
                <Chip tone={priTone(r.defaultPriority)}>{priLabel(r.defaultPriority)}</Chip>
                <RowActions onEdit={() => setEditId(r.id)} onDelete={() => requestDelete(r)} />
              </div>
            </div>
          ))
        )}
      </div>

      {editId && editRow && (
        <EditDialog
          heading="Edit task template"
          row={editRow}
          fields={[
            { key: 'name', label: 'Template name' },
            { key: 'type', label: 'Type', type: 'select', opts: TYPE_OPTS },
            { key: 'pri', label: 'Priority', type: 'select', opts: PRI_OPTS },
            {
              key: 'desc',
              label: 'Description',
              type: 'textarea',
              ph: 'What does this task cover?',
            },
            {
              key: 'checklist',
              label: 'Checklist items',
              type: 'textarea',
              ph: 'One item per line',
              help: 'Each line becomes a checkbox on the task.',
            },
            { key: 'estimate', label: 'Estimate', type: 'select', opts: ESTIMATE_OPTS },
            { key: 'assignee', label: 'Default assignee', type: 'select', opts: assigneeOpts },
          ]}
          onSave={v => saveTemplate(editId, v)}
          onClose={() => setEditId(null)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          heading="Delete this template?"
          body={`"${confirming.name}" will be removed${confirming.orgId ? ' for this client' : ''}. Tasks already created from it are not affected.`}
          confirmLabel="Delete"
          onConfirm={() => deleteTemplate(confirming.id)}
          onClose={() => setConfirmId(null)}
        />
      )}

      <Toasts toasts={toasts} />
    </SectionShell>
  )
}

// -- Loading skeleton (animate-pulse blocks in the row chrome) --

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="lrow"
          style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
          aria-hidden="true"
        >
          <span
            className="animate-pulse"
            style={{
              width: 34,
              height: 34,
              borderRadius: '0 .625rem 0 .625rem',
              background: 'var(--bg-tertiary)',
              flexShrink: 0,
            }}
          />
          <div className="lrow-t animate-pulse">
            <span
              style={{
                display: 'block',
                width: 150,
                maxWidth: '60%',
                height: 12,
                borderRadius: 6,
                background: 'var(--bg-tertiary)',
              }}
            />
            <span
              style={{
                display: 'block',
                width: 96,
                maxWidth: '40%',
                height: 9,
                borderRadius: 6,
                background: 'var(--bg-secondary)',
                marginTop: 7,
              }}
            />
          </div>
        </div>
      ))}
    </>
  )
}

// -- Delete confirmation (uses the shared .dlg chrome) --

function ConfirmDialog({
  heading,
  body,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  heading: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="dlg-backdrop" onClick={onClose}>
      <div
        className="dlg"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        <h3>{heading}</h3>
        <p className="dlg-warn" style={{ margin: 0 }}>{body}</p>
        <div className="dlg-foot">
          <button type="button" className="btn2" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn1"
            style={{ background: 'var(--danger-fill)' }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
