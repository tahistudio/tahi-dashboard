'use client'

/**
 * TaskTemplatesSection - reusable task templates the team drops onto new tasks.
 * Each template carries a type (who the work is for), a default priority, an
 * optional description, and a checklist that becomes subtasks on tasks created
 * from it.
 *
 * Data is real: it reads /api/admin/task-templates (GET) and writes through
 * POST (create), PATCH /[id] (edit) and DELETE /[id]. New templates are created
 * with sensible defaults, then opened straight into the edit dialog (same flow
 * as the kanban and pipeline sections).
 *
 * The design mock shows a per-client scope switch, but task templates have no
 * per-client storage (no orgId column), so that control is intentionally left
 * off here - every template is global. Priority is constrained to the values
 * the API validates on edit (standard / high / urgent).
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useState } from 'react'
import { ClipboardCheck, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  EditDialog,
  RowActions,
  EmptyRow,
  Chip,
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
}

interface TemplatesResponse {
  items?: TaskTemplate[]
  templates?: TaskTemplate[]
}

// ── type <-> label (schema values are the source of truth) ──────────────────
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

// ── priority <-> label (API validates standard | high | urgent on edit) ──────
const PRI_TO_LABEL: Record<string, string> = {
  standard: 'Standard',
  high: 'High',
  urgent: 'Urgent',
}
const PRI_OPTS = ['Standard', 'High', 'Urgent']
function labelToPri(label: string): string {
  const hit = Object.entries(PRI_TO_LABEL).find(([, l]) => l === label)
  return hit ? hit[0] : 'standard'
}
function priorityTone(pri: string | null): ChipTone {
  switch (pri) {
    case 'urgent':
      return 'danger'
    case 'high':
      return 'warning'
    default:
      return 'neutral'
  }
}

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
  const [editId, setEditId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, isLoading, mutate } = useResource<TemplatesResponse>('/api/admin/task-templates')
  const rows = data?.items ?? data?.templates ?? []

  async function createTemplate() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/task-templates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New template',
          type: 'tahi_internal',
          defaultPriority: 'standard',
          subtasks: [],
        }),
      })
      if (!res.ok) throw new Error('Failed to create template')
      const json = (await res.json()) as { id: string }
      await mutate()
      setEditId(json.id)
    } catch {
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  async function saveTemplate(id: string, values: Record<string, string>) {
    const name = values.name?.trim()
    const checklist = (values.checklist ?? '')
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
    try {
      const res = await fetch(apiPath(`/api/admin/task-templates/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || 'Untitled template',
          type: labelToType(values.type ?? ''),
          defaultPriority: labelToPri(values.pri ?? ''),
          description: values.description?.trim() || null,
          subtasks: checklist,
        }),
      })
      if (!res.ok) throw new Error('Failed to save template')
    } finally {
      setEditId(null)
      await mutate()
    }
  }

  async function deleteTemplate(id: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/task-templates/${id}`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete template')
    } finally {
      await mutate()
    }
  }

  const editing = editId ? rows.find(r => r.id === editId) : null
  const editRow = editing
    ? {
        name: editing.name,
        type: TYPE_TO_LABEL[editing.type] ?? 'Tahi internal',
        pri: PRI_TO_LABEL[editing.defaultPriority ?? 'standard'] ?? 'Standard',
        description: editing.description ?? '',
        checklist: parseChecklist(editing.subtasks).join('\n'),
      }
    : null

  return (
    <SectionShell
      title="Task templates"
      lede="Reusable task templates for the team. Each one carries a type, a default priority, and a checklist that becomes subtasks."
      action={
        <button type="button" className="btn1" onClick={createTemplate} disabled={busy}>
          <Plus size={15} />
          New template
        </button>
      }
    >
      <div className="set-card lrow-wrap">
        {isLoading ? (
          <EmptyRow text="Loading templates..." />
        ) : rows.length === 0 ? (
          <EmptyRow text="No templates yet." />
        ) : (
          rows.map((r, i) => {
            const steps = parseChecklist(r.subtasks).length
            const typeLabel = TYPE_TO_LABEL[r.type] ?? r.type
            const priLabel = PRI_TO_LABEL[r.defaultPriority ?? 'standard'] ?? 'Standard'
            return (
              <div
                key={r.id}
                className="lrow"
                style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
              >
                <span className="lrow-ic leaf">
                  <ClipboardCheck size={16} />
                </span>
                <div className="lrow-t">
                  <b>{r.name}</b>
                  <small>
                    {typeLabel}
                    {steps > 0 ? ` · ${steps} step${steps > 1 ? 's' : ''}` : ''}
                  </small>
                </div>
                <div className="lrow-r">
                  <Chip tone={priorityTone(r.defaultPriority)}>{priLabel}</Chip>
                  <RowActions onEdit={() => setEditId(r.id)} onDelete={() => deleteTemplate(r.id)} />
                </div>
              </div>
            )
          })
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
              key: 'description',
              label: 'Description',
              type: 'textarea',
              ph: 'What does this task cover?',
            },
            {
              key: 'checklist',
              label: 'Checklist items',
              type: 'textarea',
              ph: 'One item per line',
              help: 'Each line becomes a subtask on tasks created from this template.',
            },
          ]}
          onSave={v => saveTemplate(editId, v)}
          onClose={() => setEditId(null)}
        />
      )}
    </SectionShell>
  )
}
