'use client'

/**
 * ScheduledJobsSection - visibility + manual triggers for every background job.
 *
 * Reads real data from GET /api/admin/crons (-> { items }), where each item
 * carries the job's label, human-readable schedule, its most recent run and a
 * POST endpoint that fires the job manually. Each row shows label, schedule,
 * last-run relative time, a status chip and a "Run now" button that POSTs the
 * item's endpoint then revalidates so the fresh run surfaces.
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

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return mins + 'm ago'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours + 'h ago'
  const days = Math.floor(hours / 24)
  return days + 'd ago'
}

function statusChip(status: CronStatus): { tone: ChipTone; label: string } {
  if (status === 'success') return { tone: 'brand', label: 'Success' }
  if (status === 'error') return { tone: 'danger', label: 'Failed' }
  return { tone: 'neutral', label: 'Skipped' }
}

export function ScheduledJobsSection(_props: { isAdmin?: boolean } = {}) {
  const { data, isLoading, mutate } = useResource<CronsResponse>('/api/admin/crons')
  const items = data?.items ?? []
  const [running, setRunning] = useState<string | null>(null)

  async function runNow(item: CronItem) {
    setRunning(item.cron)
    try {
      await fetch(apiPath(item.endpoint), { method: 'POST' })
    } catch {
      // Swallow: the revalidate below reflects whatever the run recorded.
    } finally {
      setRunning(null)
      // Give the cron_runs row a beat to land, then refresh the list.
      setTimeout(() => {
        void mutate()
      }, 800)
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
            >
              <span className="lrow-ic leaf">
                <Clock size={16} />
              </span>
              <div className="lrow-t">
                <b style={{ color: 'var(--text-faint)' }}>Loading</b>
                <small>Fetching schedule</small>
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
                    {item.schedule} {'·'} {last ? formatRelative(last.ranAt) : 'Never run'}
                  </small>
                </div>
                <div className="lrow-r">
                  {chip ? (
                    <Chip tone={chip.tone}>{chip.label}</Chip>
                  ) : (
                    <Chip tone="neutral">Never run</Chip>
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
    </SectionShell>
  )
}
