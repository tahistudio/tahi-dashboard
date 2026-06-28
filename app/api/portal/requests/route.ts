import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, ne, sql, inArray } from 'drizzle-orm'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'

// ── GET /api/portal/requests ─────────────────────────────────────────────────
// Returns requests scoped to the client's own org.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)

  // Deny if not authenticated or if this is the Tahi admin org (admins use /api/admin/requests)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status = url.searchParams.get('status') ?? 'active'
  const page   = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit  = 50
  const offset = (page - 1) * limit

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Brand portal scoping (T352): if the contact is linked to specific brands,
  // only show requests for those brands
  const [contact] = await drizzle
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(eq(schema.contacts.clerkUserId, userId))
    .limit(1)

  let brandIds: string[] | null = null
  if (contact) {
    const brandLinks = await drizzle
      .select({ brandId: schema.brandContacts.brandId })
      .from(schema.brandContacts)
      .where(eq(schema.brandContacts.contactId, contact.id))

    if (brandLinks.length > 0) {
      brandIds = brandLinks.map(b => b.brandId)
    }
  }

  const conditions = [eq(schema.requests.orgId, orgId)]

  // If contact is linked to brands, scope requests to those brands
  if (brandIds !== null) {
    conditions.push(inArray(schema.requests.brandId, brandIds))
  }
  if (status === 'active') {
    conditions.push(ne(schema.requests.status, 'archived'))
  } else if (status !== 'all') {
    conditions.push(eq(schema.requests.status, status))
  }
  // Clients never see internal-only requests
  conditions.push(eq(schema.requests.isInternal, false))

  const requests = await drizzle
    .select({
      id: schema.requests.id,
      type: schema.requests.type,
      category: schema.requests.category,
      title: schema.requests.title,
      status: schema.requests.status,
      priority: schema.requests.priority,
      estimatedHours: schema.requests.estimatedHours,
      startDate: schema.requests.startDate,
      dueDate: schema.requests.dueDate,
      scopeFlagged: schema.requests.scopeFlagged,
      revisionCount: schema.requests.revisionCount,
      createdAt: schema.requests.createdAt,
      updatedAt: schema.requests.updatedAt,
      deliveredAt: schema.requests.deliveredAt,
      requestNumber: schema.requests.requestNumber,
    })
    .from(schema.requests)
    .where(and(...conditions))
    .orderBy(desc(schema.requests.updatedAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ requests, page, limit })
}

// ── POST /api/portal/requests ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // getPortalAuth resolves the caller's Clerk org -> the D1 organisations.id, so
  // the row is written under the correct tenant id (getRequestAuth would store
  // the raw Clerk org id, which mismatches every clerkOrgId-provisioned client).
  const { orgId, userId, impersonating } = await getPortalAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const body = await req.json() as {
    title?: string; type?: string; category?: string; description?: string
    dueDate?: string | null; formResponses?: string
  }
  const { title, type, category, description, dueDate, formResponses } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Request title is required' }, { status: 400 })
  }

  // Client-submitted rich text is rendered to Tahi admins via
  // dangerouslySetInnerHTML, so sanitise it server-side at this untrusted
  // boundary (allowlist; strips scripts / event handlers / unsafe hrefs).
  const safeDescription = description ? sanitizeRichText(description) : null

  const database2 = await db()
  const drizzle2 = database2 as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Atomically assign the next request number via a subquery in the INSERT
  // to avoid race conditions between concurrent request creations.
  await drizzle2.run(sql`
    INSERT INTO requests (
      id, org_id, title, type, category, description, due_date, form_responses,
      status, priority, submitted_by_id, is_internal,
      revision_count, max_revisions, request_number, created_at, updated_at
    ) VALUES (
      ${id},
      ${orgId},
      ${title.trim()},
      ${type ?? 'small_task'},
      ${category ?? 'development'},
      ${safeDescription},
      ${dueDate ?? null},
      ${formResponses ?? null},
      'submitted',
      'standard',
      ${userId},
      0,
      0,
      3,
      COALESCE((SELECT MAX(request_number) FROM requests), 0) + 1,
      ${now},
      ${now}
    )
  `)

  return NextResponse.json({ id }, { status: 201 })
}
