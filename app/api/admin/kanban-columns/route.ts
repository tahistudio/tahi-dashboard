import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc, isNull } from 'drizzle-orm'

// GET /api/admin/kanban-columns
// Query: ?orgId=xxx - if provided, return org-specific columns (fallback to global defaults)
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // If orgId provided, try client-specific columns first
  if (filterOrgId) {
    const orgColumns = await drizzle
      .select()
      .from(schema.kanbanColumns)
      .where(eq(schema.kanbanColumns.orgId, filterOrgId))
      .orderBy(asc(schema.kanbanColumns.position))

    if (orgColumns.length > 0) {
      return NextResponse.json({ columns: orgColumns })
    }
  }

  // Return global default columns (orgId is null)
  const globalColumns = await drizzle
    .select()
    .from(schema.kanbanColumns)
    .where(isNull(schema.kanbanColumns.orgId))
    .orderBy(asc(schema.kanbanColumns.position))

  return NextResponse.json({ columns: globalColumns })
}

// POST /api/admin/kanban-columns - create column
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    orgId?: string
    label?: string
    statusValue?: string
    colour?: string
    position?: number
  }

  if (!body.label?.trim()) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }
  if (!body.statusValue?.trim()) {
    return NextResponse.json({ error: 'statusValue is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  await drizzle.insert(schema.kanbanColumns).values({
    id,
    orgId: body.orgId ?? null,
    label: body.label.trim(),
    statusValue: body.statusValue.trim(),
    colour: body.colour ?? null,
    position: body.position ?? 0,
    isDefault: 0,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
