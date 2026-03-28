import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// GET /api/admin/integrations/rewardful
// Returns connection status and affiliate data stub.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  const integrations = await database
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'rewardful'))
    .limit(1)

  const integration = integrations.length > 0 ? integrations[0] : null

  return NextResponse.json({
    connected: integration?.status === 'connected',
    lastSyncedAt: integration?.lastSyncedAt ?? null,
    affiliates: [],
    referrals: [],
    commissions: [],
  })
}

// POST /api/admin/integrations/rewardful
// Save Rewardful API key configuration.
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { apiKey?: string; action?: string }

  const database = await db()
  const now = new Date().toISOString()

  if (body.action === 'disconnect') {
    await database
      .update(schema.integrations)
      .set({ status: 'disconnected', accessToken: null, updatedAt: now })
      .where(eq(schema.integrations.service, 'rewardful'))

    return NextResponse.json({ success: true })
  }

  if (!body.apiKey) {
    return NextResponse.json({ error: 'apiKey is required' }, { status: 400 })
  }

  // Upsert integration record
  const existing = await database
    .select({ id: schema.integrations.id })
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'rewardful'))
    .limit(1)

  if (existing.length > 0) {
    await database
      .update(schema.integrations)
      .set({
        status: 'connected',
        accessToken: body.apiKey,
        updatedAt: now,
      })
      .where(eq(schema.integrations.id, existing[0].id))
  } else {
    await database.insert(schema.integrations).values({
      service: 'rewardful',
      status: 'connected',
      accessToken: body.apiKey,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({ success: true })
}
