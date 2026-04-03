import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, ne, sql } from 'drizzle-orm'

// ── GET /api/portal/requests ─────────────────────────────────────────────────
// Returns requests scoped to the client's own org.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)

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

  const conditions = [eq(schema.requests.orgId, orgId)]
  if (status === 'active') {
    conditions.push(ne(schema.requests.status, 'archived'))
  } else if (status !== 'all') {
    conditions.push(eq(schema.requests.status, status))
  }
  // Clients never see internal-only requests
  conditions.push(eq(schema.requests.isInternal, false))

  const requests = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
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
  const { orgId, userId } = await getRequestAuth(req)

  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    title?: string; type?: string; category?: string; description?: string
    dueDate?: string | null; formResponses?: string
  }
  const { title, type, category, description, dueDate, formResponses } = body

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Request title is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // Atomically assign the next request number via a subquery in the INSERT
  // to avoid race conditions between concurrent request creations.
  await drizzle.run(sql`
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
      ${description ?? null},
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
