import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and } from 'drizzle-orm'

// ── GET /api/admin/task-templates ──────────────────────────────────────────
// List all task templates, optionally filter by type
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const type = url.searchParams.get('type')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const conditions = []
  if (type && type !== 'all') {
    conditions.push(eq(schema.taskTemplates.type, type))
  }

  const templates = await drizzle
    .select()
    .from(schema.taskTemplates)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.taskTemplates.createdAt))

  return NextResponse.json({ items: templates })
}

// ── POST /api/admin/task-templates ─────────────────────────────────────────
// Create a new task template
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
  }

  const { name, type, category, description, defaultPriority, subtasks, estimatedHours } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'Template name is required' }, { status: 400 })
  }
  if (!type || !['client_task', 'internal_client_task', 'tahi_internal'].includes(type)) {
    return NextResponse.json({ error: 'Invalid task type' }, { status: 400 })
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
    createdById: userId ?? '',
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
