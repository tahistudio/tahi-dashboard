import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq, and, desc } from 'drizzle-orm'
import { notifyAllAdmins } from '@/lib/notifications'
import { logAudit } from '@/lib/audit'
import { loadPlanCatalog } from '@/lib/plan-catalog'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface ChangeRequestBody {
  kind?: 'plan' | 'tracks'
  targetPlanId?: string
  targetTracks?: number
  note?: string
}

// ── POST /api/portal/subscription/change-request ─────────────────────────────
// A client asks to change their retainer (switch plan, or run more / fewer
// parallel tracks). Nothing mutates the subscription here - the studio
// confirms first (human-in-the-loop). The request lands as an in-app
// notification for every team member and an audit entry on the org.
// Client-admin only; admin Client-view (impersonation) is read-only.
export async function POST(req: NextRequest) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only while viewing as a client' }, { status: 403 })
  }

  const drizzle = (await db()) as unknown as D1

  // Client-admin gate (same rule as every portal write).
  const [contact] = await drizzle
    .select({ portalRole: schema.contacts.portalRole, name: schema.contacts.name })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.clerkUserId, userId)))
    .limit(1)
  if (contact?.portalRole !== 'admin') {
    return NextResponse.json({ error: 'Only workspace admins can request plan changes' }, { status: 403 })
  }

  const body = (await req.json()) as ChangeRequestBody
  const { kind, targetPlanId, note } = body
  const targetTracks = typeof body.targetTracks === 'number' ? Math.max(0, Math.floor(body.targetTracks)) : null

  if (kind !== 'plan' && kind !== 'tracks') {
    return NextResponse.json({ error: 'kind must be plan | tracks' }, { status: 400 })
  }
  if (kind === 'plan' && !targetPlanId) {
    return NextResponse.json({ error: 'targetPlanId required for a plan change' }, { status: 400 })
  }
  if (kind === 'tracks' && targetTracks === null) {
    return NextResponse.json({ error: 'targetTracks required for a track change' }, { status: 400 })
  }

  // Validate the requested plan is one we actually sell.
  let targetPlanName: string | null = null
  if (kind === 'plan') {
    const catalog = await loadPlanCatalog(drizzle)
    const plan = catalog.find((p) => p.id === targetPlanId)
    if (!plan) {
      return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })
    }
    targetPlanName = plan.name
  }

  const [org] = await drizzle
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)
  const orgName = org?.name ?? 'A client'

  const [sub] = await drizzle
    .select({ planType: schema.subscriptions.planType })
    .from(schema.subscriptions)
    .where(and(eq(schema.subscriptions.orgId, orgId), eq(schema.subscriptions.status, 'active')))
    .orderBy(desc(schema.subscriptions.createdAt))
    .limit(1)

  const summary =
    kind === 'plan'
      ? orgName + ' asked to switch to the ' + targetPlanName + ' plan'
      : orgName + ' asked to run ' + targetTracks + ' extra track' + (targetTracks === 1 ? '' : 's')

  await notifyAllAdmins(drizzle, {
    type: 'subscription_change_requested',
    title: summary,
    body:
      'Requested by ' +
      (contact.name ?? 'a workspace admin') +
      (sub ? '. Current plan: ' + sub.planType + '.' : '. No active subscription on record.') +
      (note?.trim() ? ' Note: ' + note.trim() : '') +
      ' Confirm with the client before changing anything.',
    entityType: 'organisation',
    entityId: orgId,
  })

  await logAudit(drizzle as unknown as DB, {
    action: 'subscription.change_requested',
    userId,
    userType: 'contact',
    entityType: 'organisation',
    entityId: orgId,
    metadata: {
      kind,
      targetPlanId: targetPlanId ?? null,
      targetTracks,
      note: note?.trim() || null,
      currentPlan: sub?.planType ?? null,
    },
  })

  return NextResponse.json({ ok: true })
}
