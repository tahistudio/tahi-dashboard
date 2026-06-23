'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Calendar, Plus, RefreshCw, Building2, Target, Trash2, ExternalLink, Eye,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { NewScheduleDialog } from '@/components/tahi/new-schedule-dialog'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { useToast } from '@/components/tahi/toast'

interface ScheduleListItem {
  id: string
  orgId: string | null
  dealId: string | null
  title: string
  subtitle: string | null
  preparedFor: string | null
  effectiveDate: string | null
  targetLaunchDate: string | null
  numberOfWeeks: number
  status: 'draft' | 'shared' | 'sent' | 'signed' | 'completed' | 'archived'
  publicShareToken: string | null
  createdAt: string
  updatedAt: string
  orgName: string | null
  dealTitle: string | null
}

interface ScheduleTemplateOption {
  id: string
  name: string
  description: string | null
  updatedAt: string
}

type ScheduleStatus = ScheduleListItem['status']

// Status -> Badge tone. Keeps status colours consistent with the rest of
// the app's chip language instead of bespoke hex per status.
const STATUS_META: Record<ScheduleStatus, { tone: BadgeTone; label: string }> = {
  draft:     { tone: 'neutral',  label: 'Draft' },
  shared:    { tone: 'info',     label: 'Shared' },
  sent:      { tone: 'purple',   label: 'Sent' },
  signed:    { tone: 'positive', label: 'Signed' },
  completed: { tone: 'brand',    label: 'Completed' },
  archived:  { tone: 'neutral',  label: 'Archived' },
}

const STATUS_ORDER: ScheduleStatus[] = ['draft', 'shared', 'sent', 'signed', 'completed', 'archived']

function statusKey(status: string): ScheduleStatus {
  return (status in STATUS_META ? status : 'draft') as ScheduleStatus
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export function SchedulesContent() {
  const router = useRouter()
  const { showToast } = useToast()
  const [items, setItems] = useState<ScheduleListItem[]>([])
  const [templates, setTemplates] = useState<ScheduleTemplateOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  // FilterBar-style: status held in a permanent multiselect chip. Empty
  // selection = all statuses.
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([
    { id: 'status', values: [] },
  ])
  const selectedStatuses = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'status')
    return new Set(f?.values ?? [])
  }, [activeFilters])
  const [deleteTarget, setDeleteTarget] = useState<ScheduleListItem | null>(null)
  const [newDialogOpen, setNewDialogOpen] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [schedulesRes, templatesRes] = await Promise.all([
        fetch(apiPath('/api/admin/schedules')),
        fetch(apiPath('/api/admin/schedules/templates')),
      ])
      if (schedulesRes.ok) {
        const data = await schedulesRes.json() as { items: ScheduleListItem[] }
        setItems(data.items ?? [])
      } else {
        setItems([])
      }
      if (templatesRes.ok) {
        const data = await templatesRes.json() as { items: ScheduleTemplateOption[] }
        setTemplates(data.items ?? [])
      }
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchAll() }, [fetchAll])

  const filtered = useMemo(() => items.filter(s => {
    if (selectedStatuses.size > 0 && !selectedStatuses.has(statusKey(s.status))) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      if (!s.title.toLowerCase().includes(q) &&
          !(s.orgName ?? '').toLowerCase().includes(q) &&
          !(s.dealTitle ?? '').toLowerCase().includes(q) &&
          !(s.preparedFor ?? '').toLowerCase().includes(q)) return false
    }
    return true
  }), [items, search, selectedStatuses])

  // Filter defs. Status is the only filter we surface; nonRemovable
  // keeps it as a permanent chip with no "+ Add filter" button.
  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'status',
      label: 'Status',
      kind: 'multiselect',
      nonRemovable: true,
      options: STATUS_ORDER.map(s => ({
        value: s,
        label: STATUS_META[s].label,
        tone: STATUS_META[s].tone,
      })),
    },
  ]), [])

  function handleCreated(id: string) {
    setNewDialogOpen(false)
    router.push(`/schedules/${id}`)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    const res = await fetch(apiPath(`/api/admin/schedules/${deleteTarget.id}`), { method: 'DELETE' })
    if (res.ok) {
      setDeleteTarget(null)
      void fetchAll()
    } else {
      showToast('Failed to delete schedule', 'error')
    }
  }

  // Column defs. DataTable handles sort, hover, click-mode indicator
  // and row actions for us.
  const columns: DataTableColumn<ScheduleListItem>[] = [
    {
      key: 'title',
      header: 'Name',
      sortable: true,
      sortValue: r => r.title.toLowerCase(),
      minWidth: '18rem',
      render: r => (
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: '0.125rem' }}>
          <span data-private style={{
            fontWeight: 600,
            color: 'var(--color-text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>{r.title}</span>
          {r.preparedFor && (
            <span style={{
              fontSize: '0.75rem',
              color: 'var(--color-text-subtle)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              for <span data-private>{r.preparedFor}</span>
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      width: '8rem',
      render: r => {
        const meta = STATUS_META[statusKey(r.status)]
        return <Badge tone={meta.tone} variant="soft" size="sm">{meta.label}</Badge>
      },
    },
    {
      key: 'org',
      header: 'Org',
      sortable: true,
      sortValue: r => (r.orgName ?? '').toLowerCase(),
      minWidth: '12rem',
      render: r => r.orgId && r.orgName ? (
        <Link
          href={`/clients/${r.orgId}`}
          onClick={e => e.stopPropagation()}
          data-row-control=""
          className="inline-flex items-center gap-1.5"
          style={{
            color: 'var(--color-text-muted)',
            transition: 'color 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand-dark)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
        >
          <Building2 className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          <span data-private className="truncate" style={{ maxWidth: '14rem' }}>{r.orgName}</span>
        </Link>
      ) : <span style={{ color: 'var(--color-text-subtle)' }}>-</span>,
    },
    {
      key: 'deal',
      header: 'Deal',
      sortable: true,
      sortValue: r => (r.dealTitle ?? '').toLowerCase(),
      minWidth: '12rem',
      render: r => r.dealId && r.dealTitle ? (
        <Link
          href={`/pipeline/${r.dealId}`}
          onClick={e => e.stopPropagation()}
          data-row-control=""
          className="inline-flex items-center gap-1.5"
          style={{
            color: 'var(--color-text-muted)',
            transition: 'color 150ms ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-brand-dark)' }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--color-text-muted)' }}
        >
          <Target className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
          <span data-private className="truncate" style={{ maxWidth: '14rem' }}>{r.dealTitle}</span>
        </Link>
      ) : <span style={{ color: 'var(--color-text-subtle)' }}>-</span>,
    },
    {
      key: 'targetLaunchDate',
      header: 'Target launch',
      sortable: true,
      sortValue: r => r.targetLaunchDate ?? '',
      width: '11rem',
      render: r => (
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3125rem',
          fontSize: '0.75rem',
          color: 'var(--color-text-muted)',
        }}>
          <Calendar size={11} aria-hidden="true" />
          {formatDate(r.targetLaunchDate)}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Schedules"
        subtitle="Project gantts and timelines you can share with clients."
      >
        <TahiButton variant="secondary" size="sm" onClick={fetchAll} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
          Refresh
        </TahiButton>
        <Link href="/schedules/templates">
          <TahiButton variant="secondary" size="sm">
            Templates
          </TahiButton>
        </Link>
        <TahiButton
          size="sm"
          onClick={() => setNewDialogOpen(true)}
          iconLeft={<Plus className="w-3.5 h-3.5" />}
        >
          New schedule
        </TahiButton>
      </PageHeader>

      <NewScheduleDialog
        open={newDialogOpen}
        onClose={() => setNewDialogOpen(false)}
        templates={templates}
        onCreated={handleCreated}
      />

      {/* Filter row: same FilterBar primitive used across Docs and the
          DataTable showcase. Status is a permanent multiselect chip; the
          built-in search handles title / org / deal / preparedFor. */}
      <FilterBar
        filters={filterDefs}
        active={activeFilters}
        onChange={setActiveFilters}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search schedules',
        }}
        size="sm"
      />

      <Card padding="none">
        <DataTable<ScheduleListItem>
          ariaLabel="Schedules"
          columns={columns}
          rows={filtered}
          getRowId={r => r.id}
          defaultSort={{ key: 'targetLaunchDate', dir: 'desc' }}
          loading={loading}
          onRowClick={(r) => router.push(`/schedules/${r.id}`)}
          rowActions={(r) => {
            const actions = [
              {
                label: 'Preview',
                icon: <Eye size={14} />,
                onClick: () => router.push(`/schedules/${r.id}`),
              },
            ]
            if (r.publicShareToken) {
              actions.push({
                label: 'Open public viewer',
                icon: <ExternalLink size={14} />,
                onClick: () => {
                  if (typeof window !== 'undefined') {
                    window.open(`/p/schedule/${r.publicShareToken}`, '_blank', 'noopener,noreferrer')
                  }
                },
              })
            }
            actions.push({
              label: 'Delete',
              icon: <Trash2 size={14} />,
              onClick: () => setDeleteTarget(r),
            })
            return actions.map((a, i) => i === actions.length - 1
              ? { ...a, tone: 'danger' as const }
              : a)
          }}
          empty={
            items.length === 0 ? (
              <EmptyState
                icon={<Calendar className="w-8 h-8 text-white" />}
                title="No schedules yet"
                description="Create one to map a project timeline you can share with clients."
                ctaLabel="New schedule"
                onCtaClick={() => setNewDialogOpen(true)}
              />
            ) : (
              <EmptyState
                variant="inline"
                icon={<Calendar className="w-8 h-8" />}
                title="No schedules match your filters"
                description="Try clearing the search or changing the status filter."
              />
            )
          }
        />
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete schedule"
        description={deleteTarget ? `Delete "${deleteTarget.title}"? This removes all rows and sections. Cannot be undone.` : ''}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
