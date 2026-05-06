'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, Save, FileSignature } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { EmptyState } from '@/components/tahi/empty-state'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'

interface Template {
  id: string
  type: string
  name: string
  bodyHtml: string
  variableDefs: string | null
  isDefault: number
  description: string | null
  createdAt: string
  updatedAt: string
}

const TYPES = ['nda', 'sla', 'msa', 'sow', 'mou', 'other'] as const

export function TemplatesContent() {
  const { showToast } = useToast()
  const [items, setItems] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Template | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/contracts/templates'))
      if (!res.ok) throw new Error('failed')
      const data = await res.json() as { items: Template[] }
      setItems(data.items ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/templates/${deleteTarget.id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      setDeleteTarget(null)
      void fetchAll()
    } catch {
      showToast('Could not delete.', 'error')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/contracts" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <ArrowLeft className="w-4 h-4" /> Back to contracts
        </Link>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Contract templates</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Reusable contract bodies. Use <code className="bg-[var(--color-bg-tertiary)] px-1 rounded">&#123;&#123;variable&#125;&#125;</code> for slots filled in at create time.
          </p>
        </div>
        <TahiButton size="sm" onClick={() => setShowCreate(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
          New template
        </TahiButton>
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<FileSignature className="w-8 h-8 text-white" />}
          title="No templates yet"
          description="Templates speed up contract creation — author once, fill slots per client."
          ctaLabel="New template"
          onCtaClick={() => setShowCreate(true)}
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {items.map(t => (
            <div key={t.id} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-[var(--color-text)] truncate">{t.name}</div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5 uppercase tracking-wide">{t.type}</div>
                  {t.description && <p className="text-sm text-[var(--color-text-muted)] mt-2">{t.description}</p>}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditing(t)}
                    className="text-xs px-2 py-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleteTarget(t)}
                    className="p-1 rounded hover:bg-red-50 text-[var(--color-text-subtle)] hover:text-red-500 transition-colors"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <TemplateDialog
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); void fetchAll() }}
        />
      )}
      {editing && (
        <TemplateDialog
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void fetchAll() }}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete template"
        description={deleteTarget ? `Delete "${deleteTarget.name}"? Existing contracts using this template are not affected.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function TemplateDialog({
  template, onClose, onSaved,
}: {
  template?: Template
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(template?.name ?? '')
  const [type, setType] = useState(template?.type ?? 'sow')
  const [description, setDescription] = useState(template?.description ?? '')
  const [bodyHtml, setBodyHtml] = useState(template?.bodyHtml ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !bodyHtml.trim()) { setError('Name and body required'); return }
    setSaving(true)
    setError('')
    try {
      const url = template ? `/api/admin/contracts/templates/${template.id}` : '/api/admin/contracts/templates'
      const method = template ? 'PATCH' : 'POST'
      const res = await fetch(apiPath(url), {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type,
          description: description.trim() || null,
          bodyHtml,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed')
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCn = 'w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true">
        <div className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-[var(--color-text)]">{template ? 'Edit template' : 'New template'}</h2>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 space-y-4">
          {error && (
            <div className="text-sm px-3 py-2 rounded-lg" role="alert" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
              {error}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="tpl-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">Name</label>
              <input id="tpl-name" type="text" value={name} onChange={e => setName(e.target.value)} className={inputCn} />
            </div>
            <div>
              <label htmlFor="tpl-type" className="block text-sm font-medium text-[var(--color-text)] mb-1">Type</label>
              <select id="tpl-type" value={type} onChange={e => setType(e.target.value)} className={inputCn}>
                {TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="tpl-desc" className="block text-sm font-medium text-[var(--color-text)] mb-1">Description (optional)</label>
            <input id="tpl-desc" type="text" value={description} onChange={e => setDescription(e.target.value)} className={inputCn} />
          </div>
          <div>
            <label htmlFor="tpl-body" className="block text-sm font-medium text-[var(--color-text)] mb-1">Body (HTML)</label>
            <textarea
              id="tpl-body"
              rows={16}
              value={bodyHtml}
              onChange={e => setBodyHtml(e.target.value)}
              className={`${inputCn} font-mono`}
              style={{ fontSize: '0.8125rem', lineHeight: 1.5 }}
              placeholder="<h2>Statement of Work</h2><p>This SOW is between {{provider_name}} and {{client_name}}...</p>"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <TahiButton variant="secondary" type="button" onClick={onClose}>Cancel</TahiButton>
            <TahiButton type="submit" loading={saving} iconLeft={<Save className="w-3.5 h-3.5" />}>
              {template ? 'Save' : 'Create'}
            </TahiButton>
          </div>
        </form>
      </div>
    </div>
  )
}
