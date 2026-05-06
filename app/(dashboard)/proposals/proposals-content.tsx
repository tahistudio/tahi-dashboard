'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, FileText, ExternalLink, Search } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
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

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: 'var(--color-bg-tertiary)', fg: 'var(--color-text-muted)', label: 'Draft' },
  shared: { bg: 'var(--color-brand-50)', fg: 'var(--color-brand-dark)', label: 'Shared' },
  accepted: { bg: '#f0fdf4', fg: '#15803d', label: 'Accepted' },
  declined: { bg: '#fef2f2', fg: '#dc2626', label: 'Declined' },
  withdrawn: { bg: 'var(--color-bg-secondary)', fg: 'var(--color-text-subtle)', label: 'Withdrawn' },
  expired: { bg: 'var(--color-bg-secondary)', fg: 'var(--color-text-subtle)', label: 'Expired' },
}

interface TemplateOption { id: string; name: string; description: string | null }

export function ProposalsContent() {
  const router = useRouter()
  const { showToast } = useToast()
  const [items, setItems] = useState<ProposalListItem[]>([])
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [showCreateDialog, setShowCreateDialog] = useState(false)

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
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      p.title.toLowerCase().includes(q) ||
      (p.orgName ?? '').toLowerCase().includes(q) ||
      (p.dealTitle ?? '').toLowerCase().includes(q) ||
      (p.preparedFor ?? '').toLowerCase().includes(q)
    )
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

  function handleCreate() {
    setShowCreateDialog(true)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <PageHeader
        title="Proposals"
        subtitle="Premium client proposals with package variants and public links"
      >
        <button
          onClick={handleCreate}
          disabled={creating}
          className="inline-flex items-center font-medium hover:-translate-y-px"
          style={{
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            background: 'var(--color-brand)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-leaf-sm)',
            gap: 'var(--space-1-5)',
            transition: 'background-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
            height: '2.25rem',
            cursor: creating ? 'not-allowed' : 'pointer',
            opacity: creating ? 0.6 : 1,
          }}
        >
          <Plus size={15} aria-hidden="true" />
          {creating ? 'Creating…' : 'New proposal'}
        </button>
      </PageHeader>

      <div className="relative" style={{ maxWidth: '24rem' }}>
        <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)', pointerEvents: 'none' }} aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by title, client or deal…"
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem 0.5rem 2.25rem',
            fontSize: '0.875rem',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
          }}
        />
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="animate-pulse rounded-lg" style={{ height: '5rem', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-subtle)' }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl" style={{ padding: '3rem 2rem', border: '1px dashed var(--color-border)', background: 'var(--color-bg)' }}>
          <div className="flex items-center justify-center" style={{ width: '3rem', height: '3rem', borderRadius: 'var(--radius-leaf)', background: 'var(--color-brand-50)', color: 'var(--color-brand)', marginBottom: '1rem' }}>
            <FileText size={20} aria-hidden="true" />
          </div>
          <h3 className="font-semibold" style={{ fontSize: '1rem', color: 'var(--color-text)', marginBottom: '0.25rem' }}>
            {search.trim() ? 'No proposals match your search' : 'No proposals yet'}
          </h3>
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '1rem' }}>
            {search.trim() ? 'Try a different keyword' : 'Create one to send a premium 16:9 deck with 1-3 packages.'}
          </p>
          {!search.trim() && (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center font-medium"
              style={{ padding: 'var(--space-2) var(--space-4)', fontSize: '0.875rem', fontWeight: 600, background: 'var(--color-brand)', color: 'white', border: 'none', borderRadius: 'var(--radius-leaf-sm)', gap: 'var(--space-1-5)', cursor: 'pointer' }}
            >
              <Plus size={15} />
              New proposal
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col" style={{ gap: '0.5rem' }}>
          {filtered.map(p => {
            const tone = STATUS_STYLE[p.status] ?? STATUS_STYLE.draft
            return (
              <Link
                key={p.id}
                href={`/proposals/${p.id}`}
                className="block rounded-xl transition-colors"
                style={{ padding: '1rem 1.25rem', border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg)', textDecoration: 'none', color: 'inherit' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border-subtle)'; e.currentTarget.style.background = 'var(--color-bg)' }}
              >
                <div className="flex items-center justify-between" style={{ gap: '1rem' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="flex items-center" style={{ gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <h3 className="font-semibold truncate" style={{ fontSize: '0.9375rem', color: 'var(--color-text)' }}>
                        {p.title}
                      </h3>
                      <span style={{ padding: '0.125rem 0.5rem', fontSize: '0.6875rem', fontWeight: 600, background: tone.bg, color: tone.fg, borderRadius: 'var(--radius-full)', textTransform: 'uppercase', letterSpacing: '0.03em', flexShrink: 0 }}>
                        {tone.label}
                      </span>
                    </div>
                    <div className="flex items-center" style={{ gap: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)', flexWrap: 'wrap' }}>
                      {p.orgName && <span>{p.orgName}</span>}
                      {p.dealTitle && <span>· {p.dealTitle}</span>}
                      {p.preparedFor && <span>· for {p.preparedFor}</span>}
                      {p.expiresAt && <span>· expires {new Date(p.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>}
                    </div>
                  </div>
                  {p.publicShareToken && <ExternalLink size={14} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} aria-hidden="true" />}
                </div>
              </Link>
            )
          })}
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
