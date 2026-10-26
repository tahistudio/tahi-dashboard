'use client'

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { apiPath } from '@/lib/api'
import { PageHeader } from '@/components/tahi/page-header'
import { EmptyState } from '@/components/tahi/empty-state'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { Badge } from '@/components/tahi/badge'
import { Input } from '@/components/tahi/input'
import { TahiButton } from '@/components/tahi/tahi-button'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { useToast } from '@/components/tahi/toast'
import type { QaTarget } from '@/lib/qa/types'
import { AddSiteDialog, type QaSiteFormValue } from '../add-site-dialog'
import { StartRoundDialog } from './start-round-dialog'
import { RoundWorkspace } from './workspace/round-workspace'

interface QaSiteDetail {
  item: QaSiteFormValue & { orgName?: string | null; archivedAt?: string | null }
  pages: { id: string; path: string; removedAt: string | null; groupKey: string | null }[]
  rounds: { id: string; name: string; target: QaTarget; status: 'open' | 'closed'; createdAt: string; closedAt: string | null }[]
}

interface ImportResult {
  added: number
  updated: number
  removed: number
  total: number
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const LIST_VIEW = 'list'

export interface SiteContentProps {
  siteId: string
}

export function SiteContent({ siteId }: SiteContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { showToast } = useToast()
  const [data, setData] = useState<QaSiteDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [roundOpen, setRoundOpen] = useState(false)
  const [importing, setImporting] = useState<QaTarget | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [pagePath, setPagePath] = useState('')
  const [addingPage, setAddingPage] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const pagePathId = useId()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/qa/sites/${siteId}`))
      if (!res.ok) throw new Error(await errorText(res))
      setData((await res.json()) as QaSiteDetail)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this site.')
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    void load()
  }, [load])

  const requestedRound = searchParams.get('round')
  // No round param means first arrival: open the newest open round. The list
  // view is explicit (?round=list) so "All rounds" can always reach it.
  const newestOpenRoundId = useMemo(() => {
    const open = (data?.rounds ?? []).filter(r => r.status === 'open')
    open.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return open[0]?.id ?? null
  }, [data])
  const activeRoundId = requestedRound === LIST_VIEW ? null : (requestedRound ?? newestOpenRoundId)

  const siteItem = data?.item
  const editSite = useMemo(
    () =>
      siteItem
        ? { id: siteItem.id, orgId: siteItem.orgId, name: siteItem.name, stagingUrl: siteItem.stagingUrl, liveUrl: siteItem.liveUrl, notes: siteItem.notes }
        : undefined,
    [siteItem],
  )

  function openRound(id: string | null) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('round', id ?? LIST_VIEW)
    params.delete('page')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  async function importFrom(target: QaTarget) {
    setImporting(target)
    setImportResult(null)
    try {
      const res = await fetch(apiPath(`/api/admin/qa/sites/${siteId}/import-sitemap`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      if (!res.ok) throw new Error(await errorText(res))
      const json = (await res.json()) as ImportResult
      setImportResult(json)
      await load()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Import failed.', 'error')
    } finally {
      setImporting(null)
    }
  }

  async function addPage() {
    const trimmed = pagePath.trim()
    if (!trimmed) {
      setPageError('Enter a path such as /about.')
      return
    }
    setAddingPage(true)
    setPageError(null)
    try {
      const res = await fetch(apiPath(`/api/admin/qa/sites/${siteId}/pages`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: trimmed }),
      })
      if (!res.ok) throw new Error(await errorText(res))
      setPagePath('')
      await load()
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Could not add the page.')
    } finally {
      setAddingPage(false)
    }
  }

  async function archiveSite() {
    try {
      const res = await fetch(apiPath(`/api/admin/qa/sites/${siteId}`), { method: 'DELETE' })
      if (!res.ok) throw new Error(await errorText(res))
      router.push('/qa')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not archive the site.', 'error')
    }
  }

  if (loading && !data) return <LoadingSkeleton rows={6} height={56} />

  if (error && !data) {
    return (
      <EmptyState
        title="Could not load this site"
        description={error}
        ctaLabel="Try again"
        onCtaClick={() => void load()}
      />
    )
  }

  if (!data) return null
  const site = data.item
  const livePages = data.pages.filter(p => !p.removedAt)
  const removedPages = data.pages.filter(p => p.removedAt)

  return (
    <div className="flex flex-col" style={{ gap: '1.5rem' }}>
      <PageHeader
        title={site.name}
        subtitle={
          <span className="flex flex-wrap items-center" style={{ gap: '0.5rem' }}>
            <Link href={`/clients/${site.orgId}`} className="underline hover:text-[var(--color-brand-dark)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]">
              {site.orgName ?? 'Client'}
            </Link>
            {site.stagingUrl ? (
              <a href={site.stagingUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--color-brand-dark)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]">
                Staging
              </a>
            ) : null}
            {site.liveUrl ? (
              <a href={site.liveUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--color-brand-dark)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]">
                Live
              </a>
            ) : null}
          </span>
        }
      >
        <div className="flex flex-wrap" style={{ gap: '0.5rem' }}>
          {site.stagingUrl ? (
            <TahiButton variant="secondary" size="md" loading={importing === 'staging'} disabled={importing !== null} onClick={() => void importFrom('staging')}>
              {site.liveUrl ? 'Import pages from staging' : 'Import pages'}
            </TahiButton>
          ) : null}
          {site.liveUrl ? (
            <TahiButton variant="secondary" size="md" loading={importing === 'live'} disabled={importing !== null} onClick={() => void importFrom('live')}>
              {site.stagingUrl ? 'Import pages from live' : 'Import pages'}
            </TahiButton>
          ) : null}
          <TahiButton variant="secondary" size="md" onClick={() => setEditOpen(true)}>Edit</TahiButton>
          <TahiButton variant="ghost" size="md" onClick={() => setArchiveOpen(true)}>Archive</TahiButton>
        </div>
      </PageHeader>

      {importResult ? (
        <p role="status" className="rounded-[var(--radius-leaf-sm)] bg-[var(--color-brand-50)] px-3 py-2 text-[var(--color-text)]" style={{ fontSize: '0.8125rem' }}>
          Added {importResult.added}, updated {importResult.updated}, flagged {importResult.removed} as removed. {importResult.total} pages in the sitemap.
        </p>
      ) : null}

      {activeRoundId ? (
        <div className="flex flex-col" style={{ gap: '0.75rem' }}>
          <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
            <TahiButton
              variant="secondary"
              size="md"
              iconLeft={<ChevronLeft className="w-4 h-4" aria-hidden="true" />}
              onClick={() => openRound(null)}
            >
              All rounds
            </TahiButton>
          </div>
          <RoundWorkspace siteId={siteId} roundId={activeRoundId} />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <section aria-label="Rounds" className="flex flex-col" style={{ gap: '0.75rem' }}>
            <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Rounds</h2>
              <TahiButton variant="primary" size="md" onClick={() => setRoundOpen(true)} disabled={!site.stagingUrl && !site.liveUrl}>
                Start round
              </TahiButton>
            </div>
            {data.rounds.length === 0 ? (
              <EmptyState
                variant="inline"
                title="No rounds yet"
                description="Start a round to QA this site page by page at every screen size."
                ctaLabel="Start round"
                onCtaClick={() => setRoundOpen(true)}
              />
            ) : (
              <ul className="flex flex-col" style={{ gap: '0.5rem' }}>
                {data.rounds.map(r => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => openRound(r.id)}
                      className="flex min-h-[2.75rem] w-full flex-wrap items-center justify-between rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-left transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                      style={{ gap: '0.5rem' }}
                    >
                      <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{r.name}</span>
                      <span className="flex items-center" style={{ gap: '0.375rem' }}>
                        <Badge tone={r.target === 'live' ? 'info' : 'neutral'} variant="soft" size="sm">{r.target === 'live' ? 'Live' : 'Staging'}</Badge>
                        <Badge tone={r.status === 'open' ? 'positive' : 'neutral'} variant="soft" size="sm">{r.status === 'open' ? 'Open' : 'Closed'}</Badge>
                        <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem' }}>{fmtDate(r.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Pages" className="flex flex-col" style={{ gap: '0.75rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700 }}>Pages ({livePages.length})</h2>
            {livePages.length === 0 && removedPages.length === 0 ? (
              <EmptyState
                variant="inline"
                title="No pages yet"
                description="Import from sitemap.xml, or add a page by path."
                action={
                  <div className="flex flex-wrap justify-center" style={{ gap: '0.5rem' }}>
                    {site.stagingUrl ? (
                      <TahiButton variant="primary" size="md" onClick={() => void importFrom('staging')} disabled={importing !== null}>
                        Import from sitemap.xml
                      </TahiButton>
                    ) : null}
                    {site.liveUrl && !site.stagingUrl ? (
                      <TahiButton variant="primary" size="md" onClick={() => void importFrom('live')} disabled={importing !== null}>
                        Import from sitemap.xml
                      </TahiButton>
                    ) : null}
                  </div>
                }
              />
            ) : (
              <ul className="flex flex-col" style={{ gap: '0.25rem', fontSize: '0.8125rem' }} aria-label="Page paths">
                {livePages.map(p => (
                  <li key={p.id} className="flex min-h-[2.75rem] items-center justify-between rounded-[var(--radius-leaf-sm)] px-2 hover:bg-[var(--color-bg-tertiary)]">
                    <span className="truncate">{p.path}</span>
                    {p.groupKey ? <span className="text-[var(--color-text-subtle)]" style={{ fontSize: '0.75rem' }}>{`/${p.groupKey.replace(/^\/+/, '').replace(/\/\*$/, '')}/*`}</span> : null}
                  </li>
                ))}
                {removedPages.map(p => (
                  <li key={p.id} className="flex min-h-[2.75rem] items-center justify-between rounded-[var(--radius-leaf-sm)] px-2 text-[var(--color-text-subtle)]">
                    <span className="truncate line-through">{p.path}</span>
                    <span style={{ fontSize: '0.75rem' }}>Removed</span>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="flex flex-wrap items-end"
              style={{ gap: '0.5rem' }}
              onSubmit={e => {
                e.preventDefault()
                void addPage()
              }}
            >
              <div className="flex min-w-0 flex-1 flex-col" style={{ gap: '0.25rem' }}>
                <label htmlFor={pagePathId} className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                  Add a page by path
                </label>
                <Input id={pagePathId} value={pagePath} onChange={e => setPagePath(e.target.value)} placeholder="/about" />
              </div>
              <TahiButton type="submit" variant="secondary" size="md" loading={addingPage} disabled={addingPage}>Add page</TahiButton>
            </form>
            {pageError ? <p role="alert" className="text-[var(--color-danger)]" style={{ fontSize: '0.8125rem' }}>{pageError}</p> : null}
          </section>
        </div>
      )}

      <AddSiteDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        site={editSite}
        onSaved={() => void load()}
      />
      <StartRoundDialog
        open={roundOpen}
        onClose={() => setRoundOpen(false)}
        siteId={siteId}
        stagingUrl={site.stagingUrl}
        liveUrl={site.liveUrl}
        onStarted={id => {
          setRoundOpen(false)
          void load()
          openRound(id)
        }}
      />
      <ConfirmDialog
        open={archiveOpen}
        title="Archive this site?"
        description="The site, its pages and its rounds are hidden from the QA list. Nothing is deleted."
        confirmLabel="Archive site"
        variant="danger"
        onConfirm={async () => {
          setArchiveOpen(false)
          await archiveSite()
        }}
        onCancel={() => setArchiveOpen(false)}
      />
    </div>
  )
}
