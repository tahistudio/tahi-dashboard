/**
 * POST /api/admin/integrations/google/discover-ga4
 *
 * Calls Google's Analytics Admin accountSummaries endpoint to list every
 * GA4 property the connected Google Workspace account has access to.
 *
 * If EXACTLY ONE property is returned, we auto-persist it as
 * `content.ga4PropertyId` so Liam doesn't have to click again. If multiple
 * are returned, the caller surfaces a selector and POSTs the chosen one
 * via `PATCH /api/admin/settings`.
 *
 * Contract:
 *   { properties: Ga4Property[], autoPersisted: boolean, ga4PropertyId: string | null }
 *
 * Errors:
 *   412 — Google Workspace not connected (caller should send Liam to
 *         Settings → Google to reauthorize with analytics.readonly scope)
 *   500 — any upstream / token failure
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { getGoogleAccessToken, listGa4Properties, GoogleNotConnectedError } from '@/lib/google'

export const dynamic = 'force-dynamic'

const SETTING_KEY = 'content.ga4PropertyId'

async function upsertSetting(database: Awaited<ReturnType<typeof db>>, key: string, value: string) {
  const now = new Date().toISOString()
  const existing = await database
    .select({ key: schema.settings.key })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1)
  if (existing.length > 0) {
    await database
      .update(schema.settings)
      .set({ value, updatedAt: now })
      .where(eq(schema.settings.key, key))
  } else {
    await database
      .insert(schema.settings)
      .values({ key, value, updatedAt: now })
  }
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const database = await db()
  let tokens
  try {
    tokens = await getGoogleAccessToken(database)
  } catch (err) {
    const status = err instanceof GoogleNotConnectedError ? 412 : 500
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status })
  }

  let properties
  try {
    properties = await listGa4Properties(tokens.accessToken)
  } catch (err) {
    // 403 from the Admin API typically means the scope is missing
    // (analytics.readonly). Surface a clear message so Liam knows to
    // reconnect.
    const message = err instanceof Error ? err.message : String(err)
    const isScopeIssue = /403|forbidden|insufficient|scope/i.test(message)
    return NextResponse.json({
      error: isScopeIssue
        ? 'Google Analytics scope missing. Reconnect Google with analytics.readonly enabled.'
        : message,
    }, { status: isScopeIssue ? 412 : 502 })
  }

  let autoPersisted = false
  let ga4PropertyId: string | null = null
  if (properties.length === 1) {
    ga4PropertyId = properties[0].propertyId
    await upsertSetting(database, SETTING_KEY, ga4PropertyId)
    autoPersisted = true
  }

  return NextResponse.json({
    properties,
    autoPersisted,
    ga4PropertyId,
  })
}
