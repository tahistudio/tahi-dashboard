'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Trash2, Save, Calendar } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { EmptyState } from '@/components/tahi/empty-state'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'

interface Template {
  id: string
  name: string
  description: string | null
  isDefault: number
  createdAt: string
  updatedAt: string
}

export function TemplatesContent() {
  const { showToast } = useToast()
  const [items, setItems] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Template | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/schedules/templates'))
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
      const res = await fetch(apiPath(`/api/admin/schedules/templates/${deleteTarget.id}`), { method: 'DELETE' })
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
        <Link href="/schedules" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <ArrowLeft className="w-4 h-4" /> Back to schedules
        </Link>
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Schedule templates</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Reusable schedule blueprints. Save a finished schedule as a template, then start new schedules from it in one click.
          </p>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Calendar className="w-8 h-8 text-white" />}
          title="No templates yet"
          description="Open any schedule, then use the More menu to save it as a template."
        />
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {items.map(t => (
            <div key={t.id} className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-[var(--color-text)] truncate">{t.name}</div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    Updated {new Date(t.updatedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
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

      {editing && (
        <TemplateEditDialog
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void fetchAll() }}
        />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete template"
        description={deleteTarget ? `Delete "${deleteTarget.name}"? Existing schedules created from this template are not affected.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function TemplateEditDialog({
  template, onClose, onSaved,
}: {
  template: Template
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name required'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(apiPath(`/api/admin/schedules/templates/${template.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
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
      <div className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true">
        <div className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-[var(--color-text)]">Edit template</h2>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 space-y-4">
          {error && (
            <div className="text-sm px-3 py-2 rounded-lg" role="alert" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
              {error}
            </div>
          )}
          <div>
            <label htmlFor="tpl-name" className="block text-sm font-medium text-[var(--color-text)] mb-1">Name</label>
            <input id="tpl-name" type="text" value={name} onChange={e => setName(e.target.value)} className={inputCn} />
          </div>
          <div>
            <label htmlFor="tpl-desc" className="block text-sm font-medium text-[var(--color-text)] mb-1">Description (optional)</label>
            <input id="tpl-desc" type="text" value={description} onChange={e => setDescription(e.target.value)} className={inputCn} />
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Sections, rows, and weekly layout are captured automatically. To redefine the contents, save a new template from a schedule that has the structure you want.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <TahiButton variant="secondary" type="button" onClick={onClose}>Cancel</TahiButton>
            <TahiButton type="submit" loading={saving} iconLeft={<Save className="w-3.5 h-3.5" />}>
              Save
            </TahiButton>
          </div>
        </form>
      </div>
    </div>
  )
}
