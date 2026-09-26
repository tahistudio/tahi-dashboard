/**
 * GET /api/admin/crons, the list behind /settings (Scheduled jobs) and the
 * MCP list_crons tool.
 *
 * Pinned: the daily financial snapshot is listed, with the endpoint "Run now"
 * posts (the current-month write, never a fill or a backfill) and the runs
 * it logged under its own cron name, so a skipped or failed snapshot month is
 * visible instead of discovered weeks later as a missing row.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))
vi.mock('@/lib/require-feature', () => ({ requireFeature: vi.fn().mockResolvedValue(null) }))

const RUN = {
  id: 'run-1',
  status: 'success',
  durationMs: 812,
  summary: '{"steps":[]}',
  error: null,
  ranAt: '2026-09-25T18:00:04.000Z',
}

// Every cron's query answers with the one run above; what matters is which
// cron names were asked for.
const askedFor: unknown[] = []
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    eq: (_column: unknown, value: unknown) => {
      askedFor.push(value)
      return actual.sql`1 = 1`
    },
  }
})
vi.mock('@/lib/db', () => ({
  db: vi.fn().mockResolvedValue({
    select: () => {
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve([RUN]),
      }
      return chain
    },
  }),
}))

import { NextRequest } from 'next/server'
import { GET as listCrons } from '@/app/api/admin/crons/route'

interface CronItem {
  cron: string
  label: string
  endpoint: string
  schedule: string
  lastRun: typeof RUN | null
}

describe('GET /api/admin/crons', () => {
  it('lists the monthly financial snapshot with its runs', async () => {
    const res = await listCrons(new NextRequest('http://localhost:3000/api/admin/crons'))
    const body = await res.json() as { items: CronItem[] }

    const snapshot = body.items.find((item) => item.cron === 'snapshot-metrics')
    expect(snapshot).toBeDefined()
    expect(snapshot?.endpoint).toBe('/api/admin/cron/snapshot-metrics')
    expect(snapshot?.label).toBe('Monthly financial snapshot')
    expect(snapshot?.schedule).toContain('Daily')
    expect(snapshot?.lastRun).toEqual(RUN)
    expect(askedFor).toContain('snapshot-metrics')
  })

  it('keeps one entry per cron name', async () => {
    const res = await listCrons(new NextRequest('http://localhost:3000/api/admin/crons'))
    const body = await res.json() as { items: CronItem[] }
    const names = body.items.map((item) => item.cron)
    expect(new Set(names).size).toBe(names.length)
  })
})
