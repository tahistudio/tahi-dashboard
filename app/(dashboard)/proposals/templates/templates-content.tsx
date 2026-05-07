'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft, Plus, Trash2, Pencil, FileText, RefreshCw, Eye, Layers,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { PromptDialog } from '@/components/tahi/prompt-dialog'
import { EmptyState } from '@/components/tahi/empty-state'
import { PageHeader } from '@/components/tahi/page-header'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'

// ── Types ───────────────────────────────────────────────────────────────
//
// The list endpoint returns slim rows. The single-template GET returns the
// full record with the snapshot, which we lazy-load when the user opens
// the preview modal.
interface TemplateListItem {
  id: string
  name: string
  description: string | null
  createdAt: string
  updatedAt: string
}

// Snapshot frozen at save-time. See db/schema.ts proposalTemplates.snapshot
// and app/api/admin/proposals/templates/route.ts for the canonical shape.
interface TemplateSnapshot {
  title?: string | null
  subtitle?: string | null
  sections?: Array<{
    type: string
    title?: string | null
    subtitle?: string | null
    position?: number | null
  }>
  variants?: Array<{
    name?: string | null
    tagline?: string | null
    oneOffAmount?: number | null
    monthlyAmount?: number | null
    currency?: string | null
    isFeatured?: number | null
    position?: number | null
  }>
}

interface TemplateFull extends TemplateListItem {
  snapshot: string | null
}

function relativeTime(iso: string | null): string {
  if (!iso) return '-'
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return iso
  }
}

function safeParseSnapshot(raw: string | null | undefined): TemplateSnapshot | null {
  if (!raw) return null
  try { return JSON.parse(raw) as TemplateSnapshot } catch { return null }
}

export function TemplatesContent() {
  const router = useRouter()
  const { showToast } = useToast()
  const [items, setItems] = useState<TemplateListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [renameTarget, setRenameTarget] = useState<TemplateListItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TemplateListItem | null>(null)
  const [previewTarget, setPreviewTarget] = useState<TemplateListItem | null>(null)
  const [creatingFromId, setCreatingFromId] = useState<string | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/proposals/templates'))
      if (!res.ok) throw new Error('failed')
      const data = await res.json() as { items: TemplateListItem[] }
      setItems(data.items ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  // Rename uses PATCH on the existing endpoint with `name` only.
  async function handleRename(value: string) {
    if (!renameTarget) return
    const trimmed = value.trim()
    if (!trimmed) return
    try {
      const res = await fetch(apiPath(`/api/admin/proposals/templates/${renameTarget.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) throw new Error('failed')
      setRenameTarget(null)
      showToast('Template renamed', 'success')
      void fetchAll()
    } catch {
      showToast('Could not rename template', 'error')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      const res = await fetch(apiPath(`/api/admin/proposals/templates/${deleteTarget.id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      setDeleteTarget(null)
      showToast('Template deleted', 'success')
      void fetchAll()
    } catch {
      showToast('Could not delete template', 'error')
    }
  }

  // Mirrors the createFromTemplate flow on /proposals: POST /api/admin/proposals
  // with templateId, then redirect to the new proposal's editor.
  async function createFromTemplate(t: TemplateListItem) {
    setCreatingFromId(t.id)
    try {
      const res = await fetch(apiPath('/api/admin/proposals'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: t.name,
          templateId: t.id,
          seedDefaults: false,
        }),
      })
      const data = await res.json() as { id?: string }
      if (res.ok && data.id) {
        router.push(`/proposals/${data.id}`)
      } else {
        showToast('Failed to create from template', 'error')
        setCreatingFromId(null)
      }
    } catch {
      showToast('Failed to create from template', 'error')
      setCreatingFromId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/proposals"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          <ArrowLeft className="w-4 h-4" /> Back to proposals
        </Link>
      </div>

      <PageHeader
        title="Proposal templates"
        subtitle="Reusable proposal structures. Save any proposal as a template, then spin up new ones in seconds."
      >
        <TahiButton variant="secondary" size="sm" onClick={fetchAll} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
        <Link href="/proposals">
          <TahiButton size="sm" iconLeft={<Plus className="w-3.5 h-3.5" />}>
            New proposal
          </TahiButton>
        </Link>
      </PageHeader>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Layers className="w-8 h-8 text-white" />}
          title="No proposal templates yet"
          description='Open any proposal and use "Save as template" to capture its sections + packages for reuse.'
          ctaLabel="Browse proposals"
          onCtaClick={() => router.push('/proposals')}
        />
      ) : (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Name</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden md:table-cell">Description</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden lg:table-cell">Created</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden lg:table-cell">Updated</th>
                <th className="text-right px-4 py-3 font-medium text-[var(--color-text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(t => (
                <tr
                  key={t.id}
                  className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
                  onClick={() => setPreviewTarget(t)}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-[var(--color-text)]">{t.name}</div>
                    {t.description && (
                      <div className="text-xs text-[var(--color-text-subtle)] mt-0.5 md:hidden truncate max-w-[18rem]">
                        {t.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)] hidden md:table-cell">
                    {t.description
                      ? <span className="line-clamp-1">{t.description}</span>
                      : <span className="text-[var(--color-text-subtle)]">-</span>}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)] hidden lg:table-cell">
                    {relativeTime(t.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-[var(--color-text-muted)] hidden lg:table-cell">
                    {relativeTime(t.updatedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div
                      className="flex items-center justify-end gap-1"
                      onClick={e => e.stopPropagation()}
                    >
                      <TahiButton
                        variant="secondary"
                        size="sm"
                        onClick={() => createFromTemplate(t)}
                        disabled={creatingFromId !== null}
                        iconLeft={<Plus className="w-3.5 h-3.5" />}
                      >
                        {creatingFromId === t.id ? 'Creating...' : 'New proposal'}
                      </TahiButton>
                      <button
                        onClick={() => setPreviewTarget(t)}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
                        aria-label="Preview"
                        title="Preview"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setRenameTarget(t)}
                        className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
                        aria-label="Rename"
                        title="Rename"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(t)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-subtle)] hover:text-red-500 transition-colors"
                        aria-label="Delete"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PromptDialog
        open={!!renameTarget}
        title="Rename template"
        description="Give this template a new name. Existing proposals are unaffected."
        defaultValue={renameTarget?.name ?? ''}
        placeholder="Template name"
        confirmLabel="Save"
        onConfirm={handleRename}
        onCancel={() => setRenameTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete template"
        description={deleteTarget ? `Delete "${deleteTarget.name}"? Existing proposals created from this template are not affected.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {previewTarget && (
        <PreviewDialog
          template={previewTarget}
          onClose={() => setPreviewTarget(null)}
          onCreate={() => {
            const t = previewTarget
            setPreviewTarget(null)
            void createFromTemplate(t)
          }}
        />
      )}
    </div>
  )
}

// ── Preview modal ───────────────────────────────────────────────────────
//
// Read-only summary of the template's frozen snapshot. We list the section
// titles + types and the package variants so admins can confirm they're
// picking the right starting point before creating a new proposal.
function PreviewDialog({
  template, onClose, onCreate,
}: {
  template: TemplateListItem
  onClose: () => void
  onCreate: () => void
}) {
  const [full, setFull] = useState<TemplateFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(apiPath(`/api/admin/proposals/templates/${template.id}`))
        if (!res.ok) throw new Error('failed')
        const data = await res.json() as { template: TemplateFull }
        if (!cancelled) setFull(data.template)
      } catch {
        if (!cancelled) setError('Could not load template')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [template.id])

  const snapshot = safeParseSnapshot(full?.snapshot)
  const sections = snapshot?.sections ?? []
  const variants = snapshot?.variants ?? []

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-dialog-title"
      >
        <div className="px-6 pt-6 pb-3 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="preview-dialog-title"
                className="text-lg font-bold text-[var(--color-text)] truncate"
              >
                {template.name}
              </h2>
              {template.description && (
                <p className="text-sm text-[var(--color-text-muted)] mt-1">{template.description}</p>
              )}
            </div>
            <span
              className="text-[0.6875rem] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
            >
              Template
            </span>
          </div>
        </div>

        <div className="px-6 py-4 space-y-5">
          {loading ? (
            <LoadingSkeleton rows={3} height={36} />
          ) : error ? (
            <div className="text-sm px-3 py-2 rounded-lg" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
              {error}
            </div>
          ) : (
            <>
              {snapshot?.title && (
                <div>
                  <div className="text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wide mb-1">
                    Proposal title
                  </div>
                  <div className="text-sm text-[var(--color-text)]">{snapshot.title}</div>
                  {snapshot.subtitle && (
                    <div className="text-xs text-[var(--color-text-muted)] mt-0.5">{snapshot.subtitle}</div>
                  )}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wide">
                    Sections ({sections.length})
                  </div>
                </div>
                {sections.length === 0 ? (
                  <div className="text-sm text-[var(--color-text-subtle)] italic">No sections in this template.</div>
                ) : (
                  <ul className="space-y-1.5">
                    {sections.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-3 px-3 py-2 rounded-lg border border-[var(--color-border-subtle)]"
                        style={{ background: 'var(--color-bg-secondary)' }}
                      >
                        <span
                          className="text-[0.625rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5"
                          style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
                        >
                          {s.type}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-[var(--color-text)] truncate">
                            {s.title || <span className="text-[var(--color-text-subtle)] italic">Untitled</span>}
                          </div>
                          {s.subtitle && (
                            <div className="text-xs text-[var(--color-text-muted)] truncate">{s.subtitle}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {variants.length > 0 && (
                <div>
                  <div className="text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wide mb-2">
                    Packages ({variants.length})
                  </div>
                  <ul className="space-y-1.5">
                    {variants.map((v, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--color-border-subtle)]"
                        style={{ background: 'var(--color-bg-secondary)' }}
                      >
                        <FileText className="w-3.5 h-3.5 text-[var(--color-text-subtle)] flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-[var(--color-text)] truncate">
                            {v.name || <span className="text-[var(--color-text-subtle)] italic">Untitled package</span>}
                            {v.isFeatured ? (
                              <span
                                className="ml-2 text-[0.625rem] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
                                style={{ background: 'var(--color-brand-50)', color: 'var(--color-brand-dark)' }}
                              >
                                Featured
                              </span>
                            ) : null}
                          </div>
                          {v.tagline && (
                            <div className="text-xs text-[var(--color-text-muted)] truncate">{v.tagline}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--color-border-subtle)] flex justify-end gap-2">
          <TahiButton variant="secondary" onClick={onClose}>Close</TahiButton>
          <TahiButton onClick={onCreate} iconLeft={<Plus className="w-3.5 h-3.5" />}>
            New proposal from template
          </TahiButton>
        </div>
      </div>
    </div>
  )
}
