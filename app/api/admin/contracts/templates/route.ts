import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/contracts/templates — list reusable templates.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const database = await db() as unknown as D1
  const items = await database
    .select()
    .from(schema.contractTemplates)
    .orderBy(desc(schema.contractTemplates.updatedAt))
  return NextResponse.json({ items })
}

// POST /api/admin/contracts/templates — create a template.
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    name?: string
    type?: string
    bodyHtml?: string
    variableDefs?: unknown
    description?: string
    isDefault?: boolean
  }

  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
  if (!body.type) return NextResponse.json({ error: 'type required' }, { status: 400 })
  if (!body.bodyHtml) return NextResponse.json({ error: 'bodyHtml required' }, { status: 400 })

  const database = await db() as unknown as D1
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await database.insert(schema.contractTemplates).values({
    id,
    name: body.name.trim(),
    type: body.type,
    bodyHtml: body.bodyHtml,
    variableDefs: body.variableDefs ? JSON.stringify(body.variableDefs) : null,
    description: body.description?.trim() ?? null,
    isDefault: body.isDefault ? 1 : 0,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })
  return NextResponse.json({ id }, { status: 201 })
}
