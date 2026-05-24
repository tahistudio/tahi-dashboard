/**
 * GET /api/admin/integrations/google/status
 *
 * Lightweight status for the Settings page UI. Returns:
 *   {
 *     connected: boolean,
 *     email: string | null,
 *     scopes: string[],
 *     expiresAt: string | null,
 *     lastSyncedAt: string | null,
 *     errorMessage: string | null,
 *     configured: boolean  // whether GOOGLE_CLIENT_ID env var is set
 *   }
 *
 * DELETE /api/admin/integrations/google/status — disconnect (flips
 * the row to status='disconnected' and nulls tokens).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const [row] = await database
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'google_workspace'))
    .limit(1)

  const configured = !!process.env.GOOGLE_CLIENT_ID
  if (!row) {
    return NextResponse.json({
      connected: false,
      email: null,
      scopes: [],
      expiresAt: null,
      lastSyncedAt: null,
      errorMessage: null,
      configured,
    })
  }

  let config: { email?: string; scopes?: string } = {}
  try { config = JSON.parse(row.config ?? '{}') } catch { /* keep empty */ }

  return NextResponse.json({
    connected: row.status === 'connected',
    status: row.status,
    email: config.email ?? null,
    scopes: (config.scopes ?? '').split(' ').filter(Boolean),
    expiresAt: row.tokenExpiresAt,
    lastSyncedAt: row.lastSyncedAt,
    errorMessage: row.errorMessage,
    configured,
  })
}

export async function DELETE(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const database = await db()
  await database
    .update(schema.integrations)
    .set({
      status: 'disconnected',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.integrations.service, 'google_workspace'))
  return NextResponse.json({ ok: true })
}
