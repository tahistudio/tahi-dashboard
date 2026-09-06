/**
 * POST /api/admin/import/cleanup
 *
 * The seed-data cleanup that goes with the ManyRequests import. Super-admin
 * only, dry run by default, and deliberately a SEPARATE endpoint: it runs after
 * the import has landed and been eyeballed, because several of the rows it
 * touches are the merge targets the import writes into.
 *
 * Body:
 *   dryRun      boolean, default TRUE.
 *   archive     organisation ids to set to status 'archived'. Reversible.
 *   hardDelete  organisation ids to remove outright. REFUSED unless the row is
 *               on the ten-entry dummy allowlist (matched on BOTH id prefix and
 *               exact name), holds no Xero contact id, no Stripe customer id,
 *               no ManyRequests id, and no invoice. Every refusal comes back
 *               with its reason.
 *   wipeDemo    boolean. Removes the seed requests, their messages, time
 *               entries, participants and reads, plus the tasks and scheduled
 *               calls on dummy organisations. Only ever rows with NO
 *               ManyRequests key, so nothing the import created or adopted can
 *               be caught.
 *
 * NEVER TOUCHED: discovery_calls (the pre-call-digest cron mails real people
 * off that table every ten minutes), leads, deals, people, proposals,
 * schedules, invoices and invoice items. Pipeline and finance data is real.
 *
 * This route sends nothing and calls no other route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions } from '@/lib/permissions'
import { db } from '@/lib/db'
import type { DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import { DUMMY_ORGS, runCleanup } from '@/lib/import/manyrequests'

type PermissionsDb = Parameters<typeof resolvePermissions>[0]

interface CleanupBody {
  dryRun?: unknown
  archive?: unknown
  hardDelete?: unknown
  wipeDemo?: unknown
}

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) out.push(entry.trim())
  }
  return Array.from(new Set(out))
}

export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature(auth, 'settings')
  if (featureDenied) return featureDenied

  const database = (await db()) as DB

  // Super-admin only. This is the destructive door.
  const access = await resolvePermissions(database as unknown as PermissionsDb, auth)
  if (!access.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as CleanupBody
  const dryRun = body.dryRun !== false

  try {
    const plan = await runCleanup(database, {
      dryRun,
      archive: parseIds(body.archive),
      hardDelete: parseIds(body.hardDelete),
      wipeDemo: body.wipeDemo === true,
    })

    if (!dryRun && (plan.applied.orgsDeleted > 0 || plan.applied.archived > 0 || plan.applied.rowsDeleted > 0)) {
      await logAudit(database, {
        action: 'manyrequests_cleanup',
        userId: auth.userId,
        userType: 'team_member',
        entityType: 'import',
        entityId: 'cleanup',
        metadata: {
          archived: plan.archive.map((row) => ({ orgId: row.orgId, name: row.name })),
          hardDeleted: plan.hardDelete.map((row) => ({ orgId: row.orgId, name: row.name, children: row.children })),
          refused: plan.refused,
          applied: plan.applied,
        },
      })
    }

    return NextResponse.json(plan)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Cleanup failed' },
      { status: 500 },
    )
  }
}

/** GET returns the allowlist so a caller can see what is deletable at all. */
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature(auth, 'settings')
  if (featureDenied) return featureDenied

  return NextResponse.json({
    hardDeleteAllowlist: DUMMY_ORGS,
    defaults: { dryRun: true, wipeDemo: false },
    note: 'Hard delete matches BOTH the id prefix and the exact name, and refuses any organisation holding a Xero contact, a Stripe customer, a ManyRequests id or an invoice. discovery_calls is never touched.',
  })
}
