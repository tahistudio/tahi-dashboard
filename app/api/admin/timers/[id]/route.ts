/**
 * /api/admin/timers/[id]
 *
 *   PATCH  → mutate the timer. Body can include :
 *            { action: 'pause' | 'resume' | 'edit' }
 *            For 'edit' : { startedAt?, notes? } — used when the user
 *            adjusts the start time ("actually I started 15 min ago").
 *   DELETE → stop the timer. Query `?action=log` creates a timeEntry,
 *            `?action=discard` just removes the active timer row.
 *
 * A timer can only be mutated by its owner (userId).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { stopAndLogTimer } from '../route'

type Params = { params: Promise<{ id: string }> }
type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'No user' }, { status: 400 })

  const { id } = await params
  const body = await req.json().catch(() => null) as {
    action?: 'pause' | 'resume' | 'edit'
    startedAt?: string
    notes?: string | null
  } | null
  if (!body?.action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  const database = await db()
  const drizzle = database as Drizzle

  const [timer] = await drizzle
    .select()
    .from(schema.activeTimers)
    .where(and(eq(schema.activeTimers.id, id), eq(schema.activeTimers.userId, userId)))
    .limit(1)
  if (!timer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const now = new Date()
  const nowIso = now.toISOString()

  if (body.action === 'pause') {
    if (timer.pausedAt) return NextResponse.json({ error: 'Already paused' }, { status: 400 })
    await drizzle
      .update(schema.activeTimers)
      .set({ pausedAt: nowIso, lastPingAt: nowIso })
      .where(eq(schema.activeTimers.id, id))
    return NextResponse.json({ ok: true, pausedAt: nowIso })
  }

  if (body.action === 'resume') {
    if (!timer.pausedAt) return NextResponse.json({ error: 'Not paused' }, { status: 400 })
    const pausedDurationSec = Math.max(0, Math.floor((now.getTime() - new Date(timer.pausedAt).getTime()) / 1000))
    await drizzle
      .update(schema.activeTimers)
      .set({
        pausedAt: null,
        pausedSeconds: (timer.pausedSeconds ?? 0) + pausedDurationSec,
        lastPingAt: nowIso,
      })
      .where(eq(schema.activeTimers.id, id))
    return NextResponse.json({ ok: true, resumedAt: nowIso })
  }

  if (body.action === 'edit') {
    const patch: Record<string, unknown> = { lastPingAt: nowIso }
    if (body.startedAt) {
      const newStart = new Date(body.startedAt)
      if (Number.isNaN(newStart.getTime())) return NextResponse.json({ error: 'Invalid startedAt' }, { status: 400 })
      if (newStart.getTime() > now.getTime()) return NextResponse.json({ error: 'Cannot start in the future' }, { status: 400 })
      patch.startedAt = newStart.toISOString()
    }
    if ('notes' in body) patch.notes = body.notes
    await drizzle.update(schema.activeTimers).set(patch).where(eq(schema.activeTimers.id, id))
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return NextResponse.json({ error: 'No user' }, { status: 400 })

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action') || 'log'

  const database = await db()
  const drizzle = database as Drizzle

  const [timer] = await drizzle
    .select()
    .from(schema.activeTimers)
    .where(and(eq(schema.activeTimers.id, id), eq(schema.activeTimers.userId, userId)))
    .limit(1)
  if (!timer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (action === 'discard') {
    await drizzle.delete(schema.activeTimers).where(eq(schema.activeTimers.id, id))
    return NextResponse.json({ ok: true, logged: false })
  }

  // Default: log + stop
  const result = await stopAndLogTimer(drizzle, timer, userId, null)
  return NextResponse.json({ ok: true, logged: true, ...result })
}
