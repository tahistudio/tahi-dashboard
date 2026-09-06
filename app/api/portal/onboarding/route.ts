import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { DB } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { deriveOnboardingState } from '@/lib/onboarding-state'
import { actingIdentity, recordActingWrite, refusePreviewWrite } from '@/lib/acting-as'

/**
 * GET /api/portal/onboarding
 * Returns the onboarding state and Loom URL for the client's org.
 *
 * The stored blob is not trusted on its own. Nothing except the client's own
 * first-run panel ever writes it, and every import path seeds it with '{}', so
 * we derive the two objectively knowable steps here (has the org submitted a
 * request, is billing live) and return `firstRunEligible` so an established
 * client is never greeted as a brand new one. See lib/onboarding-state.ts.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getPortalAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [org] = await drizzle
    .select({
      onboardingState: schema.organisations.onboardingState,
      onboardingLoomUrl: schema.organisations.onboardingLoomUrl,
      createdAt: schema.organisations.createdAt,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)

  if (!org) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let stored: Record<string, boolean> = {}
  try {
    stored = JSON.parse(org.onboardingState ?? '{}') as Record<string, boolean>
  } catch {
    stored = {}
  }

  // Objective signals. Each is best effort: an unreadable table degrades to the
  // stored blob rather than failing the panel.
  let hasAnyRequest = false
  let hasDeliveredRequest = false
  try {
    const rows = await drizzle
      .select({ status: schema.requests.status })
      .from(schema.requests)
      .where(eq(schema.requests.orgId, orgId))
      .limit(200)
    hasAnyRequest = rows.length > 0
    hasDeliveredRequest = rows.some(r => r.status === 'delivered' || r.status === 'archived')
  } catch {
    // leave both false
  }

  let hasActiveSubscription = false
  try {
    const rows = await drizzle
      .select({ status: schema.subscriptions.status })
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.orgId, orgId))
      .limit(20)
    hasActiveSubscription = rows.some(r => r.status === 'active' || r.status === 'trialing')
  } catch {
    // leave false
  }

  let hasPaidInvoice = false
  try {
    const rows = await drizzle
      .select({ status: schema.invoices.status })
      .from(schema.invoices)
      .where(eq(schema.invoices.orgId, orgId))
      .limit(50)
    hasPaidInvoice = rows.some(r => r.status === 'paid')
  } catch {
    // leave false
  }

  const { state, firstRunEligible } = deriveOnboardingState(stored, {
    hasAnyRequest,
    hasDeliveredRequest,
    hasActiveSubscription,
    hasPaidInvoice,
    orgCreatedAt: org.createdAt ?? null,
  })

  return NextResponse.json({
    onboardingState: state,
    onboardingLoomUrl: org.onboardingLoomUrl ?? null,
    firstRunEligible,
  })
}

/**
 * PATCH /api/portal/onboarding
 * Update onboarding step completion state.
 */
export async function PATCH(req: NextRequest) {
  const auth = await getPortalAuth(req)
  const { orgId } = auth
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // OPEN in act mode. The onboarding blob records no actor at all, which is
  // precisely why the audit row below is not optional here: without it there
  // would be no trace that the studio ticked a client's first-run step.
  const previewDenied = refusePreviewWrite(auth, { allowActing: true })
  if (previewDenied) return previewDenied
  const acting = actingIdentity(auth)

  const body = await req.json() as { step: string; completed: boolean }
  const { step, completed } = body

  if (!step) {
    return NextResponse.json({ error: 'step is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Get current state
  const [org] = await drizzle
    .select({ onboardingState: schema.organisations.onboardingState })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)

  if (!org) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let state: Record<string, boolean> = {}
  try {
    state = JSON.parse(org.onboardingState ?? '{}') as Record<string, boolean>
  } catch {
    state = {}
  }

  state[step] = completed

  await drizzle
    .update(schema.organisations)
    .set({
      onboardingState: JSON.stringify(state),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.organisations.id, orgId))

  await recordActingWrite(drizzle as unknown as DB, acting, {
    verb: 'onboarding.step_set',
    entityType: 'organisation',
    entityId: orgId,
    route: 'PATCH /api/portal/onboarding',
    extra: { step, completed },
  })

  return NextResponse.json({ success: true, onboardingState: state })
}
