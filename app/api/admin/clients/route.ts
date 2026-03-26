import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, like, or, and, ne } from 'drizzle-orm'

// ── GET /api/admin/clients ──────────────────────────────────────────────────
// Query params: ?status=active&plan=maintain&search=acme&page=1
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'all'
  const plan   = url.searchParams.get('plan')   ?? 'all'
  const search = url.searchParams.get('search') ?? ''
  const page   = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit  = 50
  const offset = (page - 1) * limit

  const database = await db()

  // Build conditions
  const conditions = []
  if (status !== 'all') conditions.push(eq(schema.organisations.status, status))
  if (plan   !== 'all') conditions.push(eq(schema.organisations.planType, plan))
  if (search) {
    conditions.push(
      or(
        like(schema.organisations.name, `%${search}%`),
        like(schema.organisations.website, `%${search}%`)
      )!
    )
  }
  // Never return archived by default unless explicitly asked
  if (status !== 'archived') {
    conditions.push(ne(schema.organisations.status, 'archived'))
  }

  const orgs = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
    .select()
    .from(schema.organisations)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.organisations.createdAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ organisations: orgs, page, limit })
}

// ── POST /api/admin/clients ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    name?: string; website?: string; industry?: string; planType?: string
    primaryContactEmail?: string; primaryContactName?: string
  }
  const { name, website, industry, planType, primaryContactEmail, primaryContactName } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Client name is required' }, { status: 400 })
  }

  const database = await db()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
    .insert(schema.organisations)
    .values({
      id,
      name: name.trim(),
      website: website?.trim() || null,
      industry: industry?.trim() || null,
      planType: planType || null,
      status: 'active',
      healthStatus: 'green',
      createdAt: now,
      updatedAt: now,
    })

  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // If a primary contact email was provided, create the contact record
  if (primaryContactEmail?.trim()) {
    await drizzle.insert(schema.contacts).values({
      id: crypto.randomUUID(),
      orgId: id,
      name: primaryContactName?.trim() || primaryContactEmail.split('@')[0],
      email: primaryContactEmail.trim().toLowerCase(),
      isPrimary: true,
      createdAt: now,
      updatedAt: now,
    })
  }

  // If a retainer plan was selected, create a subscription + provision tracks
  if (planType === 'maintain' || planType === 'scale') {
    const subscriptionId = crypto.randomUUID()
    await drizzle.insert(schema.subscriptions).values({
      id: subscriptionId,
      orgId: id,
      planType,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })

    // Provision tracks: maintain = 1 small, scale = 1 small + 1 large
    const trackDefs: Array<{ type: 'small' | 'large' }> =
      planType === 'scale'
        ? [{ type: 'small' }, { type: 'large' }]
        : [{ type: 'small' }]

    for (const t of trackDefs) {
      await drizzle.insert(schema.tracks).values({
        id: crypto.randomUUID(),
        subscriptionId,
        type: t.type,
        isPriorityTrack: false,
        currentRequestId: null,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return NextResponse.json({ id }, { status: 201 })
}
