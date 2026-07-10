import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, or, isNull } from 'drizzle-orm'

// Design vocabulary (none/low/medium/high/urgent) plus the legacy 'standard'
// value still present in older rows.
const VALID_PRIORITIES = ['none', 'low', 'medium', 'standard', 'high', 'urgent']

// GET /api/admin/task-templates
// Query: ?type=client_task&orgId=xxx
//   - no orgId: global templates only (orgId IS NULL)
//   - orgId: that client's templates PLUS the inherited global ones (each row
//     carries its own orgId so the UI can tell overrides from globals)
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const type = url.searchParams.get('type')
  const filterOrgId = url.searchParams.get('orgId')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const conditions = []
  if (type && type !== 'all') {
    conditions.push(eq(schema.taskTemplates.type, type))
  }
  if (filterOrgId) {
    conditions.push(
      or(
        eq(schema.taskTemplates.orgId, filterOrgId),
        isNull(schema.taskTemplates.orgId),
      ),
    )
  } else {
    conditions.push(isNull(schema.taskTemplates.orgId))
  }

  const templates = await drizzle
    .select()
    .from(schema.taskTemplates)
    .where(and(...conditions))
    .orderBy(desc(schema.taskTemplates.createdAt))

  // Client view: overrides first, inherited globals after (stable sort keeps
  // createdAt ordering within each group).
  const ordered = filterOrgId
    ? [...templates].sort((a, b) => (b.orgId ? 1 : 0) - (a.orgId ? 1 : 0))
    : templates

  // `templates` is kept as an alias for older consumers that read that key.
  return NextResponse.json({ items: ordered, templates: ordered })
}

// POST /api/admin/task-templates - create a new task template
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    name?: string
    type?: string
    category?: string | null
    description?: string | null
    defaultPriority?: string
    subtasks?: string[] | null
    estimatedHours?: number | null
    orgId?: string | null
    defaultAssignee?: string | null
  }

  const { name, type, category, description, defaultPriority, subtasks, estimatedHours } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Template name is required' }, { status: 400 })
  }
  if (!type || !['client_task', 'internal_client_task', 'tahi_internal'].includes(type)) {
    return NextResponse.json({ error: 'Invalid task type' }, { status: 400 })
  }
  if (defaultPriority !== undefined && !VALID_PRIORITIES.includes(defaultPriority)) {
    return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const id = crypto.randomUUID()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  await drizzle.insert(schema.taskTemplates).values({
    id,
    name: name.trim(),
    type,
    category: category ?? null,
    description: description ?? null,
    defaultPriority: defaultPriority ?? 'standard',
    subtasks: JSON.stringify(subtasks ?? []),
    estimatedHours: estimatedHours ?? null,
    orgId: body.orgId ?? null,
    defaultAssignee: body.defaultAssignee?.trim() || null,
    createdById: userId ?? '',
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
