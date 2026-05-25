'use client'

/**
 * /calls — unified index of every call from calendar sync + manual.
 *
 * Pulled from /api/admin/calls/index which reads discovery_calls. Each
 * row shows: title, scheduled time, parent (lead/deal/org), classified
 * type chip (discovery / client / partnership / unclassified), status,
 * transcript availability. Tabs split upcoming vs past.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Calendar, FileText, ExternalLink, RefreshCw, UserPlus, TrendingUp, Building2, AlertTriangle } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'
import { useToast } from '@/components/tahi/toast'
import { apiPath } from '@/lib/api'

interface CallRow {
  id: string
  title: string
  scheduledAt: string
  durationMinutes: number
  status: string
  meetingType: 'discovery' | 'client' | 'partnership' | 'unclassified' | null
  outcome: string | null
  hasTranscript: boolean
  googleMeetUrl: string | null
  googleCalendarEventId: string | null
  leadId: string | null
  leadName: string | null
  dealId: string | null
  dealTitle: string | null
  orgId: string | null
  orgName: string | null
  source: 'discovery_calls'
}

const TYPE_META: Record<string, { label: string; tone: BadgeTone; icon: React.ReactNode }> = {
  discovery: { label: 'Discovery', tone: 'brand', icon: <UserPlus size={11} /> },
  client: { label: 'Client check-in', tone: 'info', icon: <Building2 size={11} /> },
  partnership: { label: 'Partnership', tone: 'purple', icon: <TrendingUp size={11} /> },
  unclassified: { label: 'Triage', tone: 'warning', icon: <AlertTriangle size={11} /> },
}

const STATUS_META: Record<string, { label: string; tone: BadgeTone }> = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  completed: { label: 'Completed', tone: 'positive' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  no_show: { label: 'No-show', tone: 'danger' },
  rescheduled: { label: 'Rescheduled', tone: 'warning' },
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const abs = Math.abs(diff)
  const mins = Math.floor(abs / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days >= 1) return diff > 0 ? `${days}d ago` : `in ${days}d`
  if (hours >= 1) return diff > 0 ? `${hours}h ago` : `in ${hours}h`
  if (mins >= 1) return diff > 0 ? `${mins}m ago` : `in ${mins}m`
  return diff > 0 ? 'just now' : 'now'
}

export function CallsContent() {
  const { showToast } = useToast()
  const [items, setItems] = useState<CallRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([
    { id: 'type', values: [] },
  ])
  const [syncing, setSyncing] = useState(false)

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(apiPath('/api/admin/calls/index'))
      if (!r.ok) throw new Error('Failed')
      const data = await r.json() as { items: CallRow[] }
      setItems(data.items ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function syncNow() {
    setSyncing(true)
    try {
      const r = await fetch(apiPath('/api/admin/integrations/google/sync-calendar'), { method: 'POST' })
      const data = await r.json() as { created?: number; updated?: number; error?: string }
      if (r.ok) {
        showToast(`Calendar synced — ${data.created ?? 0} new, ${data.updated ?? 0} updated`, 'success')
        await fetchAll()
      } else {
        showToast(`Sync failed: ${data.error ?? 'unknown'}`, 'error')
      }
    } catch {
      showToast('Sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }

  async function reclassify(callId: string, meetingType: 'discovery' | 'client' | 'partnership') {
    // Optimistic update — flip the local row immediately, then PATCH.
    setItems(prev => prev.map(c => c.id === callId ? { ...c, meetingType } : c))
    try {
      const r = await fetch(apiPath(`/api/admin/discovery-calls/${callId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingType }),
      })
      if (!r.ok) throw new Error('Failed')
      showToast(`Reclassified as ${meetingType}`, 'success')
    } catch {
      showToast('Could not reclassify — refresh and try again', 'error')
      await fetchAll()
    }
  }

  const selectedTypes = useMemo(() => {
    const f = activeFilters.find(a => a.id === 'type')
    return new Set(f?.values ?? [])
  }, [activeFilters])

  const filtered = useMemo(() => items.filter(c => {
    // Tab split
    const isPast = new Date(c.scheduledAt).getTime() < Date.now()
    if (tab === 'upcoming' && isPast) return false
    if (tab === 'past' && !isPast) return false
    // Type filter
    if (selectedTypes.size > 0) {
      const mt = c.meetingType ?? 'unclassified'
      if (!selectedTypes.has(mt)) return false
    }
    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      const hay = `${c.title} ${c.leadName ?? ''} ${c.orgName ?? ''} ${c.dealTitle ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [items, tab, selectedTypes, search])

  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'type',
      label: 'Type',
      kind: 'multiselect',
      options: [
        { value: 'discovery', label: 'Discovery', tone: 'brand' },
        { value: 'client', label: 'Client check-in', tone: 'info' },
        { value: 'partnership', label: 'Partnership', tone: 'purple' },
        { value: 'unclassified', label: 'Triage', tone: 'warning' },
      ],
    },
  ]), [])

  const columns: DataTableColumn<CallRow>[] = [
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      sortValue: r => r.title.toLowerCase(),
      minWidth: '18rem',
      render: r => {
        const meta = TYPE_META[r.meetingType ?? 'unclassified']
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', minWidth: 0 }}>
            <span style={{
              fontWeight: 600,
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{r.title}</span>
            <div className="flex items-center" style={{ gap: '0.375rem', flexWrap: 'wrap' }}>
              <Badge tone={meta.tone} variant="soft" size="sm">
                <span style={{ marginRight: 4, display: 'inline-flex' }}>{meta.icon}</span>
                {meta.label}
              </Badge>
              {r.hasTranscript && (
                <Badge tone="positive" variant="soft" size="sm">
                  <FileText size={11} style={{ marginRight: 4, display: 'inline-block' }} />
                  Transcript
                </Badge>
              )}
            </div>
          </div>
        )
      },
    },
    {
      key: 'scheduledAt',
      header: 'When',
      sortable: true,
      sortValue: r => r.scheduledAt,
      width: '11rem',
      render: r => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          <span style={{ fontSize: '0.8125rem', color: 'var(--color-text)', fontWeight: 500 }}>
            {formatDateTime(r.scheduledAt)}
          </span>
          <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
            {formatRelative(r.scheduledAt)} · {r.durationMinutes}m
          </span>
        </div>
      ),
    },
    {
      key: 'parent',
      header: 'Linked to',
      minWidth: '11rem',
      render: r => {
        if (r.leadId && r.leadName) return (
          <Link href={`/leads/${r.leadId}`} className="truncate" style={{ fontSize: '0.8125rem', color: 'var(--color-text)', textDecoration: 'none', fontWeight: 500 }}>
            {r.leadName}
          </Link>
        )
        if (r.dealId && r.dealTitle) return (
          <Link href={`/deals/${r.dealId}`} className="truncate" style={{ fontSize: '0.8125rem', color: 'var(--color-text)', textDecoration: 'none', fontWeight: 500 }}>
            {r.dealTitle}
          </Link>
        )
        if (r.orgId && r.orgName) return (
          <Link href={`/clients/${r.orgId}`} className="truncate" style={{ fontSize: '0.8125rem', color: 'var(--color-text)', textDecoration: 'none', fontWeight: 500 }}>
            {r.orgName}
          </Link>
        )
        return <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>Unlinked — triage</span>
      },
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      sortValue: r => r.status,
      width: '8rem',
      render: r => {
        const meta = STATUS_META[r.status] ?? { label: r.status, tone: 'neutral' as BadgeTone }
        return <Badge tone={meta.tone} variant="soft" size="sm">{meta.label}</Badge>
      },
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Calls"
        subtitle="Every discovery, client check-in, and partnership meeting from your Google Calendar."
      >
        <TahiButton
          variant="secondary"
          size="sm"
          loading={syncing}
          onClick={() => void syncNow()}
          iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Sync calendar
        </TahiButton>
      </PageHeader>

      <div className="flex" style={{ gap: '0.375rem' }}>
        {([
          ['upcoming', 'Upcoming'],
          ['past', 'Past'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '0.4375rem 0.875rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              borderRadius: tab === key ? 'var(--radius-leaf-sm)' : 'var(--radius-md)',
              background: tab === key ? 'var(--color-brand-100)' : 'transparent',
              color: tab === key ? 'var(--color-text-active)' : 'var(--color-text-muted)',
              border: '1px solid',
              borderColor: tab === key ? 'transparent' : 'var(--color-border)',
              cursor: 'pointer',
            }}
          >
            {label}
            {' '}
            <span className="text-[var(--color-text-subtle)]">
              {items.filter(c => {
                const isPast = new Date(c.scheduledAt).getTime() < Date.now()
                return key === 'past' ? isPast : !isPast
              }).length}
            </span>
          </button>
        ))}
      </div>

      <FilterBar
        filters={filterDefs}
        active={activeFilters}
        onChange={setActiveFilters}
        search={{
          value: search,
          onChange: setSearch,
          placeholder: 'Search title, lead, deal or org',
        }}
        size="sm"
      />

      <Card padding="none">
        <DataTable<CallRow>
          ariaLabel="Calls"
          columns={columns}
          rows={filtered}
          getRowId={r => r.id}
          defaultSort={{ key: 'scheduledAt', dir: tab === 'past' ? 'desc' : 'asc' }}
          loading={loading}
          rowActions={(r) => {
            const actions: Array<{ label: string; icon: React.ReactNode; onClick: () => void }> = []
            if (r.googleMeetUrl) {
              actions.push({
                label: 'Open Meet link',
                icon: <ExternalLink size={14} />,
                onClick: () => {
                  if (typeof window !== 'undefined') window.open(r.googleMeetUrl!, '_blank', 'noopener,noreferrer')
                },
              })
            }
            if (r.leadId) {
              actions.push({
                label: 'Open lead',
                icon: <UserPlus size={14} />,
                onClick: () => {
                  if (typeof window !== 'undefined') window.location.href = `/leads/${r.leadId}`
                },
              })
            }
            // Inline reclassify actions — let Liam move a call between
            // buckets without leaving the index. Skips the type the row
            // is currently in.
            const types: Array<['discovery' | 'client' | 'partnership', string, React.ReactNode]> = [
              ['discovery', 'Mark as Discovery', <UserPlus key="d" size={14} />],
              ['client', 'Mark as Client', <Building2 key="c" size={14} />],
              ['partnership', 'Mark as Partnership', <TrendingUp key="p" size={14} />],
            ]
            for (const [val, label, icon] of types) {
              if (r.meetingType === val) continue
              actions.push({
                label,
                icon,
                onClick: () => void reclassify(r.id, val),
              })
            }
            return actions
          }}
          empty={
            items.length === 0 ? (
              <EmptyState
                icon={<Calendar className="w-8 h-8 text-white" />}
                title="No calls yet"
                description="Connect Google Calendar and hit Sync to pull your upcoming Meet calls. Each gets classified automatically."
                ctaLabel="Sync calendar"
                onCtaClick={() => void syncNow()}
              />
            ) : (
              <EmptyState
                variant="inline"
                icon={<Calendar className="w-8 h-8" />}
                title="No calls match"
                description="Try clearing the search or switching tabs."
              />
            )
          }
        />
      </Card>
    </div>
  )
}
