import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/nudge-templates
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db() as unknown as D1
  const items = await database
    .select()
    .from(schema.nudgeTemplates)
    .orderBy(desc(schema.nudgeTemplates.createdAt))

  return NextResponse.json({ items })
}

// POST /api/admin/nudge-templates
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as {
    name: string
    subject: string
    bodyHtml: string
    category?: string
    isDefault?: boolean
  }

  if (!body.name?.trim() || !body.subject?.trim() || !body.bodyHtml?.trim()) {
    return NextResponse.json({ error: 'name, subject, and bodyHtml are required' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  await database.insert(schema.nudgeTemplates).values({
    id,
    name: body.name.trim(),
    subject: body.subject.trim(),
    bodyHtml: body.bodyHtml.trim(),
    category: body.category ?? null,
    isDefault: body.isDefault ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}

// PATCH /api/admin/nudge-templates (update by id in body)
export async function PATCH(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as {
    id: string
    name?: string
    subject?: string
    bodyHtml?: string
    category?: string | null
  }

  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.subject !== undefined) updates.subject = body.subject.trim()
  if (body.bodyHtml !== undefined) updates.bodyHtml = body.bodyHtml.trim()
  if (body.category !== undefined) updates.category = body.category

  await database.update(schema.nudgeTemplates).set(updates).where(eq(schema.nudgeTemplates.id, body.id))

  return NextResponse.json({ ok: true })
}
