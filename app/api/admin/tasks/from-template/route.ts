import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

/** Task templates carry their own six-value priority enum (none, low,
 *  medium, standard, high, urgent) while a task takes three. Mapping here is
 *  what stops a "medium" template creating a task PATCH then refuses to
 *  touch. */
const TEMPLATE_PRIORITY_ALIASES: Record<string, string> = {
  none: 'standard', low: 'standard', medium: 'standard',
  standard: 'standard', high: 'high', urgent: 'urgent',
}

// ── POST /api/admin/tasks/from-template ────────────────────────────────────
// Create a new task (and its subtasks) from a template
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    templateId?: string
    orgId?: string | null
    assigneeId?: string | null
    trackId?: string | null
  }

  const { templateId } = body

  if (!templateId?.trim()) {
    return NextResponse.json({ error: 'templateId is required' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Guarded on body.orgId being set, because requireAccessToOrg answers 404
  // for a null target and a template with no client is the studio's own.
  if (body.orgId) {
    const denied = await requireAccessToOrg(drizzle, userId, body.orgId)
    if (denied) return denied
  }

  // Load the template
  const [template] = await drizzle
    .select()
    .from(schema.taskTemplates)
    .where(eq(schema.taskTemplates.id, templateId))
    .limit(1)

  if (!template) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  // Validate orgId is provided for client-facing task types
  if (template.type !== 'tahi_internal' && !body.orgId) {
    return NextResponse.json(
      { error: 'orgId is required for client-facing task types' },
      { status: 400 }
    )
  }

  const taskId = crypto.randomUUID()
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const priority = TEMPLATE_PRIORITY_ALIASES[template.defaultPriority] ?? 'standard'

  // Create the task from template fields
  await drizzle.insert(schema.tasks).values({
    id: taskId,
    type: template.type,
    orgId: template.type === 'tahi_internal' ? null : (body.orgId ?? null),
    title: template.name,
    description: template.description ?? null,
    status: 'todo',
    priority,
    assigneeId: body.assigneeId ?? null,
    assigneeType: body.assigneeId ? 'team_member' : null,
    dueDate: null,
    createdById: userId,
    tags: '[]',
    trackId: body.trackId ?? null,
    position: null,
    requestId: null,
    createdAt: now,
    updatedAt: now,
  })

  // Create subtasks from template
  let subtaskTitles: string[] = []
  try {
    subtaskTitles = JSON.parse(template.subtasks ?? '[]') as string[]
  } catch {
    subtaskTitles = []
  }

  for (const subtaskTitle of subtaskTitles) {
    if (typeof subtaskTitle === 'string' && subtaskTitle.trim()) {
      await drizzle.insert(schema.taskSubtasks).values({
        id: crypto.randomUUID(),
        taskId,
        title: subtaskTitle.trim(),
        completed: false,
        createdAt: now,
      })
    }
  }

  return NextResponse.json({ id: taskId }, { status: 201 })
}
