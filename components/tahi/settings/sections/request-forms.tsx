'use client'

/**
 * RequestFormsSection - the intake forms clients fill in when they open a
 * request. Global by default (orgId null); a client override replaces the global
 * set for that client. Each form carries a list of typed questions.
 *
 * Data is real and matches the previous FormsSection + FormEditor wiring:
 *   GET    /api/admin/forms            (optional ?orgId=)  - list templates
 *   POST   /api/admin/forms            - create a template
 *   PATCH  /api/admin/forms/[id]       - rename / recategorise / save questions
 *   DELETE /api/admin/forms/[id]       - delete a template
 * Question types: text, textarea, url, select, multiselect, checkbox, file.
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useEffect, useState } from 'react'
import { FileText, GripVertical, Plus, Trash2 } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  Seg,
  EditDialog,
  RowActions,
  EmptyRow,
  Chip,
} from '@/components/tahi/settings/primitives'

interface FormQuestion {
  id: string
  type: string
  label: string
  required: boolean
  options?: string[]
}

interface FormTemplate {
  id: string
  name: string
  category: string | null
  orgId: string | null
  questions: FormQuestion[]
  isDefault: number
}

interface FormsResponse {
  forms: FormTemplate[]
}

interface ClientsResponse {
  organisations: Array<{ id: string; name: string }>
}

type Mode = 'global' | 'client'

// Category value <-> label. Empty value = global (all categories).
const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Global (all categories)' },
  { value: 'design', label: 'Design' },
  { value: 'development', label: 'Development' },
  { value: 'content', label: 'Content' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'admin', label: 'Admin' },
  { value: 'bug', label: 'Bug' },
]

const CATEGORY_LABELS = CATEGORIES.map(c => c.label)

function categoryLabel(value: string | null): string {
  return CATEGORIES.find(c => c.value === (value ?? ''))?.label ?? CATEGORIES[0].label
}

function categoryValue(label: string): string {
  return CATEGORIES.find(c => c.label === label)?.value ?? ''
}

const QUESTION_TYPES: Array<{ value: string; label: string }> = [
  { value: 'text', label: 'Short text' },
  { value: 'textarea', label: 'Long text' },
  { value: 'url', label: 'URL' },
  { value: 'select', label: 'Dropdown' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'file', label: 'File upload' },
]

export function RequestFormsSection(_props: { isAdmin?: boolean } = {}) {
  const [mode, setMode] = useState<Mode>('global')
  const [orgId, setOrgId] = useState('')
  const [metaId, setMetaId] = useState<string | null>(null)
  const [questionsId, setQuestionsId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: clientsData } = useResource<ClientsResponse>(
    mode === 'client' ? '/api/admin/clients' : null,
  )
  const clients = clientsData?.organisations ?? []

  // Default the client selection to the first org once the list loads.
  useEffect(() => {
    if (mode === 'client' && !orgId && clients.length > 0) {
      setOrgId(clients[0].id)
    }
  }, [mode, orgId, clients])

  const listUrl =
    mode === 'global'
      ? '/api/admin/forms'
      : orgId
        ? `/api/admin/forms?orgId=${orgId}`
        : null

  const { data, isLoading, mutate } = useResource<FormsResponse>(listUrl)
  const rows = data?.forms ?? []

  async function createForm() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(apiPath('/api/admin/forms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New form',
          category: undefined,
          orgId: mode === 'client' ? orgId : undefined,
          questions: [],
        }),
      })
      if (!res.ok) throw new Error('Failed to create form')
      const json = (await res.json()) as { id: string }
      await mutate()
      setMetaId(json.id)
    } catch {
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  async function saveMeta(id: string, values: Record<string, string>) {
    try {
      const res = await fetch(apiPath(`/api/admin/forms/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name?.trim() || undefined,
          category: categoryValue(values.category ?? ''),
        }),
      })
      if (!res.ok) throw new Error('Failed to save form')
    } finally {
      setMetaId(null)
      await mutate()
    }
  }

  async function deleteForm(id: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/forms/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete form')
    } finally {
      if (questionsId === id) setQuestionsId(null)
      await mutate()
    }
  }

  const editingMeta = metaId ? rows.find(r => r.id === metaId) ?? null : null

  return (
    <SectionShell
      title="Request forms"
      lede="The intake forms clients fill in. Set a global set, or tailor per client."
      action={
        <button type="button" className="btn1" onClick={createForm} disabled={busy}>
          <Plus size={15} />
          New form
        </button>
      }
    >
      <div className="set-card" style={{ marginBottom: 16 }}>
        <div className="set-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
          <div className="sr-t">
            <b>Applies to</b>
            <small>
              {mode === 'global'
                ? 'These forms apply to every client.'
                : 'Overrides just this client; others keep the global set.'}
            </small>
          </div>
          <div className="ctl-line">
            <Seg
              aria="Scope"
              value={mode}
              onChange={v => setMode(v as Mode)}
              opts={[
                ['global', 'All clients'],
                ['client', 'Per client'],
              ]}
            />
            {mode === 'client' && (
              <select
                className="set-input"
                style={{ maxWidth: 240 }}
                value={orgId}
                onChange={e => setOrgId(e.target.value)}
                aria-label="Client"
                disabled={clients.length === 0}
              >
                {clients.length === 0 ? (
                  <option value="">No clients yet</option>
                ) : (
                  clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))
                )}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="set-card lrow-wrap">
        {isLoading ? (
          <EmptyRow text="Loading forms..." />
        ) : rows.length === 0 ? (
          <EmptyRow text="No forms yet - add one to get started." />
        ) : (
          rows.map((r, i) => {
            const count = Array.isArray(r.questions) ? r.questions.length : 0
            const open = questionsId === r.id
            return (
              <div key={r.id}>
                <div
                  className="lrow"
                  style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
                >
                  <span className="lrow-ic leaf">
                    <FileText size={16} />
                  </span>
                  <div className="lrow-t">
                    <b>{r.name}</b>
                    <small>
                      {categoryLabel(r.category)} &middot; {count} question{count === 1 ? '' : 's'}
                      {r.isDefault ? ' (default)' : ''}
                    </small>
                  </div>
                  <div className="lrow-r">
                    <Chip tone={r.orgId ? 'info' : 'neutral'}>{r.orgId ? 'Override' : 'Global'}</Chip>
                    <button
                      type="button"
                      className="btn2 sm"
                      onClick={() => setQuestionsId(open ? null : r.id)}
                      aria-expanded={open}
                    >
                      {open ? 'Close' : 'Questions'}
                    </button>
                    <RowActions
                      onEdit={() => setMetaId(r.id)}
                      onDelete={() => deleteForm(r.id)}
                    />
                  </div>
                </div>
                {open && (
                  <QuestionEditor
                    key={r.id + ':' + count}
                    form={r}
                    onSaved={async () => {
                      setQuestionsId(null)
                      await mutate()
                    }}
                  />
                )}
              </div>
            )
          })
        )}
      </div>

      {metaId && editingMeta && (
        <EditDialog
          heading="Edit request form"
          row={{ name: editingMeta.name, category: categoryLabel(editingMeta.category) }}
          fields={[
            { key: 'name', label: 'Form name' },
            { key: 'category', label: 'Category', type: 'select', opts: CATEGORY_LABELS },
          ]}
          onSave={v => saveMeta(metaId, v)}
          onClose={() => setMetaId(null)}
        />
      )}
    </SectionShell>
  )
}

// -- Inline question editor (ports the previous FormEditor behaviour) --

function QuestionEditor({ form, onSaved }: { form: FormTemplate; onSaved: () => void }) {
  const [questions, setQuestions] = useState<FormQuestion[]>(
    Array.isArray(form.questions) ? form.questions : [],
  )
  const [saving, setSaving] = useState(false)

  function addQuestion() {
    setQuestions([
      ...questions,
      { id: crypto.randomUUID(), type: 'text', label: '', required: false },
    ])
  }

  function updateQuestion(idx: number, updates: Partial<FormQuestion>) {
    setQuestions(questions.map((q, i) => (i === idx ? { ...q, ...updates } : q)))
  }

  function removeQuestion(idx: number) {
    setQuestions(questions.filter((_, i) => i !== idx))
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/forms/${form.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      })
      if (!res.ok) throw new Error('Failed to save questions')
      onSaved()
    } catch {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-secondary)',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {questions.length === 0 && (
        <small style={{ color: 'var(--text-faint)', font: '500 12.5px Manrope' }}>
          No questions yet. Add the first field clients should fill in.
        </small>
      )}

      {questions.map((q, i) => {
        const hasOptions = q.type === 'select' || q.type === 'multiselect'
        return (
          <div
            key={q.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: 10,
            }}
          >
            <span style={{ color: 'var(--text-faint)', display: 'flex', marginTop: 9, flexShrink: 0 }}>
              <GripVertical size={16} />
            </span>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="set-input"
                  style={{ flex: '2 1 180px' }}
                  value={q.label}
                  onChange={e => updateQuestion(i, { label: e.target.value })}
                  placeholder="Question label"
                  aria-label="Question label"
                />
                <select
                  className="set-input"
                  style={{ flex: '1 1 140px' }}
                  value={q.type}
                  onChange={e => updateQuestion(i, { type: e.target.value })}
                  aria-label="Question type"
                >
                  {QUESTION_TYPES.map(t => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    font: '500 12.5px Manrope',
                    color: 'var(--text-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={e => updateQuestion(i, { required: e.target.checked })}
                    style={{ accentColor: 'var(--brand)' }}
                  />
                  Required
                </label>
              </div>
              {hasOptions && (
                <input
                  className="set-input"
                  value={(q.options ?? []).join(', ')}
                  onChange={e =>
                    updateQuestion(i, {
                      options: e.target.value
                        .split(',')
                        .map(s => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Options (comma-separated)"
                  aria-label="Options"
                />
              )}
            </div>
            <button
              type="button"
              className="ta-icobtn sm"
              onClick={() => removeQuestion(i)}
              aria-label="Remove question"
              style={{ marginTop: 2 }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        )
      })}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <button type="button" className="btn-ghost" onClick={addQuestion}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Plus size={14} />
            Add question
          </span>
        </button>
        <button type="button" className="btn1" onClick={save} disabled={saving}>
          {saving ? 'Saving...' : 'Save questions'}
        </button>
      </div>
    </div>
  )
}
