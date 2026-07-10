'use client'

/**
 * ScheduledJobsSection - visibility + manual triggers for every background job.
 *
 * Reads real data from GET /api/admin/crons (-> { items }), where each item
 * carries the job's label, human-readable schedule, its most recent run and a
 * POST endpoint that fires the job manually. Each row shows label, schedule,
 * last-run relative time, a status chip and a "Run now" button that POSTs the
 * item's endpoint, surfaces the outcome as a toast, then revalidates so the
 * fresh run shows up.
 *
 * Admin-only. Rendered inside the settings shell, which already gates on admin.
 */

import { useState } from 'react'
import { Clock } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import {
  SectionShell,
  EmptyRow,
  Chip,
  Toasts,
  useToasts,
  type ChipTone,
} from '@/components/tahi/settings/primitives'

type CronStatus = 'success' | 'error' | 'skipped'

interface CronRun {
  id: string
  status: CronStatus
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

interface CronsResponse {
  items: CronItem[]
}

function statusChip(status: CronStatus): { tone: ChipTone; label: string } {
  if (status === 'success') return { tone: 'brand', label: 'Success' }
  if (status === 'error') return { tone: 'danger', label: 'Failed' }
  return { tone: 'outline', label: 'Skipped' }
}

// Relative label in the design's long form ("12 min ago", "2 hours ago").
function lastRunLabel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

export function ScheduledJobsSection(_props: { isAdmin?: boolean } = {}) {
  const { data, isLoading, mutate } = useResource<CronsResponse>('/api/admin/crons')
  const items = data?.items ?? []
  const [running, setRunning] = useState<string | null>(null)
  const { toasts, toast } = useToasts()

  async function runNow(item: CronItem) {
    setRunning(item.cron)
    try {
      const res = await fetch(apiPath(item.endpoint), { method: 'POST' })
      if (res.ok) {
        toast(`${item.label} ran`)
      } else {
        toast(`${item.label} failed (HTTP ${res.status})`, 'err')
      }
    } catch {
      toast(`${item.label} could not be reached`, 'err')
    } finally {
      setRunning(null)
      // The trigger endpoints only respond once the job (and its cron_runs
      // row) has completed, so an immediate revalidate picks up the fresh run.
      await mutate()
    }
  }

  return (
    <SectionShell title="Scheduled jobs" lede="Background jobs and their last runs.">
      <div className="set-card lrow-wrap">
        {isLoading ? (
          [0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="lrow"
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
              aria-hidden="true"
            >
              <span className="lrow-ic leaf" style={{ opacity: 0.4 }}>
                <Clock size={16} />
              </span>
              <div className="lrow-t">
                <span
                  className="animate-pulse"
                  style={{ display: 'block', height: 12, width: 150, borderRadius: 6, background: 'var(--border-subtle)' }}
                />
                <span
                  className="animate-pulse"
                  style={{ display: 'block', height: 9, width: 110, borderRadius: 6, background: 'var(--border-subtle)', marginTop: 7 }}
                />
              </div>
              <div className="lrow-r">
                <span
                  className="animate-pulse"
                  style={{ display: 'block', height: 20, width: 62, borderRadius: 999, background: 'var(--border-subtle)' }}
                />
              </div>
            </div>
          ))
        ) : items.length ? (
          items.map((item, i) => {
            const last = item.lastRun
            const chip = last ? statusChip(last.status) : null
            const isRunning = running === item.cron
            return (
              <div
                key={item.cron}
                className="lrow"
                style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
              >
                <span className="lrow-ic leaf">
                  <Clock size={16} />
                </span>
                <div className="lrow-t">
                  <b>{item.label}</b>
                  <small>
                    {item.schedule} {'·'} {last ? lastRunLabel(last.ranAt) : 'Never run'}
                  </small>
                </div>
                <div className="lrow-r">
                  {chip ? (
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                  ) : (
                    <Chip tone="outline">Never run</Chip>
                  )}
                  <button
                    type="button"
                    className="btn2 sm"
                    disabled={isRunning}
                    onClick={() => void runNow(item)}
                  >
                    {isRunning ? 'Running' : 'Run now'}
                  </button>
                </div>
              </div>
            )
          })
        ) : (
          <EmptyRow text="No scheduled jobs registered." />
        )}
      </div>
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
