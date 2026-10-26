'use client'

/**
 * <QaSitesContent>. The /qa list of client sites under QA. Loading, empty,
 * error and populated states. Desktop renders the shared <DataTable>; below
 * md the same rows render through its mobileCard slot.
 */

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { Badge } from '@/components/tahi/badge'
import { ProgressBar } from '@/components/tahi/progress-bar'
import { Select } from '@/components/tahi/input'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { ShellIcon } from '@/components/tahi/shell-icons'
import { AddSiteDialog } from './add-site-dialog'

type QaTarget = 'staging' | 'live'

interface QaOpenRound {
  id: string
  name: string
  target: QaTarget
  ticksDone: number
  ticksTotal: number
  failing: number
  issues: number
}

interface QaSiteRow {
  id: string
  orgId: string
  name: string
  stagingUrl: string | null
  liveUrl: string | null
  notes: string | null
  orgName: string | null
  openRound: QaOpenRound | null
}

const MUTED_TEXT_STYLE: CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text-muted)',
}

const HOST_TEXT_STYLE: CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-subtle)',
  overflowWrap: 'anywhere',
}

const NAME_LINK_STYLE: CSSProperties = {
  fontWeight: 600,
  color: 'var(--color-text)',
  textDecoration: 'none',
  borderRadius: 'var(--radius-sm)',
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: '2.75rem',
}

const NUMBER_STYLE: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text)',
}

const LOAD_ERROR_STYLE: CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-danger)',
}

const FILTER_BAR_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--space-2)',
}

function hostnameOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function hostnamesOf(site: QaSiteRow): string {
  const hosts = [hostnameOf(site.stagingUrl), hostnameOf(site.liveUrl)].filter((host): host is string => Boolean(host))
  return hosts.length > 0 ? hosts.join(', ') : 'No valid URL'
}

function targetLabel(target: QaTarget): string {
  return target === 'live' ? 'Live' : 'Staging'
}

function RoundCell({ round }: { round: QaOpenRound | null }) {
  if (!round) return <span style={MUTED_TEXT_STYLE}>No open round</span>
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-1)' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>{round.name}</span>
      <span>
        <Badge tone={round.target === 'live' ? 'positive' : 'info'} size="sm">
          {targetLabel(round.target)}
        </Badge>
      </span>
    </div>
  )
}

function ProgressCell({ round, siteName }: { round: QaOpenRound | null; siteName: string }) {
  if (!round) return <span style={MUTED_TEXT_STYLE}>Not started</span>
  return (
    <div style={{ minWidth: '8rem' }}>
      <ProgressBar
        value={round.ticksDone}
        max={Math.max(round.ticksTotal, 1)}
        tone="positive"
        height={6}
        ariaLabel={`${siteName} round progress`}
        trailing={`${round.ticksDone} / ${round.ticksTotal}`}
      />
    </div>
  )
}

export function QaSitesContent() {
  const [items, setItems] = useState<QaSiteRow[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [clientFilter, setClientFilter] = useState('all')

  const fetchSites = useCallback(async () => {
    setLoadError(false)
    try {
      const res = await fetch(apiPath('/api/admin/qa/sites'))
      if (!res.ok) throw new Error('Failed')
      const json = (await res.json()) as { items?: QaSiteRow[] }
      setItems(json.items ?? [])
    } catch {
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    void fetchSites()
  }, [fetchSites])

  const clientOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const site of items ?? []) {
      if (!seen.has(site.orgId)) seen.set(site.orgId, site.orgName ?? site.orgId)
    }
    return Array.from(seen, ([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [items])

  const visibleRows = useMemo(() => {
    if (!items) return []
    return clientFilter === 'all' ? items : items.filter(site => site.orgId === clientFilter)
  }, [items, clientFilter])

  const columns = useMemo<DataTableColumn<QaSiteRow>[]>(() => [
    {
      key: 'site',
      header: 'Site',
      render: site => (
        <div className="flex flex-col" style={{ gap: '0.125rem' }}>
          <Link href={`/qa/${site.id}`} data-row-control className="hover:underline focus-visible:underline" style={NAME_LINK_STYLE}>
            {site.name}
          </Link>
          <span style={HOST_TEXT_STYLE}>{hostnamesOf(site)}</span>
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      render: site => <span style={MUTED_TEXT_STYLE}>{site.orgName ?? 'Unknown client'}</span>,
    },
    {
      key: 'round',
      header: 'Round',
      render: site => <RoundCell round={site.openRound} />,
    },
    {
      key: 'progress',
      header: 'Progress',
      render: site => <ProgressCell round={site.openRound} siteName={site.name} />,
    },
    {
      key: 'failing',
      header: 'Failing',
      align: 'right',
      render: site => <span style={NUMBER_STYLE}>{site.openRound?.failing ?? 0}</span>,
    },
    {
      key: 'issues',
      header: 'Issues',
      align: 'right',
      render: site => <span style={NUMBER_STYLE}>{site.openRound?.issues ?? 0}</span>,
    },
  ], [])

  const addButton = (
    <TahiButton variant="primary" onClick={() => setDialogOpen(true)}>
      Add site
    </TahiButton>
  )

  const isLoading = items === null && !loadError
  const hasSites = (items?.length ?? 0) > 0

  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-5)' }}>
      <PageHeader
        title="Site QA"
        subtitle="QA client websites at every screen size before they ship."
      >
        {hasSites && (
          <div style={FILTER_BAR_STYLE}>
            <Select
              aria-label="Filter by client"
              selectSize="sm"
              value={clientFilter}
              onChange={event => setClientFilter(event.target.value)}
              options={[{ value: 'all', label: 'All clients' }, ...clientOptions]}
            />
          </div>
        )}
        {addButton}
      </PageHeader>

      {isLoading && <LoadingSkeleton rows={4} height={64} />}

      {loadError && (
        <div className="flex flex-col items-start" style={{ gap: 'var(--space-3)' }}>
          <p role="alert" style={LOAD_ERROR_STYLE}>Sites could not be loaded.</p>
          <TahiButton variant="secondary" size="sm" onClick={() => void fetchSites()}>
            Try again
          </TahiButton>
        </div>
      )}

      {items !== null && !hasSites && (
        <EmptyState
          icon={<ShellIcon n="checks" s={24} />}
          title="No sites yet"
          description="Add a client's staging or live URL, import its pages and start a QA round."
          ctaLabel="Add site"
          onCtaClick={() => setDialogOpen(true)}
        />
      )}

      {items !== null && hasSites && (
        <DataTable<QaSiteRow>
          ariaLabel="Client sites under QA"
          columns={columns}
          rows={visibleRows}
          getRowId={site => site.id}
          onRowClick={site => {
            router.push(`/qa/${site.id}`)
          }}
          empty={
            <EmptyState
              variant="inline"
              title="No sites for this client"
              description="Choose another client, or add a site for this one."
            />
          }
          mobileCard={site => (
            <Link
              href={`/qa/${site.id}`}
              data-row-control
              className="flex flex-col hover:underline focus-visible:underline"
              style={{
                gap: 'var(--space-2)',
                minHeight: '2.75rem',
                padding: 'var(--space-3)',
                textDecoration: 'none',
                color: 'var(--color-text)',
              }}
            >
              <span style={{ fontWeight: 600 }}>{site.name}</span>
              <span style={HOST_TEXT_STYLE}>{hostnamesOf(site)}</span>
              <span style={MUTED_TEXT_STYLE}>{site.orgName ?? 'Unknown client'}</span>
              <RoundCell round={site.openRound} />
              <ProgressCell round={site.openRound} siteName={site.name} />
              <span style={MUTED_TEXT_STYLE}>
                {site.openRound?.failing ?? 0} failing, {site.openRound?.issues ?? 0} issues
              </span>
            </Link>
          )}
        />
      )}

      <AddSiteDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  )
}
