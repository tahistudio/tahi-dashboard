import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// ── PATCH /api/admin/task-templates/[id] ──────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const body = await req.json() as {
    name?: string
    type?: string
    category?: string | null
    description?: string | null
    defaultPriority?: string
    subtasks?: string[] | null
    estimatedHours?: number | null
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify template exists
  const [existing] = await drizzle
    .select({ id: schema.taskTemplates.id })
    .from(schema.taskTemplates)
    .where(eq(schema.taskTemplates.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const updates: Record<string, unknown> = { updatedAt: now }

  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return NextResponse.json({ error: 'Template name cannot be empty' }, { status: 400 })
    }
    updates.name = body.name.trim()
  }
  if (body.type !== undefined) {
    const validTypes = ['client_task', 'internal_client_task', 'tahi_internal']
    if (!validTypes.includes(body.type)) {
      return NextResponse.json({ error: 'Invalid task type' }, { status: 400 })
    }
    updates.type = body.type
  }
  if (body.category !== undefined) updates.category = body.category
  if (body.description !== undefined) updates.description = body.description
  if (body.defaultPriority !== undefined) {
    const validPriorities = ['standard', 'high', 'urgent']
    if (!validPriorities.includes(body.defaultPriority)) {
      return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
    }
    updates.defaultPriority = body.defaultPriority
  }
  if (body.subtasks !== undefined) {
    updates.subtasks = JSON.stringify(body.subtasks ?? [])
  }
  if (body.estimatedHours !== undefined) updates.estimatedHours = body.estimatedHours

  await drizzle
    .update(schema.taskTemplates)
    .set(updates)
    .where(eq(schema.taskTemplates.id, id))

  return NextResponse.json({ success: true })
}

// ── DELETE /api/admin/task-templates/[id] ──────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Verify template exists
  const [existing] = await drizzle
    .select({ id: schema.taskTemplates.id })
    .from(schema.taskTemplates)
    .where(eq(schema.taskTemplates.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  await drizzle
    .delete(schema.taskTemplates)
    .where(eq(schema.taskTemplates.id, id))

  return NextResponse.json({ success: true })
}
