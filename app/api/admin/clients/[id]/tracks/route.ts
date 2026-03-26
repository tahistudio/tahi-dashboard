import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/clients/[id]/tracks ───────────────────────────────────────
// Returns all tracks for a client org (via their active subscription).
export async function GET(_req: NextRequest, { params }: Params) {
  const { orgId } = await auth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: clientOrgId } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Find active subscription for this org
  const [sub] = await drizzle
    .select({ id: schema.subscriptions.id, planType: schema.subscriptions.planType })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.orgId, clientOrgId))
    .orderBy(schema.subscriptions.createdAt)
    .limit(1)

  if (!sub) {
    return NextResponse.json({ tracks: [], subscriptionId: null })
  }

  // Get tracks with current request info
  const tracks = await drizzle
    .select({
      id: schema.tracks.id,
      type: schema.tracks.type,
      isPriorityTrack: schema.tracks.isPriorityTrack,
      currentRequestId: schema.tracks.currentRequestId,
      currentRequestTitle: schema.requests.title,
    })
    .from(schema.tracks)
    .leftJoin(schema.requests, eq(schema.tracks.currentRequestId, schema.requests.id))
    .where(eq(schema.tracks.subscriptionId, sub.id))

  return NextResponse.json({ tracks, subscriptionId: sub.id, planType: sub.planType })
}

// ── POST /api/admin/clients/[id]/tracks ──────────────────────────────────────
// Provision tracks for a subscription (called when a plan is assigned).
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await auth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id: clientOrgId } = await params
  const body = await req.json() as {
    subscriptionId: string
    planType: 'maintain' | 'scale'
    hasPrioritySupport?: boolean
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Determine track allocation based on plan
  // maintain: 1 small | scale: 1 small + 1 large
  // priority support adds 1 more small track
  const tracks: Array<{ type: 'small' | 'large'; isPriorityTrack: boolean }> = []

  if (body.planType === 'maintain') {
    tracks.push({ type: 'small', isPriorityTrack: false })
    if (body.hasPrioritySupport) tracks.push({ type: 'small', isPriorityTrack: true })
  } else if (body.planType === 'scale') {
    tracks.push({ type: 'small', isPriorityTrack: false })
    tracks.push({ type: 'large', isPriorityTrack: false })
    if (body.hasPrioritySupport) tracks.push({ type: 'small', isPriorityTrack: true })
  }

  const now = new Date().toISOString()
  const inserted = await Promise.all(
    tracks.map(t =>
      drizzle.insert(schema.tracks).values({
        id: crypto.randomUUID(),
        subscriptionId: body.subscriptionId,
        type: t.type,
        isPriorityTrack: t.isPriorityTrack,
        currentRequestId: null,
        createdAt: now,
        updatedAt: now,
      })
    )
  )

  void (clientOrgId) // suppress unused warning
  return NextResponse.json({ created: inserted.length }, { status: 201 })
}
