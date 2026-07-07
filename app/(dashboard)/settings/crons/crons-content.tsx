'use client'

/**
 * /settings/crons — visibility + manual triggers for every scheduled job.
 *
 * Each row shows the cron's label, schedule, last-run timestamp, status
 * chip, summary, and a "Run now" button. Cron history (last 10 runs)
 * collapses behind a disclosure for debugging.
 */

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
  ArrowLeft, RefreshCw, Play, CheckCircle2, AlertTriangle, Clock,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { formatRelative } from '@/lib/utils'
import { Badge } from '@/components/tahi/badge'
import { useToast } from '@/components/tahi/toast'
import { apiPath } from '@/lib/api'

interface CronRun {
  id: string
  status: 'success' | 'error' | 'skipped'
  durationMs: number
  summary: string | null
  error: string | null
  ranAt: string
}

interface CronItem {
  cron: string
  label: string
  description: string
  endpoint: string
  schedule: string
  lastRun: CronRun | null
  recentRuns: CronRun[]
}

function statusTone(status: string): 'positive' | 'danger' | 'warning' | 'neutral' {
  if (status === 'success') return 'positive'
  if (status === 'error') return 'danger'
  if (status === 'skipped') return 'warning'
  return 'neutral'
}

export function CronsContent() {
  const { showToast } = useToast()
  const { data, isLoading: loading, mutate } = useSWR<{ items: CronItem[] }>('/api/admin/crons')
  const items = data?.items ?? []
  const [runningCron, setRunningCron] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function runNow(cron: CronItem) {
    setRunningCron(cron.cron)
    try {
      const r = await fetch(apiPath(cron.endpoint), { method: 'POST' })
      const data = await r.json() as Record<string, unknown>
      if (r.ok) {
        showToast(`${cron.label} ran`, 'success')
      } else {
        showToast(`${cron.label} failed: ${data.error ?? 'unknown'}`, 'error')
      }
    } catch (err) {
      showToast(`${cron.label} errored: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      setRunningCron(null)
      // Refresh after a tick so the new cron_run row is visible.
      setTimeout(() => { void mutate() }, 800)
    }
  }

  function toggleExpanded(cron: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(cron)) next.delete(cron)
      else next.add(cron)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="text-xs">
        <Link href="/settings" className="inline-flex items-center gap-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <ArrowLeft size={12} /> Settings
        </Link>
      </div>
      <PageHeader
        title="Scheduled jobs"
        subtitle="Every background job that runs on a timer. Tap Run now to fire one manually and see the result."
      >
        <TahiButton
          variant="secondary"
          size="sm"
          onClick={() => void mutate()}
          iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
        >
          Refresh
        </TahiButton>
      </PageHeader>

      {loading ? (
        <Card>
          <div className="space-y-3 p-2">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="animate-pulse rounded-lg" style={{ height: '4.5rem', background: 'var(--color-bg-secondary)' }} />
            ))}
          </div>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
            No scheduled jobs registered.
          </div>
        </Card>
      ) : (
        <div className="grid" style={{ gap: '0.75rem' }}>
          {items.map(item => {
            const isExpanded = expanded.has(item.cron)
            const isRunning = runningCron === item.cron
            return (
              <Card key={item.cron}>
                <div style={{ padding: '1rem 1.125rem' }}>
                  <div className="flex items-start justify-between gap-3" style={{ flexWrap: 'wrap' }}>
                    <div className="min-w-0" style={{ flex: 1 }}>
                      <div className="flex items-center" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                        <h3 className="text-sm font-bold text-[var(--color-text)]">{item.label}</h3>
                        <Badge tone="neutral" variant="soft" size="sm">{item.schedule}</Badge>
                        {item.lastRun && (
                          <Badge tone={statusTone(item.lastRun.status)} variant="soft" size="sm">
                            {item.lastRun.status === 'success' && <CheckCircle2 size={11} style={{ marginRight: 4 }} />}
                            {item.lastRun.status === 'error' && <AlertTriangle size={11} style={{ marginRight: 4 }} />}
                            {item.lastRun.status === 'skipped' && <Clock size={11} style={{ marginRight: 4 }} />}
                            {item.lastRun.status}
                          </Badge>
                        )}
                        {item.lastRun ? (
                          <span className="text-xs text-[var(--color-text-muted)]">
                            ran {formatRelative(item.lastRun.ranAt)} · {item.lastRun.durationMs}ms
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-text-subtle)] italic">never run</span>
                        )}
                      </div>
                      <p className="text-xs mt-1.5 text-[var(--color-text-muted)]" style={{ lineHeight: 1.5 }}>
                        {item.description}
                      </p>
                      {item.lastRun?.error && (
                        <div className="mt-2 rounded-lg px-3 py-2 text-xs" style={{
                          background: 'var(--color-danger-bg)',
                          border: '1px solid var(--color-danger)',
                          color: 'var(--color-danger)',
                          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                        }}>
                          {item.lastRun.error}
                        </div>
                      )}
                    </div>
                    <div className="flex" style={{ gap: '0.375rem', flexShrink: 0 }}>
                      <TahiButton
                        size="sm"
                        variant="secondary"
                        loading={isRunning}
                        iconLeft={<Play className="w-3.5 h-3.5" />}
                        onClick={() => void runNow(item)}
                      >
                        Run now
                      </TahiButton>
                      <button
                        onClick={() => toggleExpanded(item.cron)}
                        aria-label={isExpanded ? 'Hide history' : 'Show history'}
                        style={{
                          padding: '0.4375rem 0.5rem',
                          background: 'transparent',
                          border: '1px solid var(--color-border)',
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--color-text-muted)',
                          cursor: 'pointer',
                        }}
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="mt-3" style={{
                      borderTop: '1px solid var(--color-border-subtle)',
                      paddingTop: '0.75rem',
                    }}>
                      <p className="text-[0.625rem] font-bold uppercase tracking-wider text-[var(--color-text-subtle)] mb-2">
                        Recent runs (last 10)
                      </p>
                      {item.recentRuns.length === 0 ? (
                        <p className="text-xs text-[var(--color-text-subtle)] italic">No runs yet.</p>
                      ) : (
                        <div className="grid" style={{ gap: '0.375rem' }}>
                          {item.recentRuns.map(run => (
                            <div key={run.id} className="flex items-center justify-between text-xs" style={{
                              padding: '0.4375rem 0.625rem',
                              background: 'var(--color-bg-secondary)',
                              borderRadius: 'var(--radius-sm)',
                              gap: '0.5rem',
                            }}>
                              <span className="flex items-center" style={{ gap: '0.5rem', minWidth: 0 }}>
                                <Badge tone={statusTone(run.status)} variant="soft" size="sm">{run.status}</Badge>
                                <span className="text-[var(--color-text-muted)]">{formatRelative(run.ranAt)}</span>
                                <span className="text-[var(--color-text-subtle)]">{run.durationMs}ms</span>
                              </span>
                              {run.summary && (
                                <span className="truncate text-[var(--color-text-subtle)] font-mono text-[0.625rem]" style={{ maxWidth: '60%' }}>
                                  {run.summary.slice(0, 120)}{run.summary.length > 120 ? '…' : ''}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
