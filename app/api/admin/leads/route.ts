import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, like, or, and, sql } from 'drizzle-orm'
import { lookupOrCreatePerson } from '@/lib/people'

// ── GET /api/admin/leads ────────────────────────────────────────────────────
// Query params:
//   ?status=new|qualifying|nurturing|promoted|archived (default: all)
//   ?source=webflow|website|email|referral|affiliate|event|cold_outreach|manual|other
//   ?search=acme   (matches name / email / company)
//   ?owner=<teamMemberId>
//   ?page=1
//
// Returns leads ordered by updated_at desc with denormalised owner +
// promoted-deal info so the table can render in one query.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'all'
  const source = url.searchParams.get('source') ?? 'all'
  const search = url.searchParams.get('search') ?? ''
  const owner  = url.searchParams.get('owner')  ?? ''
  const page   = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  // Default 1000 so the client gets everything in one shot — pagination
  // happens client-side in DataTable. Caller can still pass ?limit= for
  // legacy paged callers (e.g. the cron's old endpoint).
  const limit  = Math.min(2000, parseInt(url.searchParams.get('limit') ?? '1000'))
  const offset = (page - 1) * limit

  const database = await db()

  const conditions = []
  if (status !== 'all') conditions.push(eq(schema.leads.status, status))
  if (source !== 'all') conditions.push(eq(schema.leads.source, source))
  if (owner) conditions.push(eq(schema.leads.ownerId, owner))
  if (search) {
    conditions.push(
      or(
        like(schema.leads.name, `%${search}%`),
        like(schema.leads.email, `%${search}%`),
        like(schema.leads.company, `%${search}%`),
      )!,
    )
  }

  const rows = await database
    .select({
      id: schema.leads.id,
      personId: schema.leads.personId,
      name: schema.leads.name,
      email: schema.leads.email,
      phone: schema.leads.phone,
      company: schema.leads.company,
      jobTitle: schema.leads.jobTitle,
      website: schema.leads.website,
      source: schema.leads.source,
      sourceDetail: schema.leads.sourceDetail,
      affiliateCode: schema.leads.affiliateCode,
      brief: schema.leads.brief,
      estimatedValue: schema.leads.estimatedValue,
      currency: schema.leads.currency,
      status: schema.leads.status,
      archiveReason: schema.leads.archiveReason,
      ownerId: schema.leads.ownerId,
      promotedDealId: schema.leads.promotedDealId,
      promotedAt: schema.leads.promotedAt,
      aiScore: schema.leads.aiScore,
      createdAt: schema.leads.createdAt,
      updatedAt: schema.leads.updatedAt,
      ownerName: schema.teamMembers.name,
      ownerAvatarUrl: schema.teamMembers.avatarUrl,
    })
    .from(schema.leads)
    .leftJoin(schema.teamMembers, eq(schema.leads.ownerId, schema.teamMembers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.leads.updatedAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ leads: rows, page, limit })
}

// ── POST /api/admin/leads ───────────────────────────────────────────────────
// Body:
//   name          (required)
//   email
//   phone
//   company
//   jobTitle
//   website
//   source        (default 'manual')
//   sourceDetail
//   affiliateCode
//   brief
//   estimatedValue
//   currency      (default 'NZD')
//   ownerId       (default: caller's team-member id, falling back to Clerk userId)
//
// Side effects:
//   - lookup-or-create the canonical person on people (matched by email)
//   - lead.person_id wired to that person
//   - status defaults to 'new'
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    name?: string
    email?: string | null
    phone?: string | null
    company?: string | null
    jobTitle?: string | null
    website?: string | null
    source?: string
    sourceDetail?: string | null
    affiliateCode?: string | null
    brief?: string | null
    estimatedValue?: number | null
    currency?: string
    ownerId?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const database = await db()

  // Resolve owner. Order of fallback:
  //   1. Explicit body.ownerId
  //   2. Caller's own team-member row (UI-created leads)
  //   3. leads.defaultLeadOwnerId setting (Webflow webhooks etc with
  //      no real caller team-member)
  let ownerId = body.ownerId ?? null
  if (!ownerId) {
    const tm = await database
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)
    if (tm.length > 0) ownerId = tm[0].id
  }
  if (!ownerId) {
    const [setting] = await database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
      .limit(1)
    const candidate = setting?.value ?? null
    if (candidate) {
      const [member] = await database
        .select({ id: schema.teamMembers.id })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.id, candidate))
        .limit(1)
      if (member) ownerId = member.id
    }
  }

  // Canonical person via lookup-or-create.
  const personId = await lookupOrCreatePerson(database, {
    fullName: body.name.trim(),
    email: body.email,
    phone: body.phone,
  })

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.leads).values({
    id,
    personId,
    name: body.name.trim(),
    email: body.email?.trim() || null,
    phone: body.phone?.trim() || null,
    company: body.company?.trim() || null,
    jobTitle: body.jobTitle?.trim() || null,
    website: body.website?.trim() || null,
    source: body.source || 'manual',
    sourceDetail: body.sourceDetail?.trim() || null,
    affiliateCode: body.affiliateCode?.trim() || null,
    brief: body.brief?.trim() || null,
    estimatedValue: body.estimatedValue ?? null,
    currency: body.currency || 'NZD',
    status: 'new',
    ownerId,
    createdAt: now,
    updatedAt: now,
  })

  // Activity row so the lead has a creation event in the unified stream.
  await database.insert(schema.activities).values({
    id: crypto.randomUUID(),
    type: 'lead_created',
    title: `Lead captured: ${body.name.trim()}`,
    description: body.brief?.trim() || null,
    leadId: id,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id, personId }, { status: 201 })
}
