/**
 * /api/admin/timers
 *
 *   GET  → current user's active timer (null if none). Includes computed
 *          elapsedSeconds + the target's title for convenience.
 *   POST → start a timer. Body : { requestId?, taskId?, orgId?, general?, notes? }.
 *          Exactly one of requestId / taskId / orgId / general required.
 *          `general` is 'request' | 'task' | 'client' (the picker tab the
 *          "None" row was clicked from) and logs against the hidden
 *          internal studio org (see lib/internal-org.ts).
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
import { elapsedSeconds, secondsToHours, stopAndLogTimer, GENERAL_KINDS, generalTimerNotes, isGeneralTimer, type GeneralKind } from '@/lib/timer-helpers'
import { ensureInternalOrg } from '@/lib/internal-org'

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
  let targetType: 'request' | 'task' | 'org' | 'general' = 'request'
  if (isGeneralTimer(timer)) {
    targetTitle = timer.notes ?? 'General time'
    targetType = 'general'
  } else if (timer.requestId) {
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
    general?: GeneralKind | null
    notes?: string | null
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Body required' }, { status: 400 })
  }
  if (body.general && !GENERAL_KINDS.includes(body.general)) {
    return NextResponse.json({ error: 'general must be request, task, or client' }, { status: 400 })
  }
  const targetCount = [body.requestId, body.taskId, body.orgId, body.general].filter(Boolean).length
  if (targetCount !== 1) {
    return NextResponse.json({ error: 'Exactly one of requestId, taskId, orgId, or general required' }, { status: 400 })
  }

  const { searchParams } = new URL(req.url)
  const confirmed = searchParams.get('confirmed') === 'true'

  const database = await db()
  const drizzle = database as Drizzle

  // Verify the target exists and derive the client the eventual timeEntry
  // belongs to, from the target row itself. (We don't currently scope-check
  // here because the user already only has access to requests their
  // team_member_access rows permit. Picking up a timer on a scoped-out
  // request is not a leak vector since the timer itself carries no request
  // data beyond id.)
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
      .select({ orgId: schema.tasks.orgId, requestId: schema.tasks.requestId })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, body.taskId))
      .limit(1)
    if (!t) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    // tahi_internal tasks carry no orgId. Fall back to the request they
    // hang off, then to the hidden internal studio org, so the hours
    // survive the stop instead of being dropped for want of a client.
    targetOrgId = t.orgId
    if (!targetOrgId && t.requestId) {
      const [r] = await drizzle
        .select({ orgId: schema.requests.orgId })
        .from(schema.requests)
        .where(eq(schema.requests.id, t.requestId))
        .limit(1)
      targetOrgId = r?.orgId ?? null
    }
    if (!targetOrgId) targetOrgId = await ensureInternalOrg(drizzle)
  } else if (body.orgId) {
    const [o] = await drizzle
      .select({ id: schema.organisations.id })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, body.orgId))
      .limit(1)
    if (!o) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    targetOrgId = body.orgId
  } else if (body.general) {
    targetOrgId = await ensureInternalOrg(drizzle)
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

  // Auto-stop and log the previous one. It resolves its own client from
  // its own target row: handing it the new target's org filed client A's
  // hours against client B every time you switched timers.
  let stopped: Awaited<ReturnType<typeof stopAndLogTimer>> | null = null
  if (existing && confirmed) {
    stopped = await stopAndLogTimer(drizzle, existing, userId)
  }

  const now = new Date().toISOString()
  const newId = crypto.randomUUID()
  try {
    await drizzle.insert(schema.activeTimers).values({
      id: newId,
      userId,
      requestId: body.requestId ?? null,
      taskId: body.taskId ?? null,
      // Always carry the client, whatever the target kind was. Task and
      // request timers used to persist null here, so stopping one had no
      // client to file the hours against and threw them away.
      orgId: targetOrgId,
      startedAt: now,
      pausedAt: null,
      pausedSeconds: 0,
      lastPingAt: now,
      notes: body.general ? generalTimerNotes(body.general) : (body.notes ?? null),
    })
  } catch (err) {
    // Surface the underlying SQL / Drizzle error so the client toast
    // can show something useful instead of a bare "500". Common
    // failure modes: schema drift in D1 (a column from the latest
    // migration hasn't been applied), or an FK violation.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[timers POST] insert failed:', message)
    return NextResponse.json(
      { error: `Could not start timer: ${message}` },
      { status: 500 },
    )
  }

  // `stopped` reports what happened to the timer we replaced, including
  // logged:false with a reason, so switching timers cannot silently eat
  // the hours you had already tracked.
  return NextResponse.json({ id: newId, startedAt: now, stopped }, { status: 201 })
}
