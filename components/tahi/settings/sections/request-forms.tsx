'use client'

/**
 * RequestFormsSection - the intake forms clients fill in when they open a
 * request. Global by default (orgId null); editing a global form while in
 * Per-client mode copies it for that client (copy-on-write) so the global set
 * is never mutated from a client view. Each form carries a list of typed
 * questions plus the design's description / audience / SLA metadata.
 *
 * Data is real:
 *   GET    /api/admin/forms            (optional ?orgId=)  - global list, or
 *          the client's overrides plus inherited globals
 *   POST   /api/admin/forms            - create a template (or an override)
 *   PATCH  /api/admin/forms/[id]       - meta / questions
 *   DELETE /api/admin/forms/[id]       - delete a template
 * Question types: text, textarea, url, select, multiselect, checkbox, file.
 *
 * Admin-only. Rendered inside the settings shell which already gates on admin.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, GripVertical, Plus, Trash2 } from 'lucide-react'
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
  description: string | null
  audience: string
  sla: string | null
}

interface FormsResponse {
  forms: FormTemplate[]
}

interface ClientsResponse {
  organisations: Array<{ id: string; name: string }>
}

type Mode = 'global' | 'client'

// Category value <-> label. Empty value = General (all categories).
const CATEGORIES: Array<{ value: string; label: string }> = [
  { value: '', label: 'General' },
  { value: 'design', label: 'Design' },
  { value: 'development', label: 'Development' },
  { value: 'content', label: 'Content' },
  { value: 'strategy', label: 'Strategy' },
  { value: 'admin', label: 'Admin' },
  { value: 'bug', label: 'Bug' },
]
const CATEGORY_LABELS = CATEGORIES.map(c => c.label)

function categoryLabel(value: string | null): string {
  return CATEGORIES.find(c => c.value === (value ?? ''))?.label ?? 'General'
}
function categoryValue(label: string): string {
  return CATEGORIES.find(c => c.label === label)?.value ?? ''
}

const AUDIENCES: Array<{ value: string; label: string }> = [
  { value: 'all_clients', label: 'All clients' },
  { value: 'retainer_clients', label: 'Retainer clients' },
  { value: 'internal_only', label: 'Internal only' },
]
const AUDIENCE_LABELS = AUDIENCES.map(a => a.label)

function audienceLabel(value: string | null): string {
  return AUDIENCES.find(a => a.value === value)?.label ?? 'All clients'
}
function audienceValue(label: string): string {
  return AUDIENCES.find(a => a.label === label)?.value ?? 'all_clients'
}

const SLA_OPTS = ['Same day', '2 business days', '3 business days', '1 week', 'No SLA']

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
      ? '/api/admin/forms'
      : orgId
        ? `/api/admin/forms?orgId=${orgId}`
        : null

  const { data, isLoading, mutate } = useResource<FormsResponse>(listUrl)
  const rows = data?.forms ?? []
  const waiting = isLoading || (mode === 'client' && !clientsData)

  function markNew(id: string) {
    setNewId(id)
    if (newTimer.current) clearTimeout(newTimer.current)
    newTimer.current = setTimeout(() => setNewId(null), 1400)
  }

  async function createForm() {
    if (busy) return
    if (mode === 'client' && !orgId) return
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
          audience: 'all_clients',
        }),
      })
      if (!res.ok) throw new Error('Failed to create form')
      const json = (await res.json()) as { id: string }
      markNew(json.id)
      await mutate()
      setMetaId(json.id)
    } catch {
      toast('Could not create the form', 'err')
      await mutate()
    } finally {
      setBusy(false)
    }
  }

  async function saveMeta(id: string, values: Record<string, string>) {
    const target = rows.find(r => r.id === id)
    const payload = {
      name: values.name?.trim() || 'Untitled form',
      category: categoryValue(values.cat ?? ''),
      description: values.desc?.trim() || null,
      audience: audienceValue(values.audience ?? ''),
      sla: values.sla && values.sla !== 'No SLA' ? values.sla : null,
    }
    setMetaId(null)
    try {
      if (mode === 'client' && orgId && target && !target.orgId) {
        // Copy-on-write: editing an inherited global form from a client view
        // creates an override for this client instead of mutating the global.
        const res = await fetch(apiPath('/api/admin/forms'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, orgId, questions: target.questions }),
        })
        if (!res.ok) throw new Error('Failed to save form')
        const json = (await res.json()) as { id: string }
        markNew(json.id)
      } else {
        const res = await fetch(apiPath(`/api/admin/forms/${id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error('Failed to save form')
      }
    } catch {
      toast('Could not save the form', 'err')
    } finally {
      await mutate()
    }
  }

  async function saveQuestions(r: FormTemplate, questions: FormQuestion[]) {
    try {
      if (mode === 'client' && orgId && !r.orgId) {
        // Copy-on-write: new questions on an inherited global form become a
        // client override rather than a global edit.
        const res = await fetch(apiPath('/api/admin/forms'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: r.name,
            category: r.category ?? undefined,
            description: r.description,
            audience: r.audience,
            sla: r.sla,
            orgId,
            questions,
          }),
        })
        if (!res.ok) throw new Error('Failed to save questions')
        const json = (await res.json()) as { id: string }
        markNew(json.id)
      } else {
        const res = await fetch(apiPath(`/api/admin/forms/${r.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questions }),
        })
        if (!res.ok) throw new Error('Failed to save questions')
      }
      setQuestionsId(null)
      await mutate()
    } catch {
      toast('Could not save the questions', 'err')
      throw new Error('save-questions-failed')
    }
  }

  function requestDelete(r: FormTemplate) {
    if (mode === 'client' && !r.orgId) {
      toast('This is a global form. Switch to All clients to remove it for everyone.', 'err')
      return
    }
    setConfirmId(r.id)
  }

  async function deleteForm(id: string) {
    setConfirmId(null)
    try {
      const res = await fetch(apiPath(`/api/admin/forms/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete form')
    } catch {
      toast('Could not delete the form', 'err')
    } finally {
      if (questionsId === id) setQuestionsId(null)
      await mutate()
    }
  }

  const editingMeta = metaId ? rows.find(r => r.id === metaId) ?? null : null
  const confirming = confirmId ? rows.find(r => r.id === confirmId) ?? null : null

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
          <EmptyRow text="No forms yet - add one to get started." />
        ) : (
          rows.map((r, i) => {
            const count = Array.isArray(r.questions) ? r.questions.length : 0
            const open = questionsId === r.id
            return (
              <div key={r.id}>
                <div
                  className={'lrow' + (r.id === newId ? ' lrow-enter' : '')}
                  style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
                >
                  <span className="lrow-ic leaf">
                    <FileText size={16} />
                  </span>
                  <div className="lrow-t">
                    <b>{r.name}</b>
                    <small>
                      {categoryLabel(r.category)} &middot; {count} questions
                    </small>
                  </div>
                  <div className="lrow-r">
                    <Chip tone="neutral">{r.orgId ? 'Override' : 'Global'}</Chip>
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
                      onDelete={() => requestDelete(r)}
                    />
                  </div>
                </div>
                {open && (
                  <QuestionEditor
                    key={r.id + ':' + count}
                    form={r}
                    onSave={qs => saveQuestions(r, qs)}
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
          row={{
            name: editingMeta.name,
            cat: categoryLabel(editingMeta.category),
            desc: editingMeta.description ?? '',
            audience: audienceLabel(editingMeta.audience),
            sla: editingMeta.sla ?? 'No SLA',
          }}
          fields={[
            { key: 'name', label: 'Form name' },
            { key: 'cat', label: 'Category', type: 'select', opts: CATEGORY_LABELS },
            {
              key: 'desc',
              label: 'Description',
              type: 'textarea',
              ph: 'What is this form for?',
              help: 'Shown to clients above the form.',
            },
            { key: 'audience', label: 'Who can submit', type: 'select', opts: AUDIENCE_LABELS },
            { key: 'sla', label: 'Target turnaround', type: 'select', opts: SLA_OPTS },
          ]}
          onSave={v => saveMeta(metaId, v)}
          onClose={() => setMetaId(null)}
        />
      )}

      {confirming && (
        <ConfirmDialog
          heading="Delete this form?"
          body={`"${confirming.name}" will be removed${confirming.orgId ? ' for this client' : ' for every client'}. This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => deleteForm(confirming.id)}
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

// -- Inline question editor (repo capability beyond the design, kept) --

function QuestionEditor({
  form,
  onSave,
}: {
  form: FormTemplate
  onSave: (questions: FormQuestion[]) => Promise<void>
}) {
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
      await onSave(questions)
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
