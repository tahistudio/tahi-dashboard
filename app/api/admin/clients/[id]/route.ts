import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, sql } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/clients/[id] ──────────────────────────────────────────────
// Returns full client profile: org + contacts + subscription + tracks + recent requests
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping: check the team member can see this specific org
  const denied = await requireAccessToOrg(drizzle, userId, id)
  if (denied) return denied

  const [org] = await drizzle
    .select()
    .from(schema.organisations)
    .where(eq(schema.organisations.id, id))
    .limit(1)

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Append customMrr via raw SQL (column may not exist before migration 0011)
  let customMrr: number | null = null
  try {
    const mrrRows = await drizzle.all<{ custom_mrr: number | null }>(
      sql`SELECT custom_mrr FROM organisations WHERE id = ${id} LIMIT 1`
    )
    customMrr = mrrRows?.[0]?.custom_mrr ?? null
  } catch {
    // Column doesn't exist yet
  }

  const [contacts, subscription, recentRequests] = await Promise.all([
    drizzle
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, id)),

    drizzle
      .select()
      .from(schema.subscriptions)
      .where(and(
        eq(schema.subscriptions.orgId, id),
        eq(schema.subscriptions.status, 'active'),
      ))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(1)
      .then(rows => rows[0] ?? null),

    drizzle
      .select({
        id: schema.requests.id,
        title: schema.requests.title,
        status: schema.requests.status,
        type: schema.requests.type,
        priority: schema.requests.priority,
        updatedAt: schema.requests.updatedAt,
        createdAt: schema.requests.createdAt,
      })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.orgId, id),
        eq(schema.requests.isInternal, false),
      ))
      .orderBy(desc(schema.requests.updatedAt))
      .limit(10),
  ])

  // Get tracks if subscription exists
  let tracks: unknown[] = []
  if (subscription) {
    tracks = await drizzle
      .select({
        id: schema.tracks.id,
        type: schema.tracks.type,
        isPriorityTrack: schema.tracks.isPriorityTrack,
        currentRequestId: schema.tracks.currentRequestId,
        currentRequestTitle: schema.requests.title,
      })
      .from(schema.tracks)
      .leftJoin(schema.requests, eq(schema.tracks.currentRequestId, schema.requests.id))
      .where(eq(schema.tracks.subscriptionId, subscription.id))
  }

  return NextResponse.json({ org: { ...org, customMrr: customMrr }, contacts, subscription, tracks, recentRequests })
}

// ── PATCH /api/admin/clients/[id] ────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as Partial<{
    name: string
    website: string
    industry: string
    planType: string
    status: string
    healthStatus: string
    healthNote: string
    internalNotes: string
    brands: string
    customFields: string
    defaultHourlyRate: number | null
    size: string | null
    annualRevenue: number | null
    customMrr: number | null
  }>

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }
  const allowed = [
    'name', 'website', 'industry', 'planType', 'status',
    'healthStatus', 'healthNote', 'internalNotes', 'brands',
    'customFields', 'defaultHourlyRate', 'size', 'annualRevenue',
  ] as const
  for (const key of allowed) {
    if (key in body) patch[key] = body[key] ?? null
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping
  const denied = await requireAccessToOrg(drizzle, userId, id)
  if (denied) return denied

  await drizzle
    .update(schema.organisations)
    .set(patch)
    .where(eq(schema.organisations.id, id))

  // Handle customMrr separately via raw SQL (column may not exist before migration 0011)
  if ('customMrr' in body) {
    try {
      const mrrValue = body.customMrr ?? null
      await drizzle.run(
        sql`UPDATE organisations SET custom_mrr = ${mrrValue} WHERE id = ${id}`
      )
    } catch {
      // Column doesn't exist yet, silently skip
    }
  }

  return NextResponse.json({ success: true })
}
