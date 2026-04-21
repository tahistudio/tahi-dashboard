/**
 * POST /api/admin/timers/ping
 *
 * Heartbeat sent by the top-nav timer chip every 30 seconds while a
 * timer is active. Updates `lastPingAt` on the current user's active
 * timer row. If no timer exists, returns 204 silently (caller just
 * stops pinging).
 *
 * Driven by the auto-recovery flow : when the app loads, if a timer's
 * `lastPingAt` is > 2 minutes old, we prompt the user "was your timer
 * still running? Log N hours?"
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!userId) return new NextResponse(null, { status: 204 })

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [timer] = await drizzle
    .select({ id: schema.activeTimers.id })
    .from(schema.activeTimers)
    .where(eq(schema.activeTimers.userId, userId))
    .limit(1)
  if (!timer) return new NextResponse(null, { status: 204 })

  await drizzle
    .update(schema.activeTimers)
    .set({ lastPingAt: new Date().toISOString() })
    .where(eq(schema.activeTimers.id, timer.id))

  return NextResponse.json({ ok: true })
}
