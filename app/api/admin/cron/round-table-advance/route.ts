/**
 * POST /api/admin/cron/round-table-advance
 *
 * Single cron that drives the whole round-table drafting pipeline:
 *
 *   1. SEED   - picks up approved content ideas that have no draft yet
 *               and creates a `queued` content_drafts row for each
 *               (gated by the content.draftingEnabled master toggle,
 *               same safety switch the retired draft-approved-ideas cron
 *               used). Bypass with ?force=1.
 *   2. ADVANCE - picks the oldest drafts in a non-terminal status and
 *               advances each one stage via the round-table orchestrator.
 *
 * Idempotent and resilient - if a stage fails for one draft, we move on
 * to the next. Each stage has its own per-draft cost cap check.
 *
 * Auth: TAHI_CRON_SECRET or admin session (assertCronAuth - same rules
 * as every other cron, so an external scheduler can trigger it).
 *
 * Contract:
 *   POST { dryRun?: boolean, maxDrafts?: number, stepsPerDraft?: number, maxSeed?: number }
 *   ?force=1  - bypass content.draftingEnabled for the seed step
 *   200: { seeded, advanced: [{ draftId, fromStatus, toStatus, costCents, steps }], skipped }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, asc, eq, inArray, notInArray } from 'drizzle-orm'
import { runStage } from '@/lib/round-table'
import { assertCronAuth, logCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
  maxSeed?: number
}

async function readSetting(database: Awaited<ReturnType<typeof db>>, key: string): Promise<string | null> {
  const [row] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1)
  return row?.value ?? null
}

/**
 * Seed step: create queued drafts for approved ideas that have no draft
 * yet. Mirrors the per-idea round-table entry point (create a queued
 * content_drafts row + flip the idea to 'drafted'). Returns the ideas we
 * seeded.
 */
async function seedApprovedIdeas(
  database: Awaited<ReturnType<typeof db>>,
  maxSeed: number,
): Promise<Array<{ ideaId: string; draftId: string }>> {
  // Ideas that already have any draft are off-limits (matches the legacy
  // draft-approved-ideas dedup: one draft per idea).
  const existing = await database
    .select({ ideaId: schema.contentDrafts.ideaId })
    .from(schema.contentDrafts)
  const blockedIds = existing.map(r => r.ideaId).filter((v): v is string => !!v)

  const where = blockedIds.length > 0
    ? and(
        eq(schema.contentIdeas.status, 'approved'),
        notInArray(schema.contentIdeas.id, blockedIds),
      )
    : eq(schema.contentIdeas.status, 'approved')

  const queue = await database
    .select({ id: schema.contentIdeas.id, title: schema.contentIdeas.title })
    .from(schema.contentIdeas)
    .where(where)
    .orderBy(asc(schema.contentIdeas.createdAt))
    .limit(maxSeed)

  const seeded: Array<{ ideaId: string; draftId: string }> = []
  for (const idea of queue) {
    if (!idea.title) continue
    const draftId = crypto.randomUUID()
    await database.insert(schema.contentDrafts).values({
      id: draftId,
      ideaId: idea.id,
      status: 'queued',
    })
    await database
      .update(schema.contentIdeas)
      .set({ status: 'drafted' })
      .where(eq(schema.contentIdeas.id, idea.id))
    seeded.push({ ideaId: idea.id, draftId })
  }
  return seeded
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const auth = await assertCronAuth(req)
  if (!auth.ok) return auth.response!

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'
  const body = (await req.json().catch(() => ({}))) as CronBody
  const maxDrafts = Math.max(1, Math.min(10, body.maxDrafts ?? 3))
  const stepsPerDraft = Math.max(1, Math.min(5, body.stepsPerDraft ?? 1))
  const maxSeed = Math.max(0, Math.min(3, body.maxSeed ?? 1))
  const dryRun = body.dryRun === true

  const database = await db()
  const loggerDb = database as unknown as D1

  // ── Seed step ──────────────────────────────────────────────────────
  // Gated by the content.draftingEnabled master toggle so approved ideas
  // are never auto-drafted until the operator trusts the loop. ?force=1
  // bypasses the toggle (manual "run now" from the crons UI).
  let seeded: Array<{ ideaId: string; draftId: string }> = []
  let seedSkipped: string | null = null
  if (maxSeed > 0 && !dryRun) {
    const enabled = await readSetting(database, 'content.draftingEnabled')
    if (force || enabled === 'true') {
      seeded = await seedApprovedIdeas(database, maxSeed)
    } else {
      seedSkipped = 'content.draftingEnabled is not true'
    }
  }

  // ── Advance step ───────────────────────────────────────────────────
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
    return NextResponse.json({
      dryRun: true,
      candidates,
      would: 'seed approved ideas + advance each draft by 1 stage',
    })
  }

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
      } catch {
        skipped++
        break
      }
    }
    advanced.push({ draftId: c.id, fromStatus: c.status, toStatus: lastStatus, costCents: lastCost, steps })
  }

  const summary = {
    seeded: seeded.length,
    seedSkipped,
    advanced,
    skipped,
    elapsedMs: Date.now() - t0,
  }
  await logCronRun(loggerDb, 'round-table-advance', 'success', Date.now() - t0, summary, null)
  return NextResponse.json(summary)
}
