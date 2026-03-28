import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc } from 'drizzle-orm'

// ── GET /api/admin/automations ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const rules = await database
    .select()
    .from(schema.automationRules)
    .orderBy(desc(schema.automationRules.createdAt))

  return NextResponse.json({ items: rules })
}

// ── POST /api/admin/automations ──────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    name?: string
    triggerEvent?: string
    conditions?: unknown[]
    actions?: unknown[]
    enabled?: boolean
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const validTriggers = [
    'request_created',
    'request_status_changed',
    'invoice_overdue',
    'client_inactive',
    'client_onboarded',
    'request_overdue',
  ]

  if (!body.triggerEvent || !validTriggers.includes(body.triggerEvent)) {
    return NextResponse.json({
      error: `Invalid trigger. Must be one of: ${validTriggers.join(', ')}`,
    }, { status: 400 })
  }

  if (!body.actions || !Array.isArray(body.actions) || body.actions.length === 0) {
    return NextResponse.json({ error: 'At least one action is required' }, { status: 400 })
  }

  const database = await db()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  await database.insert(schema.automationRules).values({
    id,
    name: body.name.trim(),
    triggerEvent: body.triggerEvent,
    conditions: JSON.stringify(body.conditions ?? []),
    actions: JSON.stringify(body.actions),
    enabled: body.enabled !== false,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id }, { status: 201 })
}
