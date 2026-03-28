import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc } from 'drizzle-orm'

// GET /api/admin/forms - list form templates
// Query: ?category=design&orgId=xxx
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const category = url.searchParams.get('category')
  const filterOrgId = url.searchParams.get('orgId')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const conditions = []
  if (category) {
    conditions.push(eq(schema.requestForms.category, category))
  }
  if (filterOrgId) {
    conditions.push(eq(schema.requestForms.orgId, filterOrgId))
  }

  const forms = await drizzle
    .select()
    .from(schema.requestForms)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.requestForms.updatedAt))

  // Parse questions JSON for each form
  const parsed = forms.map(f => ({
    ...f,
    questions: safeParseJson(f.questions),
  }))

  return NextResponse.json({ forms: parsed })
}

// POST /api/admin/forms - create form template
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    name?: string
    category?: string
    orgId?: string
    questions?: Array<{ id: string; type: string; label: string; required: boolean; options?: string[] }>
    isDefault?: boolean
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  await drizzle.insert(schema.requestForms).values({
    id,
    name: body.name.trim(),
    category: body.category ?? null,
    orgId: body.orgId ?? null,
    questions: JSON.stringify(body.questions ?? []),
    isDefault: body.isDefault ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}

function safeParseJson(str: string): unknown {
  try {
    return JSON.parse(str)
  } catch {
    return []
  }
}
