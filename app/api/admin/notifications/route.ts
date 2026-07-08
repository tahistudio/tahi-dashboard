import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import { PREF_EVENT_TYPES, PREF_CHANNELS } from '@/lib/notification-preferences'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Design-driven event types the settings UI persists ahead of their send
 * paths (mention and weekly-digest alerts adopt the stored rows when they
 * ship). Kept local to the route so lib/notification-preferences.ts keeps
 * describing only the events the send paths resolve today.
 */
const EXTRA_TEAM_EVENT_TYPES: readonly string[] = ['mention', 'weekly_digest']

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
    EXTRA_TEAM_EVENT_TYPES.includes(u.eventType)
  return eventOk && (PREF_CHANNELS as readonly string[]).includes(u.channel)
}

/**
 * GET /api/admin/notifications
 * Returns the signed-in team member's own notification preference rows. This is
 * per-user (not workspace-global), so each team member controls their own bell,
 * email, and Slack routing. Missing rows fall back to client-side defaults.
 */
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId) || !userId) {
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
        eq(schema.notificationPreferences.userType, 'team_member'),
      ),
    )

  return NextResponse.json({ preferences: rows })
}

/**
 * PATCH /api/admin/notifications
 * Upsert one or more of the signed-in team member's per-event, per-channel
 * toggles. Body: { updates: [{ eventType, channel, enabled }] }
 */
export async function PATCH(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId) || !userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
        userType: 'team_member',
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
