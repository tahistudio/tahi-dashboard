/**
 * POST /api/admin/content/drafts/[id]/advance
 *
 * Drives the round-table orchestrator forward by ONE stage. Idempotent;
 * call repeatedly to walk the draft from queued → ready_for_publish.
 *
 * Contract:
 *   POST -> { nextStatus, costCentsThisStage, totalCostCents, message? }
 *   ?steps=N -> attempts up to N stages in one call (each respects the
 *     Cloudflare per-request budget; we bail early if a stage takes too long)
 *
 * Designed to be polled from the front-end with a 2s tick, or driven by a
 * cron loop that fires `?steps=3` periodically.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runStage } from '@/lib/round-table'

export const dynamic = 'force-dynamic'

const MAX_STEPS_PER_CALL = 5
const TIME_BUDGET_MS = 25_000

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  if (!id) return NextResponse.json({ error: 'Missing draft id' }, { status: 400 })

  const url = new URL(req.url)
  const stepsParam = Math.max(1, Math.min(MAX_STEPS_PER_CALL,
    parseInt(url.searchParams.get('steps') ?? '1', 10) || 1))

  const database = await db()
  const t0 = Date.now()
  const steps: Array<{ nextStatus: string; costCentsThisStage: number; totalCostCents: number; message?: string }> = []

  for (let i = 0; i < stepsParam; i++) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break
    const result = await runStage(database, id)
    steps.push(result)
    // Stop if we've hit a terminal status
    if (
      result.nextStatus === 'ready_for_publish' ||
      result.nextStatus === 'failed' ||
      result.nextStatus === 'cost_capped'
    ) break
  }

  const last = steps[steps.length - 1] ?? null
  return NextResponse.json({
    steps,
    nextStatus: last?.nextStatus,
    totalCostCents: last?.totalCostCents ?? 0,
    elapsedMs: Date.now() - t0,
  })
}
