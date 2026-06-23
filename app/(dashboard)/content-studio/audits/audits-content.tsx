'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Search, AlertTriangle } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { apiPath } from '@/lib/api'

interface AuditRow {
  id: string
  title: string | null
  status: string
  contentScore: number | null
  auditTargetWebflowId: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export function AuditsContent() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [slugInput, setSlugInput] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/audits'), { cache: 'no-store' })
      if (!res.ok) throw new Error('Failed')
      const json = await res.json() as { audits: AuditRow[] }
      setRows(json.audits)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchData() }, [fetchData])

  async function createAudit() {
    const slug = slugInput.trim()
    if (!slug) {
      alert('Enter a Webflow post slug (e.g. "why-enterprise-webflow-fails") or full URL.')
      return
    }
    // Accept either a slug or a full URL like https://www.tahi.studio/blog/<slug>
    const cleaned = slug.replace(/^https?:\/\/[^/]+/, '').replace(/^\/?blog\//, '').replace(/^\//, '').replace(/\/$/, '')
    setCreating(true)
    try {
      const res = await fetch(apiPath('/api/admin/content/audits'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: cleaned }),
      })
      const j = await res.json() as { ok?: boolean; draftId?: string; error?: string; detail?: string; message?: string }
      if (!res.ok || !j.ok) {
        alert(j.error ?? 'Failed to create audit')
        return
      }
      setSlugInput('')
      await fetchData()
      if (j.draftId) {
        // Open the audit's round-table page so Liam can watch the
        // reviewers run.
        window.location.href = `/content-studio/drafts/${j.draftId}/round-table`
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create audit')
    } finally {
      setCreating(false)
    }
  }

  const columns: ReadonlyArray<DataTableColumn<AuditRow>> = [
    {
      key: 'title',
      header: 'Post',
      sortable: true,
      width: '28rem',
      link: { href: r => `/content-studio/drafts/${r.id}/round-table` },
      render: r => r.title ?? '(untitled)',
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      width: '12rem',
      render: r => <Badge tone={statusTone(r.status)} variant="soft" size="sm" leader="dot">{prettyStatus(r.status)}</Badge>,
    },
    {
      key: 'contentScore',
      header: 'Score',
      sortable: true,
      width: '6rem',
      render: r => r.contentScore != null
        ? <Badge tone={scoreTone(r.contentScore)} variant="soft" size="sm" leader={false}>{r.contentScore}</Badge>
        : <span style={{ color: 'var(--color-text-muted)' }}>—</span>,
    },
    {
      key: 'updatedAt',
      header: 'Last updated',
      sortable: true,
      width: '11rem',
      muted: true,
      render: r => new Date(r.updatedAt).toLocaleString(),
    },
    {
      key: 'errorMessage',
      header: 'Error',
      width: '18rem',
      wrap: true,
      render: r => r.errorMessage
        ? <span style={{ color: 'var(--color-danger)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <AlertTriangle className="w-3 h-3" />
            {r.errorMessage.slice(0, 80)}
          </span>
        : <span style={{ color: 'var(--color-text-subtle)' }}>—</span>,
    },
  ]

  return (
    <div>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', maxWidth: '56rem', marginTop: 0 }}>
        Run the round-table 23-reviewer audit on an existing published blog post. The audit synthesises a brief retroactively, scores the post against all reviewers, and lands at <strong>audited</strong> with the score + critiques. <strong>Nothing in Webflow is changed.</strong> Use it to find which legacy posts are worth lifting versus leaving. Cost ~$1.50 per audit.
      </p>

      <div style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: '0 16px 0 16px',
        padding: '1rem 1.25rem',
        marginBottom: '1.25rem',
        marginTop: '1.25rem',
      }}>
        <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
          Run a new audit
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !creating) { void createAudit() } }}
            placeholder="e.g. 7-things-tahi-refuses or https://www.tahi.studio/blog/7-things-tahi-refuses"
            disabled={creating}
            style={{
              flex: '1 1 24rem',
              padding: '0.5rem 0.75rem',
              border: '1px solid var(--color-border)',
              borderRadius: '8px',
              fontSize: '0.875rem',
              background: 'var(--color-bg)',
              color: 'var(--color-text)',
              fontFamily: 'inherit',
            }}
          />
          <TahiButton
            size="sm"
            onClick={() => { void createAudit() }}
            loading={creating}
            iconLeft={!creating ? <Search className="w-3.5 h-3.5" /> : undefined}
          >
            {creating ? 'Creating…' : 'Run audit'}
          </TahiButton>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={r => r.id}
        loading={loading}
        defaultSort={{ key: 'updatedAt', dir: 'desc' }}
        defaultPageSize={50}
        density="compact"
        ariaLabel="Audits"
        empty={
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            No audits yet. Enter a post slug above to run one.
          </div>
        }
      />
    </div>
  )
}

function statusTone(status: string): BadgeTone {
  if (status === 'audited') return 'positive'
  if (status === 'failed' || status === 'cost_capped') return 'danger'
  if (status === 'paused') return 'warning'
  return 'info'
}

function prettyStatus(status: string): string {
  const map: Record<string, string> = {
    queued: 'Queued',
    strategising: 'Synthesising brief',
    reviewing: 'Reviewing (23)',
    editing: 'Editor synthesis',
    signing_off: 'Sign-off',
    audited: 'Audited',
    failed: 'Failed',
    cost_capped: 'Cost cap',
    paused: 'Paused',
  }
  return map[status] ?? status
}

function scoreTone(score: number): BadgeTone {
  if (score >= 85) return 'positive'
  if (score >= 70) return 'info'
  if (score >= 50) return 'warning'
  return 'danger'
}
