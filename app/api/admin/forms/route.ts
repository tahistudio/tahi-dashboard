import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, or, desc, isNull } from 'drizzle-orm'

const AUDIENCES = ['all_clients', 'retainer_clients', 'internal_only']

// GET /api/admin/forms - list form templates
// Query: ?category=design&orgId=xxx
//   - no orgId: global forms only (orgId IS NULL) so per-client overrides do
//     not leak into the "All clients" list
//   - orgId: that client's overrides PLUS the inherited global forms (each row
//     carries its own orgId so the UI can chip Override vs Global)
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
    conditions.push(
      or(
        eq(schema.requestForms.orgId, filterOrgId),
        isNull(schema.requestForms.orgId),
      ),
    )
  } else {
    conditions.push(isNull(schema.requestForms.orgId))
  }

  const forms = await drizzle
    .select()
    .from(schema.requestForms)
    .where(and(...conditions))
    .orderBy(desc(schema.requestForms.updatedAt))

  // Client view: overrides first, inherited global forms after (stable sort
  // preserves updatedAt ordering within each group).
  const ordered = filterOrgId
    ? [...forms].sort((a, b) => (b.orgId ? 1 : 0) - (a.orgId ? 1 : 0))
    : forms

  const parsed = ordered.map(f => ({
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
    description?: string | null
    audience?: string
    sla?: string | null
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  if (body.audience !== undefined && !AUDIENCES.includes(body.audience)) {
    return NextResponse.json({ error: 'Invalid audience' }, { status: 400 })
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
    description: body.description?.trim() || null,
    audience: body.audience ?? 'all_clients',
    sla: body.sla?.trim() || null,
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
