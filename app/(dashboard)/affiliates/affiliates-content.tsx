'use client'

import { useState, useMemo } from 'react'
import useSWR from 'swr'
import {
  Users, Link2, DollarSign, RefreshCw, Search,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { Avatar } from '@/components/tahi/avatar'
import { Input } from '@/components/tahi/input'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { FilterBar, type FilterDef, type ActiveFilter } from '@/components/tahi/filter-bar'

// -- Types --

// The Rewardful integration endpoint currently returns connection status
// plus empty arrays for affiliates/referrals/commissions (Phase C rebuild
// will populate these). We type them loosely so the visual lap stays
// resilient when richer payloads land.
interface AffiliateRow {
  id?: string
  email?: string
  firstName?: string
  lastName?: string
  name?: string
  state?: string
  visitors?: number
  leads?: number
  conversions?: number
  commissionsTotal?: number
  createdAt?: string
}

interface AffiliateData {
  connected: boolean
  lastSyncedAt: string | null
  affiliates: AffiliateRow[]
  referrals: unknown[]
  commissions: unknown[]
}

// -- Helpers --

function fullName(r: AffiliateRow): string {
  if (r.name) return r.name
  const f = [r.firstName, r.lastName].filter(Boolean).join(' ').trim()
  return f || r.email || 'Affiliate'
}

function formatMoney(n: number | undefined): string {
  if (typeof n !== 'number' || Number.isNaN(n)) return '--'
  return new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD', maximumFractionDigits: 0 }).format(n)
}

function stateTone(state: string | undefined): BadgeTone {
  switch ((state ?? '').toLowerCase()) {
    case 'active':   return 'positive'
    case 'pending':  return 'warning'
    case 'disabled':
    case 'inactive': return 'neutral'
    default:         return 'neutral'
  }
}

function stateLabel(state: string | undefined): string {
  if (!state) return 'Unknown'
  return state.charAt(0).toUpperCase() + state.slice(1)
}

// -- Main Component --

export function AffiliatesContent() {
  const { data, isLoading: loading, mutate } = useSWR<AffiliateData>('/api/admin/integrations/rewardful')
  const [search, setSearch] = useState('')
  const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([])

  // Memoise so dependents of `affiliates` (filtered list + stat tiles)
  // don't churn on every render when the payload reference is stable.
  const affiliates = useMemo<AffiliateRow[]>(
    () => data?.affiliates ?? [],
    [data?.affiliates],
  )

  const selectedStates = useMemo(
    () => new Set(activeFilters.find(a => a.id === 'state')?.values ?? []),
    [activeFilters],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return affiliates.filter(a => {
      if (selectedStates.size > 0 && !selectedStates.has((a.state ?? '').toLowerCase())) return false
      if (q) {
        const name = fullName(a).toLowerCase()
        const email = (a.email ?? '').toLowerCase()
        if (!name.includes(q) && !email.includes(q)) return false
      }
      return true
    })
  }, [affiliates, search, selectedStates])

  const filterDefs: FilterDef[] = useMemo(() => ([
    {
      id: 'state',
      label: 'State',
      kind: 'multiselect',
      options: [
        { value: 'active',   label: 'Active',   tone: 'positive' },
        { value: 'pending',  label: 'Pending',  tone: 'warning' },
        { value: 'disabled', label: 'Disabled', tone: 'neutral' },
      ],
    },
  ]), [])

  const columns: DataTableColumn<AffiliateRow>[] = [
    {
      key: 'name',
      header: 'Affiliate',
      sortable: true,
      sortValue: r => fullName(r).toLowerCase(),
      minWidth: '16rem',
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0 }}>
          <Avatar name={fullName(r)} size="sm" />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontWeight: 600,
              color: 'var(--color-text)',
              fontSize: '0.8125rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>{fullName(r)}</div>
            {r.email && (
              <div style={{
                fontSize: '0.6875rem',
                color: 'var(--color-text-muted)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>{r.email}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'state',
      header: 'State',
      sortable: true,
      sortValue: r => r.state ?? '',
      width: '7rem',
      render: r => (
        <Badge tone={stateTone(r.state)} variant="soft" size="sm" dot>
          {stateLabel(r.state)}
        </Badge>
      ),
    },
    {
      key: 'visitors',
      header: 'Visitors',
      sortable: true,
      align: 'right',
      sortValue: r => r.visitors ?? 0,
      width: '6.5rem',
      render: r => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
          {r.visitors ?? '--'}
        </span>
      ),
    },
    {
      key: 'leads',
      header: 'Leads',
      sortable: true,
      align: 'right',
      sortValue: r => r.leads ?? 0,
      width: '6rem',
      render: r => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
          {r.leads ?? '--'}
        </span>
      ),
    },
    {
      key: 'conversions',
      header: 'Conversions',
      sortable: true,
      align: 'right',
      sortValue: r => r.conversions ?? 0,
      width: '7rem',
      render: r => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
          {r.conversions ?? '--'}
        </span>
      ),
    },
    {
      key: 'commissionsTotal',
      header: 'Commissions',
      sortable: true,
      align: 'right',
      sortValue: r => r.commissionsTotal ?? 0,
      width: '8.5rem',
      render: r => (
        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '0.8125rem', color: 'var(--color-text)' }}>
          {formatMoney(r.commissionsTotal)}
        </span>
      ),
    },
  ]

  const lastSyncedLabel = useMemo(() => {
    if (!data?.lastSyncedAt) return null
    try {
      return new Date(data.lastSyncedAt).toLocaleString('en-NZ', {
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      })
    } catch {
      return null
    }
  }, [data?.lastSyncedAt])

  return (
    <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <h1 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 700,
            color: 'var(--color-text)',
            letterSpacing: '-0.015em',
          }}>Affiliates</h1>
          <p style={{
            margin: '0.25rem 0 0',
            fontSize: '0.875rem',
            color: 'var(--color-text-muted)',
            lineHeight: 1.5,
          }}>
            Rewardful affiliate tracking and commission management.
            {lastSyncedLabel && (
              <span style={{ color: 'var(--color-text-subtle)' }}>
                {' '}· Last synced {lastSyncedLabel}
              </span>
            )}
          </p>
        </div>
        <TahiButton
          variant="secondary"
          size="sm"
          onClick={() => void mutate()}
          iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Refresh
        </TahiButton>
      </div>

      {!loading && !data?.connected ? (
        <Card padding="none">
          <EmptyState
            icon={<Link2 className="w-6 h-6" />}
            title="Connect Rewardful"
            description="Connect your Rewardful account to track affiliates, referrals, and commissions. Add your API key in Settings."
            action={
              <a
                href="/settings"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 1rem',
                  background: 'var(--color-brand)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: '#ffffff',
                  textDecoration: 'none',
                }}
              >
                Go to settings
              </a>
            }
          />
        </Card>
      ) : (
        <>
          {/* Summary tiles */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
            gap: '0.75rem',
          }}>
            <StatTile
              label="Affiliates"
              value={loading ? '—' : String(affiliates.length)}
              icon={<Users className="w-4 h-4" aria-hidden="true" />}
            />
            <StatTile
              label="Referrals"
              value={loading ? '—' : String((data?.referrals ?? []).length)}
              icon={<Link2 className="w-4 h-4" aria-hidden="true" />}
            />
            <StatTile
              label="Commissions"
              value={loading ? '—' : String((data?.commissions ?? []).length)}
              icon={<DollarSign className="w-4 h-4" aria-hidden="true" />}
            />
          </div>

          {/* Filter row. Search is wrapped in a styled <Input> with a
              leading icon — the FilterBar gives us search natively but
              we use the dedicated control here so the page reads as
              "list view with filters" rather than "primarily filtered".
              FilterBar still hosts the state chip set. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search affiliates by name or email"
              leadingIcon={<Search size={14} aria-hidden="true" />}
              inputSize="sm"
              style={{ maxWidth: '24rem' }}
            />
            <FilterBar
              filters={filterDefs}
              active={activeFilters}
              onChange={setActiveFilters}
              size="sm"
            />
          </div>

          {/* Table */}
          <Card padding="none">
            <DataTable<AffiliateRow>
              ariaLabel="Affiliates"
              columns={columns}
              rows={filtered}
              getRowId={(r) => r.id ?? fullName(r) + (r.email ?? '')}
              defaultSort={{ key: 'commissionsTotal', dir: 'desc' }}
              loading={loading}
              empty={
                <EmptyState
                  icon={<Users className="w-6 h-6" />}
                  title={affiliates.length === 0 ? 'No affiliates yet' : 'No matches'}
                  description={affiliates.length === 0
                    ? 'Affiliate data will appear here once synced from Rewardful.'
                    : 'Try clearing a filter or adjusting your search.'}
                />
              }
            />
          </Card>
        </>
      )}
    </div>
  )
}

// -- Stat tile (kept inline; mirrors the small KPI tile used on Docs) --

function StatTile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <Card padding="md">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span style={{
          fontSize: '0.625rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
        }}>{label}</span>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '1.75rem',
            height: '1.75rem',
            borderRadius: 'var(--radius-leaf-sm)',
            background: 'var(--color-brand-50)',
            color: 'var(--color-brand)',
          }}
        >
          {icon}
        </span>
      </div>
      <div style={{
        marginTop: '0.375rem',
        fontSize: '1.5rem',
        fontWeight: 700,
        color: 'var(--color-text)',
        fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </Card>
  )
}
