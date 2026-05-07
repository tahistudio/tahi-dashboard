'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import {
  FileText, Plus, Search, RefreshCw, Building2, Target, Trash2, ExternalLink, Eye,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { EmptyState } from '@/components/tahi/empty-state'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { Input } from '@/components/tahi/input'
import { useToast } from '@/components/tahi/toast'

interface ProposalListItem {
  id: string
  orgId: string | null
  dealId: string | null
  title: string
  subtitle: string | null
  preparedFor: string | null
  effectiveDate: string | null
  expiresAt: string | null
  status: string
  publicShareToken: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
  orgName: string | null
  dealTitle: string | null
}

type ProposalStatus = 'draft' | 'shared' | 'accepted' | 'declined' | 'withdrawn' | 'expired'

const STATUS_STYLES: Record<ProposalStatus, { bg: string; color: string; label: string }> = {
  draft: { bg: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)', label: 'Draft' },
  shared: { bg: '#eff6ff', color: '#1e40af', label: 'Shared' },
  accepted: { bg: '#f0fdf4', color: '#166534', label: 'Accepted' },
  declined: { bg: '#fef2f2', color: '#991b1b', label: 'Declined' },
  withdrawn: { bg: 'var(--color-bg-secondary)', color: 'var(--color-text-subtle)', label: 'Withdrawn' },
  expired: { bg: '#fff7ed', color: '#9a3412', label: 'Expired' },
}

const STATUS_TABS: { value: 'all' | ProposalStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'shared', label: 'Shared' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'expired', label: 'Expired' },
]

interface TemplateOption { id: string; name: string; description: string | null }

function statusKey(status: string): ProposalStatus {
  return (status in STATUS_STYLES ? status : 'draft') as ProposalStatus
}

function relativeTime(iso: string | null): string {
  if (!iso) return '-'
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return iso
  }
}

export function ProposalsContent() {
  const router = useRouter()
  const { showToast } = useToast()
  const [items, setItems] = useState<ProposalListItem[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ProposalStatus>('all')
  const [creating, setCreating] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProposalListItem | null>(null)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, tRes] = await Promise.all([
        fetch(apiPath('/api/admin/proposals')),
        fetch(apiPath('/api/admin/proposals/templates')),
      ])
      if (pRes.ok) {
        const data = await pRes.json() as { items: ProposalListItem[] }
        setItems(data.items ?? [])
      } else {
        setItems([])
      }
      if (tRes.ok) {
        const data = await tRes.json() as { items: TemplateOption[] }
        setTemplates(data.items ?? [])
      }
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const filtered = items.filter(p => {
    if (statusFilter !== 'all' && statusKey(p.status) !== statusFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!p.title.toLowerCase().includes(q) &&
          !(p.orgName ?? '').toLowerCase().includes(q) &&
          !(p.dealTitle ?? '').toLowerCase().includes(q) &&
          !(p.preparedFor ?? '').toLowerCase().includes(q)) return false
    }
    return true
  })

  async function createBlankProposal() {
    setCreating(true)
    try {
      const res = await fetch(apiPath('/api/admin/proposals'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'New proposal',
          subtitle: 'PROPOSAL',
          seedDefaults: true,
        }),
      })
      const data = await res.json() as { id?: string }
      if (res.ok && data.id) {
        router.push(`/proposals/${data.id}`)
      } else {
        showToast('Failed to create proposal', 'error')
      }
    } catch {
      showToast('Failed to create proposal', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function createFromTemplate(templateId: string, title: string) {
    setCreating(true)
    try {
      const res = await fetch(apiPath('/api/admin/proposals'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          templateId,
          seedDefaults: false,
        }),
      })
      const data = await res.json() as { id?: string }
      if (res.ok && data.id) {
        router.push(`/proposals/${data.id}`)
      } else {
        showToast('Failed to create from template', 'error')
      }
    } catch {
      showToast('Failed to create from template', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const res = await fetch(apiPath(`/api/admin/proposals/${deleteTarget.id}`), { method: 'DELETE' })
    if (res.ok) {
      setDeleteTarget(null)
      void fetchAll()
    } else {
      showToast('Failed to delete proposal', 'error')
    }
  }

  function openCreate() {
    setShowCreateDialog(true)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proposals"
        subtitle="Premium client proposals with package variants and public links."
      >
        <TahiButton variant="secondary" size="sm" onClick={fetchAll} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
        <TahiButton size="sm" onClick={openCreate} disabled={creating} iconLeft={<Plus className="w-3.5 h-3.5" />}>
          {creating ? 'Creating...' : 'New proposal'}
        </TahiButton>
      </PageHeader>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 max-w-sm">
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search proposals..."
            leadingIcon={<Search size={14} aria-hidden="true" />}
            style={{ width: '100%' }}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
              style={{
                background: statusFilter === tab.value ? 'var(--color-brand)' : 'var(--color-bg-tertiary)',
                color: statusFilter === tab.value ? 'white' : 'var(--color-text-muted)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : filtered.length === 0 ? (
        items.length === 0 ? (
          <EmptyState
            icon={<FileText className="w-8 h-8 text-white" />}
            title="No proposals yet"
            description="Create one to send a premium 16:9 deck with 1-3 packages."
            ctaLabel="New proposal"
            onCtaClick={openCreate}
          />
        ) : (
          <EmptyState
            variant="inline"
            icon={<FileText className="w-8 h-8" />}
            title="No proposals match your filters"
            description="Try clearing the search or changing the status tab."
          />
        )
      ) : (
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Name</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)]">Status</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden md:table-cell">Org</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden md:table-cell">Deal</th>
                <th className="text-left px-4 py-3 font-medium text-[var(--color-text-muted)] hidden lg:table-cell">Updated</th>
                <th className="text-right px-4 py-3 font-medium text-[var(--color-text-muted)]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const sty = STATUS_STYLES[statusKey(p.status)]
                return (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--color-border-subtle)] last:border-0 hover:bg-[var(--color-bg-secondary)] transition-colors cursor-pointer"
                    onClick={() => router.push(`/proposals/${p.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--color-text)]">{p.title}</div>
                      {p.preparedFor && (
                        <div className="text-xs text-[var(--color-text-subtle)] mt-0.5 md:hidden">
                          for {p.preparedFor}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ background: sty.bg, color: sty.color }}
                      >
                        {sty.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden md:table-cell">
                      {p.orgId && p.orgName ? (
                        <Link
                          href={`/clients/${p.orgId}`}
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 hover:text-[var(--color-brand-dark)] transition-colors"
                        >
                          <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate max-w-[14rem]">{p.orgName}</span>
                        </Link>
                      ) : <span className="text-[var(--color-text-subtle)]">-</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden md:table-cell">
                      {p.dealId && p.dealTitle ? (
                        <Link
                          href={`/pipeline/${p.dealId}`}
                          onClick={e => e.stopPropagation()}
                          className="inline-flex items-center gap-1.5 hover:text-[var(--color-brand-dark)] transition-colors"
                        >
                          <Target className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate max-w-[14rem]">{p.dealTitle}</span>
                        </Link>
                      ) : <span className="text-[var(--color-text-subtle)]">-</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--color-text-muted)] hidden lg:table-cell">
                      {relativeTime(p.updatedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div
                        className="flex items-center justify-end gap-1"
                        onClick={e => e.stopPropagation()}
                      >
                        {p.publicShareToken && (
                          <a
                            href={`/dashboard/p/proposal/${p.publicShareToken}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
                            aria-label="Open public viewer"
                            title="Open public viewer"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                        <Link
                          href={`/proposals/${p.id}`}
                          className="p-1.5 rounded-lg hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-subtle)] hover:text-[var(--color-text)] transition-colors"
                          aria-label="Preview"
                          title="Preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Link>
                        <button
                          onClick={() => setDeleteTarget(p)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--color-text-subtle)] hover:text-red-500 transition-colors"
                          aria-label="Delete"
                          title="Delete"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreateDialog && (
        <CreateProposalDialog
          templates={templates}
          creating={creating}
          onClose={() => setShowCreateDialog(false)}
          onPickBlank={() => { setShowCreateDialog(false); void createBlankProposal() }}
          onPickTemplate={(t) => { setShowCreateDialog(false); void createFromTemplate(t.id, t.name) }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete proposal"
        description={deleteTarget ? `Delete "${deleteTarget.title}"? This removes all sections and variants. Cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function CreateProposalDialog({
  templates, creating, onClose, onPickBlank, onPickTemplate,
}: {
  templates: TemplateOption[]
  creating: boolean
  onClose: () => void
  onPickBlank: () => void
  onPickTemplate: (t: TemplateOption) => void
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-md"
        role="dialog"
        aria-modal="true"
      >
        <div className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-[var(--color-text)]">New proposal</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Start from blank or instantiate from a saved template.</p>
        </div>
        <div className="px-6 pb-6 space-y-2">
          <button
            onClick={onPickBlank}
            disabled={creating}
            className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-50)] transition-colors"
          >
            <span className="inline-flex items-center justify-center" style={{ width: '2rem', height: '2rem', background: 'var(--color-bg-tertiary)', borderRadius: '0 12px 0 12px' }}>
              <Plus size={14} className="text-[var(--color-text-muted)]" />
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[var(--color-text)]">Blank proposal</div>
              <div className="text-xs text-[var(--color-text-muted)]">Start from scratch with one default section.</div>
            </div>
          </button>
          {templates.length > 0 && (
            <>
              <div className="text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wide pt-3 pb-1">Templates</div>
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => onPickTemplate(t)}
                  disabled={creating}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--color-border)] hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-50)] transition-colors"
                >
                  <span className="inline-flex items-center justify-center" style={{ width: '2rem', height: '2rem', background: 'var(--color-brand-50)', borderRadius: '0 12px 0 12px' }}>
                    <span className="text-sm font-bold text-[var(--color-brand-dark)]">{t.name.slice(0, 1).toUpperCase()}</span>
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-[var(--color-text)] truncate">{t.name}</div>
                    {t.description && <div className="text-xs text-[var(--color-text-muted)] truncate">{t.description}</div>}
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
        <div className="px-6 pb-6 flex justify-end">
          <button
            onClick={onClose}
            disabled={creating}
            className="text-sm font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
