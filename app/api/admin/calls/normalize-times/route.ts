import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { planCallTimeBackfill, type CallTimeRow } from '@/lib/call-time-backfill'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/calls/normalize-times
 *
 * Rewrites discovery_calls.scheduledAt and scheduled_calls.scheduledAt
 * rows that predate the call-time timezone fix (2026-09-12) to the
 * canonical absolute-instant form ("...Z" with milliseconds).
 *
 * Every writer now normalises at the boundary (lib/call-time.ts), so
 * this is a one-time data repair for rows already in D1, not an
 * ongoing job. It is a data repair, not a migration (CLAUDE.md: IF NOT
 * EXISTS migrations are for schema, not data), so it lives behind this
 * admin route the same way lib/invoice-number-backfill.ts does.
 *
 * WHAT IT DOES:
 *   Reads every row's scheduledAt. A row already in canonical form is
 *   left untouched. A row with an explicit offset (Google Calendar's
 *   own RFC3339 shape, e.g. "...+12:00") is re-serialised to the exact
 *   same instant in Z form. This never changes what the row means, it
 *   only fixes the TEXT representation that broke lexicographic window
 *   comparisons. A naive row (no offset at all) is interpreted as
 *   Pacific/Auckland wall-clock time, same as every writer does today.
 *
 * dryRun DEFAULTS TO TRUE. The unqualified call returns the exact plan,
 * row by row, and touches nothing. Pass { "dryRun": false } to apply it.
 *
 * HOW TO RUN IT (Liam):
 *   1. POST here with no body (or { "dryRun": true }) and read the
 *      plan: check `fixes` looks right and `refusals` is empty or
 *      explainable.
 *   2. POST again with { "dryRun": false } to apply it.
 *   Safe to run more than once: canonical rows are always skipped, and
 *   each write is guarded by `scheduledAt = <the value the plan read>`
 *   so a row that changed underneath the plan (a fresh booking, a
 *   calendar re-sync) loses that race rather than being overwritten.
 *
 * Response shape is the same either way:
 *   { success, dryRun, scanned, alreadyCanonical, fixedCount,
 *     fixed: [{ id, table, from, to }], refusedCount,
 *     refused: [{ id, table, scheduledAt, reason }], failed? }
 */
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { dryRun?: unknown }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    return NextResponse.json({ error: 'dryRun must be true or false' }, { status: 400 })
  }
  const dryRun = body.dryRun !== false

  const database = (await db()) as unknown as D1

  const [discoveryRows, scheduledRows] = await Promise.all([
    database.select({ id: schema.discoveryCalls.id, scheduledAt: schema.discoveryCalls.scheduledAt }).from(schema.discoveryCalls),
    database.select({ id: schema.scheduledCalls.id, scheduledAt: schema.scheduledCalls.scheduledAt }).from(schema.scheduledCalls),
  ])

  const rows: CallTimeRow[] = [
    ...discoveryRows.map(r => ({ id: r.id, table: 'discovery_calls' as const, scheduledAt: r.scheduledAt })),
    ...scheduledRows.map(r => ({ id: r.id, table: 'scheduled_calls' as const, scheduledAt: r.scheduledAt })),
  ]

  const plan = planCallTimeBackfill(rows)

  if (dryRun) {
    return NextResponse.json({
      success: true,
      dryRun: true,
      scanned: rows.length,
      alreadyCanonical: plan.alreadyCanonical,
      fixedCount: plan.fixes.length,
      fixed: plan.fixes,
      refusedCount: plan.refusals.length,
      refused: plan.refusals,
    })
  }

  const applied: typeof plan.fixes = []
  const failed: Array<{ id: string; table: string; error: string }> = []

  for (const fix of plan.fixes) {
    try {
      if (fix.table === 'discovery_calls') {
        await database
          .update(schema.discoveryCalls)
          .set({ scheduledAt: fix.to, updatedAt: new Date().toISOString() })
          .where(and(eq(schema.discoveryCalls.id, fix.id), eq(schema.discoveryCalls.scheduledAt, fix.from)))
      } else {
        await database
          .update(schema.scheduledCalls)
          .set({ scheduledAt: fix.to, updatedAt: new Date().toISOString() })
          .where(and(eq(schema.scheduledCalls.id, fix.id), eq(schema.scheduledCalls.scheduledAt, fix.from)))
      }
      applied.push(fix)
    } catch (err) {
      console.error('[normalize-times] could not write scheduledAt', err)
      failed.push({
        id: fix.id,
        table: fix.table,
        error: 'Could not write this row. It may have changed since the plan was built.',
      })
    }
  }

  return NextResponse.json({
    success: true,
    dryRun: false,
    scanned: rows.length,
    alreadyCanonical: plan.alreadyCanonical,
    fixedCount: applied.length,
    fixed: applied,
    refusedCount: plan.refusals.length,
    refused: plan.refusals,
    ...(failed.length > 0 ? { failedCount: failed.length, failed } : {}),
  })
}
