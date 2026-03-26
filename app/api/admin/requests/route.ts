import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db'
import { eq, desc, and, ne, inArray } from 'drizzle-orm'

export const runtime = 'edge'

// ── GET /api/admin/requests ─────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { orgId } = await auth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const status  = url.searchParams.get('status') ?? 'active'
  const clientId = url.searchParams.get('clientId')
  const page    = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit   = 50
  const offset  = (page - 1) * limit

  const database = await db()

  const conditions = []
  if (clientId) conditions.push(eq(schema.requests.orgId, clientId))

  if (status === 'active') {
    // "Active" = not archived
    conditions.push(ne(schema.requests.status, 'archived'))
  } else if (status !== 'all') {
    if (status === 'in_progress') {
      conditions.push(inArray(schema.requests.status, ['submitted', 'in_review', 'in_progress', 'client_review']))
    } else {
      conditions.push(eq(schema.requests.status, status))
    }
  }

  const requests = await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      type: schema.requests.type,
      category: schema.requests.category,
      title: schema.requests.title,
      status: schema.requests.status,
      priority: schema.requests.priority,
      revisionCount: schema.requests.revisionCount,
      scopeFlagged: schema.requests.scopeFlagged,
      createdAt: schema.requests.createdAt,
      updatedAt: schema.requests.updatedAt,
      deliveredAt: schema.requests.deliveredAt,
      // Join org name
      orgName: schema.organisations.name,
    })
    .from(schema.requests)
    .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.requests.updatedAt))
    .limit(limit)
    .offset(offset)

  return NextResponse.json({ requests, page, limit })
}

// ── POST /api/admin/requests ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { orgId, userId } = await auth()
  if (orgId !== process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    clientOrgId?: string; title?: string; type?: string
    category?: string; description?: string; priority?: string
  }
  const { clientOrgId, title, type, category, description, priority } = body

  if (!clientOrgId || !title?.trim()) {
    return NextResponse.json({ error: 'clientOrgId and title are required' }, { status: 400 })
  }

  const database = await db()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await (database as ReturnType<typeof import('drizzle-orm/d1').drizzle>)
    .insert(schema.requests)
    .values({
      id,
      orgId: clientOrgId,
      title: title.trim(),
      type: type ?? 'small_task',
      category: category ?? 'development',
      description: description ?? null,
      status: 'submitted',
      priority: priority ?? 'standard',
      submittedById: userId ?? null,
      isInternal: true, // admin created on behalf of client
      revisionCount: 0,
      maxRevisions: 3,
      createdAt: now,
      updatedAt: now,
    })

  return NextResponse.json({ id }, { status: 201 })
}
