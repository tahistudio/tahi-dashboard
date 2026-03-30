import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/subscriptions
 * Lists all subscriptions with org names for admin billing view.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  const rows = await database
    .select({
      id: schema.subscriptions.id,
      orgId: schema.subscriptions.orgId,
      planType: schema.subscriptions.planType,
      status: schema.subscriptions.status,
      hasPrioritySupport: schema.subscriptions.hasPrioritySupport,
      currentPeriodEnd: schema.subscriptions.currentPeriodEnd,
      orgName: schema.organisations.name,
    })
    .from(schema.subscriptions)
    .leftJoin(schema.organisations, eq(schema.subscriptions.orgId, schema.organisations.id))

  const items = rows.map(r => ({
    id: r.id,
    orgId: r.orgId,
    orgName: r.orgName ?? 'Unknown',
    planType: r.planType ?? 'none',
    status: r.status ?? 'unknown',
    hasPrioritySupport: !!r.hasPrioritySupport,
    currentPeriodEnd: r.currentPeriodEnd,
  }))

  return NextResponse.json({ items })
}
