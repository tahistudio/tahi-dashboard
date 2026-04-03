import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/planned-roles
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db() as unknown as D1

  const items = await database
    .select()
    .from(schema.plannedRoles)
    .orderBy(desc(schema.plannedRoles.createdAt))

  return NextResponse.json({ items })
}

// POST /api/admin/planned-roles
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    title?: string
    department?: string
    reportsToId?: string
    priority?: string
    status?: string
    description?: string
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.plannedRoles).values({
    id,
    title: body.title.trim(),
    department: body.department ?? null,
    reportsToId: body.reportsToId ?? null,
    priority: body.priority ?? 'medium',
    status: body.status ?? 'planned',
    description: body.description ?? null,
    createdAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
