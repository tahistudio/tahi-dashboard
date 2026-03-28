import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

/**
 * GET /api/portal/onboarding
 * Returns the onboarding state and Loom URL for the client's org.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [org] = await drizzle
    .select({
      onboardingState: schema.organisations.onboardingState,
      onboardingLoomUrl: schema.organisations.onboardingLoomUrl,
    })
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

  return NextResponse.json({
    onboardingState: state,
    onboardingLoomUrl: org.onboardingLoomUrl ?? null,
  })
}

/**
 * PATCH /api/portal/onboarding
 * Update onboarding step completion state.
 */
export async function PATCH(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  return NextResponse.json({ success: true, onboardingState: state })
}
