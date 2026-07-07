/**
 * POST /api/admin/financial-reports/backfill-mrr
 *
 * One-shot backfill: walks every org that has at least one closed-won
 * deal and recomputes organisations.custom_mrr as the sum of
 * monthly_value_nzd across all active won deals on that org.
 *
 * Safe to re-run — idempotent (writes the same value if nothing changed).
 * Use after wiring auto-MRR-on-deal-close (so existing data catches up
 * without needing to re-touch every deal).
 *
 * Auth: admin session only. Returns the per-org delta + total.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'financial_reports')
  if (denied) return denied

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  // Pull every org that has won deals + sum their monthly_value_nzd.
  // Skip orgs where custom_mrr has been manually set (custom_mrr_is_manual = 1)
  // so an operator's correction isn't blown away by the next backfill.
  // This was the source of the "Giant Group MRR is NZ$66,760" bug — the
  // deal had a bad monthly_value_nzd, backfill wrote it to the org, and
  // every manual fix got reverted on the next run.
  const orgMrrRows = await database.all<{ orgId: string; orgName: string; newMrr: number; oldMrr: number; isManual: number }>(sql`
    SELECT
      o.id AS orgId,
      o.name AS orgName,
      COALESCE(SUM(d.monthly_value_nzd), 0) AS newMrr,
      COALESCE(o.custom_mrr, 0) AS oldMrr,
      COALESCE(o.custom_mrr_is_manual, 0) AS isManual
    FROM organisations o
    INNER JOIN deals d ON d.org_id = o.id
    INNER JOIN pipeline_stages s ON d.stage_id = s.id
    WHERE s.is_closed_won = 1
      AND d.monthly_value_nzd > 0
      AND (d.engagement_end_date IS NULL OR d.engagement_end_date > datetime('now'))
    GROUP BY o.id, o.name
  `)

  let updated = 0
  let unchanged = 0
  let skippedManual = 0
  const changes: Array<{ orgId: string; orgName: string; oldMrr: number; newMrr: number }> = []
  const skipped: Array<{ orgId: string; orgName: string; manualMrr: number; computedMrr: number }> = []

  for (const row of orgMrrRows) {
    const newMrr = Number(row.newMrr)
    const oldMrr = Number(row.oldMrr)
    if (row.isManual === 1) {
      skippedManual++
      skipped.push({ orgId: row.orgId, orgName: row.orgName, manualMrr: oldMrr, computedMrr: newMrr })
      continue
    }
    if (Math.abs(newMrr - oldMrr) < 0.01) {
      unchanged++
      continue
    }
    await database.run(sql`
      UPDATE organisations
      SET custom_mrr = ${newMrr}, updated_at = ${now}
      WHERE id = ${row.orgId}
    `)
    changes.push({ orgId: row.orgId, orgName: row.orgName, oldMrr, newMrr })
    updated++
  }

  return NextResponse.json({
    scanned: orgMrrRows.length,
    updated,
    unchanged,
    skippedManual,
    changes,
    skipped,
  })
}
