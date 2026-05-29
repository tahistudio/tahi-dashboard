'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, ExternalLink, ChevronLeft } from 'lucide-react'
import Link from 'next/link'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Badge } from '@/components/tahi/badge'
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
  const [rows, setRows] = useState<SiteIndexRow[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState<string>('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/site-index'), { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as { rows: SiteIndexRow[]; counts: Counts }
      setRows(json.rows)
      setCounts(json.counts)
    } catch {
      setRows([])
      setCounts(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

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
      await fetchData()
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

  return (
    <div style={{ maxWidth: '88rem', margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.75rem', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '0.25rem' }}>Site index</h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '52rem' }}>
            Every live URL on tahi.studio with a Haiku one-line summary + embedding. Feeds the round-table writer&apos;s internal-linking context, glossary auto-link at publish, related-posts at publish, and back-link cron candidate retrieval. Synced weekly; new blog posts seed at publish time.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <TahiButton
            size="sm"
            onClick={() => { void runSync() }}
            loading={syncing}
            iconLeft={!syncing ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
          >
            {syncing ? 'Syncing…' : 'Run sync now'}
          </TahiButton>
          <Link href="/content-studio" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <ChevronLeft size={14} aria-hidden="true" /> Back
          </Link>
        </div>
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

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
          No rows yet. Click <strong>Run sync now</strong> to populate from tahi.studio/sitemap.xml.
        </div>
      ) : (
        <div style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: '0 16px 0 16px',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)', textAlign: 'left' }}>
                <th style={th}>URL</th>
                <th style={th}>Type</th>
                <th style={th}>Title</th>
                <th style={th}>Summary</th>
                <th style={th}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                  <td style={td}>
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--color-brand-dark)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                    >
                      {row.relativeUrl}
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  </td>
                  <td style={td}>
                    <Badge tone="neutral" variant="soft" size="sm" leader={false}>{row.type}</Badge>
                  </td>
                  <td style={{ ...td, maxWidth: '18rem' }}>
                    <div style={{ color: 'var(--color-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.title ?? '—'}
                    </div>
                  </td>
                  <td style={{ ...td, maxWidth: '30rem' }}>
                    <div style={{ color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                      {row.summary ?? <span style={{ fontStyle: 'italic' }}>(not summarised)</span>}
                    </div>
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap', color: 'var(--color-text-muted)' }}>
                    {row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const th: React.CSSProperties = {
  padding: '0.625rem 0.875rem',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const td: React.CSSProperties = {
  padding: '0.625rem 0.875rem',
  verticalAlign: 'top',
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
