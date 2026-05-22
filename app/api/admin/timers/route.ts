/**
 * /api/admin/timers
 *
 *   GET  → current user's active timer (null if none). Includes computed
 *          elapsedSeconds + the target's title for convenience.
 *   POST → start a timer. Body : { requestId?, taskId?, orgId?, notes? }.
 *          Exactly one of requestId / taskId / orgId required.
 *          If the user already has an active timer :
 *            - without `?confirmed=true` : respond 409 with the current
 *              timer so the UI can prompt "stop that and switch?"
 *            - with `?confirmed=true` : auto-stop + log the previous
 *              timer and start the new one.
 *
 * MCP parity is handled by the `start_timer` / `get_active_timer` /
 * `stop_timer` MCP tools (Phase 2C).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { elapsedSeconds, secondsToHours, stopAndLogTimer } from '@/lib/timer-helpers'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ timer: null })

  const database = await db()
  const drizzle = database as Drizzle

  const [timer] = await drizzle
    .select()
    .from(schema.activeTimers)
    .where(eq(schema.activeTimers.userId, userId))
    .limit(1)
  if (!timer) return NextResponse.json({ timer: null })

  // Join the target title (request, task, or client).
  let targetTitle: string | null = null
  let targetType: 'request' | 'task' | 'org' = 'request'
  if (timer.requestId) {
    const [r] = await drizzle
      .select({ title: schema.requests.title, requestNumber: schema.requests.requestNumber })
      .from(schema.requests)
      .where(eq(schema.requests.id, timer.requestId))
      .limit(1)
    targetTitle = r?.title ?? null
    targetType = 'request'
  } else if (timer.taskId) {
    const [t] = await drizzle
      .select({ title: schema.tasks.title })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, timer.taskId))
      .limit(1)
    targetTitle = t?.title ?? null
    targetType = 'task'
  } else if (timer.orgId) {
    const [o] = await drizzle
      .select({ name: schema.organisations.name })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, timer.orgId))
      .limit(1)
    targetTitle = o?.name ?? null
    targetType = 'org'
  }

  const elapsed = elapsedSeconds(timer)
  return NextResponse.json({
    timer: {
      ...timer,
      targetTitle,
      targetType,
      elapsedSeconds: elapsed,
      elapsedHours: secondsToHours(elapsed),
      isPaused: !!timer.pausedAt,
    },
  })
}

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'No user' }, { status: 400 })

  const body = await req.json().catch(() => null) as {
    requestId?: string | null
    taskId?: string | null
    orgId?: string | null
    notes?: string | null
  } | null

  // Exactly one of requestId / taskId / orgId is required.
  if (!body) {
    return NextResponse.json({ error: 'Body required' }, { status: 400 })
  }
  const targetCount = [body.requestId, body.taskId, body.orgId].filter(Boolean).length
  if (targetCount !== 1) {
    return NextResponse.json({ error: 'Exactly one of requestId, taskId, or orgId required' }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const confirmed = searchParams.get('confirmed') === 'true'

  const database = await db()
  const drizzle = database as Drizzle

  // If target is a request, verify we can find it + pick orgId for the
  // eventual timeEntry. (We don't currently scope-check here because the
  // user already only has access to requests their team_member_access
  // rows permit — picking up a timer on a scoped-out request is not a
  // leak vector since the timer itself carries no request data beyond id.)
  let targetOrgId: string | null = null
  if (body.requestId) {
    const [r] = await drizzle
      .select({ orgId: schema.requests.orgId })
      .from(schema.requests)
      .where(eq(schema.requests.id, body.requestId))
      .limit(1)
    if (!r) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    targetOrgId = r.orgId
  } else if (body.taskId) {
    const [t] = await drizzle
      .select({ orgId: schema.tasks.orgId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, body.taskId))
      .limit(1)
    if (!t) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    targetOrgId = t.orgId // may be null for tahi_internal tasks
  } else if (body.orgId) {
    const [o] = await drizzle
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, body.orgId))
      .limit(1)
    if (!o) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    targetOrgId = body.orgId
  }

  // Check for existing timer.
  const [existing] = await drizzle
    .select()
    .from(schema.activeTimers)
    .where(eq(schema.activeTimers.userId, userId))
    .limit(1)

  if (existing && !confirmed) {
    return NextResponse.json({
      error: 'You already have an active timer',
      currentTimer: existing,
    }, { status: 409 })
  }

  if (existing && confirmed) {
    // Auto-stop and log the previous one.
    await stopAndLogTimer(drizzle, existing, userId, targetOrgId)
  }

  const now = new Date().toISOString()
  const newId = crypto.randomUUID()
  await drizzle.insert(schema.activeTimers).values({
    id: newId,
    userId,
    requestId: body.requestId ?? null,
    taskId: body.taskId ?? null,
    orgId: body.orgId ?? null,
    startedAt: now,
    pausedAt: null,
    pausedSeconds: 0,
    lastPingAt: now,
    notes: body.notes ?? null,
  })

  return NextResponse.json({ id: newId, startedAt: now }, { status: 201 })
}
