import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// GET /api/admin/services - list all services
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const items = await database
    .select()
    .from(schema.services)
    .orderBy(desc(schema.services.createdAt))

  return NextResponse.json({ items })
}

// POST /api/admin/services - create a service
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as {
    name?: string
    description?: string
    price?: number
    currency?: string
    isRecurring?: boolean
    recurringInterval?: string
    showInCatalog?: boolean
    category?: string
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const database = await db()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await database.insert(schema.services).values({
    id,
    name: body.name.trim(),
    description: body.description?.trim() ?? null,
    price: body.price ?? 0,
    currency: body.currency ?? 'NZD',
    isRecurring: body.isRecurring ? 1 : 0,
    recurringInterval: body.recurringInterval ?? null,
    showInCatalog: body.showInCatalog === false ? 0 : 1,
    category: body.category ?? null,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
