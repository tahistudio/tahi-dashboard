'use client'

/**
 * The Sites card on the client detail Overview. Lists the client's QA sites
 * with the progress of their newest open round, and opens the Add site
 * dialog. The card refreshes in place after a save instead of navigating.
 *
 * The parent wraps this in <Gate feature="qa_tester">, so viewers without the
 * feature never see it. The API routes enforce the same rule server side.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Globe } from 'lucide-react'
import { AddSiteDialog } from '@/app/(dashboard)/qa/add-site-dialog'
import { apiPath } from '@/lib/api'
import { Block, InlineAction } from '@/app/(dashboard)/clients/[id]/_kit/chrome'
import { Badge } from '@/components/tahi/badge'
import { DataState } from '@/components/tahi/data-state'
import { EmptyState } from '@/components/tahi/empty-state'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { ProgressBar } from '@/components/tahi/progress-bar'

interface OpenRoundSummary {
  id: string
  name: string
  target: string
  ticksDone: number
  ticksTotal: number
  failing: number
  issues: number
}

interface QaSiteListItem {
  id: string
  orgId: string
  orgName: string | null
  name: string
  stagingUrl: string | null
  liveUrl: string | null
  openRound: OpenRoundSummary | null
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export function QaSitesCard({ orgId }: { orgId: string }) {
  const [items, setItems] = useState<QaSiteListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch(apiPath(`/api/admin/qa/sites?orgId=${encodeURIComponent(orgId)}`))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { items?: QaSiteListItem[] }
      setItems(json.items ?? [])
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <Block
        icon={<Globe className="w-3.5 h-3.5" />}
        title="Sites"
        count={items.length}
        action={<InlineAction onClick={() => setAdding(true)}>Add site</InlineAction>}
      >
        <DataState
          loading={loading}
          hasData={items.length > 0}
          error={error ? 'failed' : undefined}
          onRetry={() => void load()}
          errorTitle="Sites could not be loaded."
          skeleton={<div style={{ padding: '0.75rem' }}><LoadingSkeleton rows={2} height={56} /></div>}
          isEmpty={!loading && !error && items.length === 0}
          empty={
            <EmptyState
              variant="inline"
              icon={<Globe className="w-8 h-8" />}
              title="No sites yet"
              description="Add a client website to start a QA round."
              ctaLabel="Add site"
              onCtaClick={() => setAdding(true)}
            />
          }
        >
          <ul className="flex flex-col" style={{ listStyle: 'none', margin: 0, padding: '0.25rem', gap: '0.25rem' }}>
            {items.map(site => {
              const hosts = [hostOf(site.stagingUrl), hostOf(site.liveUrl)].filter(Boolean).join(' | ')
              const round = site.openRound
              return (
                <li key={site.id}>
                  <Link
                    href={`/qa/${site.id}`}
                    className="tahi-focus-ring flex items-center hover:bg-[var(--color-bg-secondary)] transition-colors"
                    style={{ gap: '0.75rem', minHeight: '2.75rem', padding: '0.75rem 0.875rem', textDecoration: 'none', borderRadius: 'var(--radius-sm)' }}
                  >
                    <span className="flex flex-col min-w-0" style={{ flex: 1, gap: '0.125rem' }}>
                      <span className="truncate" style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                        {site.name}
                      </span>
                      {hosts && (
                        <span className="truncate" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                          {hosts}
                        </span>
                      )}
                    </span>
                    {round ? (
                      <span className="flex flex-col" style={{ gap: '0.25rem', minWidth: '7rem', maxWidth: '11rem' }}>
                        <span className="flex items-center" style={{ gap: '0.375rem', justifyContent: 'flex-end' }}>
                          <span className="truncate" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                            {round.name}
                          </span>
                          {round.failing > 0 && (
                            <Badge tone="danger" size="sm">{round.failing} failing</Badge>
                          )}
                        </span>
                        <ProgressBar
                          value={round.ticksDone}
                          max={Math.max(round.ticksTotal, 1)}
                          height={6}
                          ariaLabel={`${round.name}: ${round.ticksDone} of ${round.ticksTotal} ticks done`}
                        />
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>No open round</span>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />
                  </Link>
                </li>
              )
            })}
          </ul>
        </DataState>
      </Block>

      <AddSiteDialog
        open={adding}
        onClose={() => setAdding(false)}
        defaultOrgId={orgId}
        onSaved={() => {
          setAdding(false)
          void load()
        }}
      />
    </>
  )
}
