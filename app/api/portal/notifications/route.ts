import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { PREF_EVENT_TYPES } from '@/lib/notification-preferences'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Clients may set their own in-app and email preferences. Slack is a
// workspace/team channel and is not offered to portal users.
const PORTAL_CHANNELS: readonly string[] = ['in_app', 'email']

/**
 * Design-driven event types the portal settings UI persists ahead of their
 * send paths (delivery-ready and weekly-summary alerts adopt the stored rows
 * when they ship). Kept local to the route so lib/notification-preferences.ts
 * keeps describing only the events the send paths resolve today.
 */
const EXTRA_CLIENT_EVENT_TYPES: readonly string[] = ['delivery_ready', 'weekly_summary']

/**
 * Per-user quiet-hours flag, stored as a single row with the wildcard
 * channel '*'. Enabled means "hold non-urgent notifications overnight".
 */
const QUIET_EVENT = 'quiet_hours'

interface PrefUpdate {
  eventType: string
  channel: string
  enabled: boolean
}

function isValidUpdate(u: PrefUpdate): boolean {
  if (typeof u.enabled !== 'boolean') return false
  if (u.eventType === QUIET_EVENT) return u.channel === '*'
  const eventOk =
    (PREF_EVENT_TYPES as readonly string[]).includes(u.eventType) ||
    EXTRA_CLIENT_EVENT_TYPES.includes(u.eventType)
  return eventOk && PORTAL_CHANNELS.includes(u.channel)
}

/**
 * GET /api/portal/notifications
 * Returns the signed-in contact's stored notification preference rows. Missing
 * rows fall back to the defaults applied client-side, so an empty list is the
 * honest "everything at default" state.
 */
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as Drizzle

  const rows = await drizzle
    .select({
      eventType: schema.notificationPreferences.eventType,
      channel: schema.notificationPreferences.channel,
      enabled: schema.notificationPreferences.enabled,
    })
    .from(schema.notificationPreferences)
    .where(
      and(
        eq(schema.notificationPreferences.userId, userId),
        eq(schema.notificationPreferences.userType, 'contact'),
      ),
    )

  return NextResponse.json({ preferences: rows })
}

/**
 * PATCH /api/portal/notifications
 * Upsert one or more of the signed-in contact's per-event, per-channel toggles.
 * Body: { updates: [{ eventType, channel, enabled }] }
 */
export async function PATCH(req: NextRequest) {
  const { orgId, userId, impersonating } = await getPortalAuth(req)
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (impersonating) {
    return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
  }

  const body = (await req.json()) as { updates?: PrefUpdate[] }
  const updates = Array.isArray(body.updates) ? body.updates : []
  const valid = updates.filter(isValidUpdate)

  if (valid.length === 0) {
    return NextResponse.json({ error: 'No valid updates' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as Drizzle
  const now = new Date().toISOString()

  for (const u of valid) {
    await drizzle
      .insert(schema.notificationPreferences)
      .values({
        id: crypto.randomUUID(),
        userId,
        userType: 'contact',
        eventType: u.eventType,
        channel: u.channel,
        enabled: u.enabled,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          schema.notificationPreferences.userId,
          schema.notificationPreferences.userType,
          schema.notificationPreferences.eventType,
          schema.notificationPreferences.channel,
        ],
        set: { enabled: u.enabled, updatedAt: now },
      })
  }

  return NextResponse.json({ success: true })
}
