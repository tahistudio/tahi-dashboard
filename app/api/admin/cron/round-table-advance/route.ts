/**
 * POST /api/admin/cron/round-table-advance
 *
 * Cron hand-cranks the round-table orchestrator. Picks the oldest draft
 * in a non-terminal status and advances it one stage. Idempotent and
 * resilient — if a stage fails for one draft, we move on to the next.
 *
 * Schedule: every 5 minutes via Webflow Cloud cron once Liam wakes up
 * and approves the plan. Until then this can be called manually from
 * the UI ("Advance all drafts" button).
 *
 * Contract:
 *   POST { dryRun?: boolean, maxDrafts?: number, stepsPerDraft?: number }
 *   200: { advanced: [{ draftId, fromStatus, toStatus, costCents }], skipped: number }
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { inArray, asc } from 'drizzle-orm'
import { runStage } from '@/lib/round-table'

export const dynamic = 'force-dynamic'

// Statuses that the orchestrator can advance from
const ACTIVE_STATUSES = [
  'queued', 'researching', 'strategising', 'headline_lab',
  'drafting', 'reviewing', 'editing', 'signing_off', 'covering',
] as const

const TIME_BUDGET_MS = 25_000

interface CronBody {
  dryRun?: boolean
  maxDrafts?: number
  stepsPerDraft?: number
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as CronBody
  const maxDrafts = Math.max(1, Math.min(10, body.maxDrafts ?? 3))
  const stepsPerDraft = Math.max(1, Math.min(5, body.stepsPerDraft ?? 1))
  const dryRun = body.dryRun === true

  const database = await db()
  const candidates = await database
    .select({
      id: schema.contentDrafts.id,
      status: schema.contentDrafts.status,
      updatedAt: schema.contentDrafts.updatedAt,
    })
    .from(schema.contentDrafts)
    .where(inArray(schema.contentDrafts.status, ACTIVE_STATUSES as unknown as string[]))
    .orderBy(asc(schema.contentDrafts.updatedAt))
    .limit(maxDrafts)

  if (dryRun) {
    return NextResponse.json({ dryRun: true, candidates, would: 'advance each by 1 stage' })
  }

  const t0 = Date.now()
  const advanced: Array<{ draftId: string; fromStatus: string; toStatus: string; costCents: number; steps: number }> = []
  let skipped = 0

  for (const c of candidates) {
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      skipped++
      continue
    }
    let lastStatus = c.status
    let lastCost = 0
    let steps = 0
    for (let i = 0; i < stepsPerDraft; i++) {
      if (Date.now() - t0 > TIME_BUDGET_MS) break
      try {
        const result = await runStage(database, c.id)
        lastStatus = result.nextStatus
        lastCost = result.totalCostCents
        steps++
        if (result.nextStatus === 'ready_for_publish' || result.nextStatus === 'failed' || result.nextStatus === 'cost_capped') break
      } catch (err) {
        console.error(`runStage failed for ${c.id}`, err)
        break
      }
    }
    advanced.push({ draftId: c.id, fromStatus: c.status, toStatus: lastStatus, costCents: lastCost, steps })
  }

  return NextResponse.json({
    advanced,
    skipped,
    elapsedMs: Date.now() - t0,
  })
}
