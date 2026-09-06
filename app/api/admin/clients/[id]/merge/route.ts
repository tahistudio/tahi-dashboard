/**
 * POST /api/admin/clients/[id]/merge
 *
 * Fold the organisation named by [id] (the SHELL) into `into` (the SURVIVOR).
 *
 * Super admin only, and dry run by default. The ManyRequests import left the
 * studio with duplicate rows holding the real client's external ids and, in
 * one case, one of their invoices; archiving a shell hides it without giving
 * the client back their ledger.
 *
 * Body:
 *   into     REQUIRED. The organisation id that survives.
 *   dryRun   boolean, DEFAULT TRUE. The plan: rows per table, which external
 *            ids would be carried, which organisation columns would be filled,
 *            and which contacts move versus fold into a matching email.
 *
 * REFUSALS (400, each naming what is wrong):
 *   - the same organisation on both sides,
 *   - no survivor with that id,
 *   - an archived survivor,
 *   - a protected shell (the QA client or the internal studio marker),
 *   - both sides holding a DIFFERENT non-null xero_contact_id,
 *     stripe_customer_id, manyrequests_id or clerk_org_id. An external id is
 *     never overwritten; the field is named and the merge stops.
 * A shell that no longer exists answers 404, so re-running a merge is safe.
 *
 * This route sends nothing. It calls no mailer, raises no notification and
 * mints no invite.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions } from '@/lib/permissions'
import { db } from '@/lib/db'
import type { DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import { OrgMergeRefusal, OrgNotFound, runOrgMerge } from '@/lib/org-lifecycle'

type PermissionsDb = Parameters<typeof resolvePermissions>[0]
type Params = { params: Promise<{ id: string }> }

interface MergeBody {
  into?: unknown
  dryRun?: unknown
  /** Keep the survivor's external ids when both sides carry a different one. */
  keepSurvivorIds?: unknown
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature(auth, 'clients')
  if (featureDenied) return featureDenied

  const database = (await db()) as DB

  // Super admin only. Merging two clients rewrites a ledger's owner.
  const access = await resolvePermissions(database as unknown as PermissionsDb, auth)
  if (!access.isSuperAdmin) {
    return NextResponse.json(
      { error: 'Merging clients is limited to super admins.' },
      { status: 403 },
    )
  }

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as MergeBody
  const into = typeof body.into === 'string' ? body.into.trim() : ''
  if (!into) {
    return NextResponse.json({ error: 'into is required: the id of the organisation that survives the merge.' }, { status: 400 })
  }
  const dryRun = body.dryRun !== false

  try {
    const keepSurvivorIds = body.keepSurvivorIds === true
    const plan = await runOrgMerge(database, { shellId: id, survivorId: into, dryRun, keepSurvivorIds })

    if (!dryRun) {
      await logAudit(database, {
        action: 'client_merge',
        userId: auth.userId,
        userType: 'team_member',
        entityType: 'organisation',
        entityId: into,
        metadata: {
          shell: plan.shell,
          survivor: plan.survivor,
          tables: plan.tables,
          // The carried ids are recorded here on purpose: D1 gives no
          // cross-statement transaction, so the audit row is what makes a
          // half-applied merge recoverable without a database restore.
          externalIdsCarried: plan.externalIds.filter((row) => row.carried).map((row) => ({ field: row.field, value: row.shellValue })),
          columnsFilled: plan.columns.map((row) => row.field),
          contactsMoved: plan.contacts.moved.map((row) => ({ id: row.id, email: row.email })),
          contactsFolded: plan.contacts.folded.map((row) => ({ id: row.id, email: row.email, intoContactId: row.intoContactId })),
          contactReferences: plan.contacts.references,
          applied: plan.applied,
        },
      })
    }

    return NextResponse.json(plan)
  } catch (error) {
    if (error instanceof OrgNotFound) {
      return NextResponse.json({ error: 'No organisation with that id.' }, { status: 404 })
    }
    if (error instanceof OrgMergeRefusal) {
      return NextResponse.json({ error: error.message, refusals: error.refusals }, { status: 400 })
    }
    console.error('[clients/[id]/merge] failed:', error)
    return NextResponse.json({ error: 'Merge failed. Nothing further was changed.' }, { status: 500 })
  }
}
