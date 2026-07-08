'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { RefreshCw } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Badge } from '@/components/tahi/badge'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { apiPath } from '@/lib/api'

interface SiteIndexRow {
  id: string
  url: string
  relativeUrl: string
  type: string
  title: string | null
  summary: string | null
  lastSeenAt: string | null
  summarisedAt: string | null
  isActive: number
}

interface Counts {
  total: number
  active: number
  byType: Record<string, number>
}

const TYPE_ORDER = ['blog', 'glossary', 'service', 'work', 'about', 'contact', 'page', 'other']

export function SiteIndexContent() {
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState<string>('all')

  // Cached via SWR. Inline fetcher preserves the no-store semantics; an error
  // yields undefined data, which falls back to an empty list + null counts.
  const { data, isLoading: loading, mutate } = useSWR<{ rows: SiteIndexRow[]; counts: Counts }>(
    '/api/admin/content/site-index',
    (path: string) => fetch(apiPath(path), { cache: 'no-store' }).then(r => {
      if (!r.ok) throw new Error('Failed')
      return r.json() as Promise<{ rows: SiteIndexRow[]; counts: Counts }>
    }),
  )
  const rows = data?.rows ?? []
  const counts = data?.counts ?? null

  async function runSync() {
    setSyncing(true)
    try {
      const res = await fetch(apiPath('/api/admin/cron/site-index-sync'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxPages: 400, budgetMs: 38000 }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        alert(j.error ?? 'Sync failed')
        return
      }
      const j = await res.json() as { newRows: number; changedRows: number; unchangedRows: number; deactivated: number; errors: number }
      await mutate()
      alert(`Sync done: ${j.newRows} new, ${j.changedRows} changed, ${j.unchangedRows} unchanged, ${j.deactivated} deactivated, ${j.errors} errors.`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return rows
    return rows.filter(r => r.type === filter)
  }, [rows, filter])

  const types = useMemo(() => {
    const all = new Set<string>(rows.map(r => r.type))
    const ordered = TYPE_ORDER.filter(t => all.has(t))
    for (const t of all) if (!ordered.includes(t)) ordered.push(t)
    return ordered
  }, [rows])

  const columns: ReadonlyArray<DataTableColumn<SiteIndexRow>> = useMemo(() => [
    {
      key: 'relativeUrl',
      header: 'URL',
      sortable: true,
      width: '18rem',
      link: { href: r => r.url },
      render: r => r.relativeUrl,
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      width: '7rem',
      render: r => <Badge tone="neutral" variant="soft" size="sm" leader={false}>{r.type}</Badge>,
    },
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      width: '20rem',
      render: r => r.title ?? <span style={{ color: 'var(--color-text-muted)' }}>—</span>,
    },
    {
      key: 'summary',
      header: 'Summary',
      width: '32rem',
      wrap: true,
      render: r => r.summary
        ? <span style={{ color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{r.summary}</span>
        : <span style={{ color: 'var(--color-text-subtle)', fontStyle: 'italic' }}>(not summarised)</span>,
    },
    {
      key: 'lastSeenAt',
      header: 'Last seen',
      sortable: true,
      width: '11rem',
      muted: true,
      render: r => r.lastSeenAt ? new Date(r.lastSeenAt).toLocaleString() : '—',
    },
  ], [])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '1rem', flexWrap: 'wrap' }}>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '52rem', margin: 0 }}>
          Every live URL on tahi.studio with a Haiku one-line summary + embedding. Feeds the round-table writer&apos;s internal-linking context, glossary auto-link at publish, related-posts at publish, and back-link cron candidate retrieval. Synced weekly; new blog posts seed at publish time.
        </p>
        <TahiButton
          size="sm"
          onClick={() => { void runSync() }}
          loading={syncing}
          iconLeft={!syncing ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
        >
          {syncing ? 'Syncing…' : 'Run sync now'}
        </TahiButton>
      </div>

      {counts && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <Badge tone="neutral" variant="soft" size="sm" leader={false}>
            {counts.total} total · {counts.active} active
          </Badge>
          {TYPE_ORDER.filter(t => counts.byType[t]).map(t => (
            <Badge key={t} tone="info" variant="soft" size="sm" leader={false}>
              {t}: {counts.byType[t]}
            </Badge>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <button
          onClick={() => setFilter('all')}
          style={chipStyle(filter === 'all')}
        >
          All ({rows.length})
        </button>
        {types.map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={chipStyle(filter === t)}
          >
            {t} ({counts?.byType[t] ?? 0})
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        getRowId={r => r.id}
        loading={loading}
        defaultSort={{ key: 'lastSeenAt', dir: 'desc' }}
        defaultPageSize={50}
        density="compact"
        ariaLabel="Site index"
        empty={
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            No rows yet. Click <strong>Run sync now</strong> to populate from tahi.studio/sitemap.xml.
          </div>
        }
      />
    </div>
  )
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '0.3125rem 0.75rem',
    fontSize: '0.75rem',
    fontWeight: 500,
    borderRadius: '999px',
    border: '1px solid var(--color-border)',
    background: active ? 'var(--color-brand)' : 'var(--color-bg)',
    color: active ? '#fff' : 'var(--color-text-muted)',
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}
