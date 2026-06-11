'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import {
  FileText, Plus, Search, RefreshCw, Building2, Target, Trash2, ExternalLink, Eye,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { Input } from '@/components/tahi/input'
import { useToast } from '@/components/tahi/toast'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { SlideOver } from '@/components/tahi/slide-over'

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

// Status → Badge tone mapping. Tones come from the locked design system
// (see components/tahi/badge.tsx TONE_MAP) so colours stay consistent
// with the rest of the dashboard's status chips.
const STATUS_META: Record<ProposalStatus, { tone: BadgeTone; label: string }> = {
  draft:     { tone: 'neutral',  label: 'Draft' },
  shared:    { tone: 'info',     label: 'Shared' },
  accepted:  { tone: 'positive', label: 'Accepted' },
  declined:  { tone: 'danger',   label: 'Declined' },
  withdrawn: { tone: 'neutral',  label: 'Withdrawn' },
  expired:   { tone: 'warning',  label: 'Expired' },
}

const STATUS_OPTIONS: { value: ProposalStatus; label: string; tone: BadgeTone }[] = [
  { value: 'draft',     label: 'Draft',     tone: 'neutral'  },
  { value: 'shared',    label: 'Shared',    tone: 'info'     },
  { value: 'accepted',  label: 'Accepted',  tone: 'positive' },
  { value: 'declined',  label: 'Declined',  tone: 'danger'   },
  { value: 'withdrawn', label: 'Withdrawn', tone: 'neutral'  },
  { value: 'expired',   label: 'Expired',   tone: 'warning'  },
]

interface TemplateOption { id: string; name: string; description: string | null }

function statusKey(status: string): ProposalStatus {
  return (status in STATUS_META ? status : 'draft') as ProposalStatus
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
  // Status filter held as an ActiveFilter so the FilterBar primitive
  // can drive it. Seeded with an empty multiselect so the chip is
  // permanent (nonRemovable) and the "+ Add filter" button never
  // appears — status is the only filter we expose here.
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([
    { id: 'status', values: [] },
  ])
  const selectedStatuses = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'status')
    return new Set((f?.values ?? []) as ProposalStatus[])
  }, [activeFilters])
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

  const filtered = useMemo(() => items.filter(p => {
    if (selectedStatuses.size > 0 && !selectedStatuses.has(statusKey(p.status))) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!p.title.toLowerCase().includes(q) &&
          !(p.orgName ?? '').toLowerCase().includes(q) &&
          !(p.dealTitle ?? '').toLowerCase().includes(q) &&
          !(p.preparedFor ?? '').toLowerCase().includes(q)) return false
    }
    return true
  }), [items, search, selectedStatuses])

  // FilterBar definitions. Status is a multiselect chip so a single
  // chip can hold any subset of statuses. nonRemovable hides the X.
  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'status',
      label: 'Status',
      kind: 'multiselect',
      nonRemovable: true,
      options: STATUS_OPTIONS.map(s => ({ value: s.value, label: s.label, tone: s.tone })),
    },
  ]), [])

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

  // Column defs for the DataTable. Sortable headers use DataTable's
  // internal sort. Org and Deal cells render as inline links that
  // stopPropagation so they don't trigger the row open.
  const columns: DataTableColumn<ProposalListItem>[] = [
    {
      key: 'title',
      header: 'Name',
      sortable: true,
      sortValue: r => r.title.toLowerCase(),
      minWidth: '18rem',
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
          <FileText size={14} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div data-private style={{
              fontWeight: 600,
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{r.title}</div>
            {r.preparedFor && (
              <div style={{
                fontSize: '0.6875rem',
                color: 'var(--color-text-subtle)',
                marginTop: '0.125rem',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                for <span data-private>{r.preparedFor}</span>
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => statusKey(r.status),
      width: '8rem',
      render: r => {
        const meta = STATUS_META[statusKey(r.status)]
        return (
          <Badge tone={meta.tone} variant="soft" size="sm" dot>
            {meta.label}
          </Badge>
        )
      },
    },
    {
      key: 'org',
      header: 'Org',
      sortable: true,
      sortValue: r => (r.orgName ?? '').toLowerCase(),
      minWidth: '12rem',
      render: r => (
        r.orgId && r.orgName ? (
          <Link
            href={`/clients/${r.orgId}`}
            onClick={e => e.stopPropagation()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              color: 'var(--color-text-muted)',
              textDecoration: 'none',
              transition: 'color 120ms ease',
              maxWidth: '14rem',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand-dark)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <Building2 size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span data-private style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.orgName}
            </span>
          </Link>
        ) : (
          <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>—</span>
        )
      ),
    },
    {
      key: 'deal',
      header: 'Deal',
      sortable: true,
      sortValue: r => (r.dealTitle ?? '').toLowerCase(),
      minWidth: '12rem',
      render: r => (
        r.dealId && r.dealTitle ? (
          <Link
            href={`/pipeline/${r.dealId}`}
            onClick={e => e.stopPropagation()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.375rem',
              color: 'var(--color-text-muted)',
              textDecoration: 'none',
              transition: 'color 120ms ease',
              maxWidth: '14rem',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand-dark)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
          >
            <Target size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span data-private style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.dealTitle}
            </span>
          </Link>
        ) : (
          <span style={{ color: 'var(--color-text-subtle)', fontSize: '0.6875rem' }}>—</span>
        )
      ),
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortable: true,
      sortValue: r => r.updatedAt,
      width: '10rem',
      render: r => (
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          {relativeTime(r.updatedAt)}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Proposals"
        subtitle="Premium client proposals with package variants and public links."
      >
        <TahiButton variant="secondary" size="sm" onClick={fetchAll} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
        <Link href="/proposals/templates">
          <TahiButton variant="secondary" size="sm">
            Templates
          </TahiButton>
        </Link>
        <TahiButton size="sm" onClick={openCreate} disabled={creating} iconLeft={<Plus className="w-3.5 h-3.5" />}>
          {creating ? 'Creating...' : 'New proposal'}
        </TahiButton>
      </PageHeader>

      {/* Filter row — FilterBar with search + permanent status
          multiselect chip. Matches the docs / contracts / leads
          pattern. */}
      <FilterBar
        filters={filterDefs}
        active={activeFilters}
        onChange={setActiveFilters}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search proposals, orgs, deals',
        }}
        size="sm"
      />

      {/* Table — wrapped in a Card so rows sit on a real white surface
          with rounded corners, matching the DataTable showcase. */}
      <Card padding="none">
        <DataTable<ProposalListItem>
          ariaLabel="Proposals"
          columns={columns}
          rows={filtered}
          getRowId={r => r.id}
          defaultSort={{ key: 'updatedAt', dir: 'desc' }}
          loading={loading}
          empty={
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
                description="Try clearing the search or changing the status chip."
              />
            )
          }
          onRowClick={(r) => router.push(`/proposals/${r.id}`)}
          rowActions={(r) => {
            const actions = [
              {
                label: 'Open',
                icon: <Eye size={14} />,
                onClick: () => router.push(`/proposals/${r.id}`),
              },
            ]
            if (r.publicShareToken) {
              actions.push({
                label: 'Open public viewer',
                icon: <ExternalLink size={14} />,
                onClick: () => {
                  window.open(`/dashboard/p/proposal/${r.publicShareToken}`, '_blank', 'noopener,noreferrer')
                },
              })
            }
            return [
              ...actions,
              {
                label: 'Delete',
                icon: <Trash2 size={14} />,
                onClick: () => setDeleteTarget(r),
                tone: 'danger' as const,
              },
            ]
          }}
        />
      </Card>

      <CreateProposalSlideOver
        open={showCreateDialog}
        templates={templates}
        creating={creating}
        onClose={() => setShowCreateDialog(false)}
        onPickBlank={() => { setShowCreateDialog(false); void createBlankProposal() }}
        onPickTemplate={(t) => { setShowCreateDialog(false); void createFromTemplate(t.id, t.name) }}
      />

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

// ── Create slide-over ──────────────────────────────────────────────────────
//
// Replaces the centred modal pattern with the design-system SlideOver so
// proposal creation matches docs / leads / requests. The picker still
// fires the same createBlankProposal / createFromTemplate handlers from
// the parent so business logic is untouched.

function CreateProposalSlideOver({
  open,
  templates,
  creating,
  onClose,
  onPickBlank,
  onPickTemplate,
}: {
  open: boolean
  templates: TemplateOption[]
  creating: boolean
  onClose: () => void
  onPickBlank: () => void
  onPickTemplate: (t: TemplateOption) => void
}) {
  // Local search across templates so a long catalogue stays usable.
  const [tplSearch, setTplSearch] = useState('')
  const filteredTemplates = useMemo(() => {
    const q = tplSearch.trim().toLowerCase()
    if (!q) return templates
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.description ?? '').toLowerCase().includes(q),
    )
  }, [templates, tplSearch])

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      icon={<Plus size={15} />}
      title="New proposal"
      subtitle="Start from blank or instantiate from a saved template."
      maxWidth="48rem"
    >
      <SlideOver.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {/* Blank option — always first */}
          <button
            type="button"
            onClick={onPickBlank}
            disabled={creating}
            className="tahi-focus-ring"
            style={{
              width: '100%',
              textAlign: 'left',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              padding: '0.875rem 1rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              cursor: creating ? 'not-allowed' : 'pointer',
              opacity: creating ? 0.6 : 1,
              transition: 'background-color 150ms ease, border-color 150ms ease',
            }}
            onMouseEnter={e => {
              if (creating) return
              e.currentTarget.style.background = 'var(--color-brand-50)'
              e.currentTarget.style.borderColor = 'var(--color-brand)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--color-bg)'
              e.currentTarget.style.borderColor = 'var(--color-border)'
            }}
          >
            <span
              aria-hidden="true"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '2.25rem',
                height: '2.25rem',
                background: 'var(--color-bg-tertiary)',
                color: 'var(--color-text-muted)',
                borderRadius: 'var(--radius-leaf-sm)',
                flexShrink: 0,
              }}
            >
              <Plus size={15} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'var(--color-text)',
              }}>Blank proposal</div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                marginTop: '0.125rem',
              }}>Start from scratch with one default section.</div>
            </div>
          </button>

          {templates.length > 0 && (
            <>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                marginTop: '0.25rem',
              }}>
                <div style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: 'var(--color-text-subtle)',
                }}>
                  Templates
                </div>
                <div style={{ flex: 1, maxWidth: '18rem' }}>
                  <Input
                    value={tplSearch}
                    onChange={e => setTplSearch(e.target.value)}
                    placeholder="Search templates"
                    leadingIcon={<Search size={13} aria-hidden="true" />}
                    inputSize="sm"
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {filteredTemplates.length === 0 ? (
                <EmptyState
                  variant="inline"
                  title="No templates match"
                  description="Try a different search."
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {filteredTemplates.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onPickTemplate(t)}
                      disabled={creating}
                      className="tahi-focus-ring"
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.75rem 0.875rem',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-bg)',
                        cursor: creating ? 'not-allowed' : 'pointer',
                        opacity: creating ? 0.6 : 1,
                        transition: 'background-color 150ms ease, border-color 150ms ease',
                      }}
                      onMouseEnter={e => {
                        if (creating) return
                        e.currentTarget.style.background = 'var(--color-brand-50)'
                        e.currentTarget.style.borderColor = 'var(--color-brand)'
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = 'var(--color-bg)'
                        e.currentTarget.style.borderColor = 'var(--color-border)'
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '2.25rem',
                          height: '2.25rem',
                          background: 'var(--color-brand-50)',
                          color: 'var(--color-brand-dark)',
                          borderRadius: 'var(--radius-leaf-sm)',
                          flexShrink: 0,
                          fontSize: '0.875rem',
                          fontWeight: 700,
                        }}
                      >
                        {t.name.slice(0, 1).toUpperCase()}
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: '0.875rem',
                          fontWeight: 600,
                          color: 'var(--color-text)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>{t.name}</div>
                        {t.description && (
                          <div style={{
                            fontSize: '0.75rem',
                            color: 'var(--color-text-muted)',
                            marginTop: '0.125rem',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}>{t.description}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" onClick={onClose} disabled={creating}>
          Cancel
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}
