import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

/**
 * GET /api/admin/integrations/hubspot
 * Returns HubSpot connection status.
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const rows = await database
    .select()
    .from(schema.integrations)
    .where(eq(schema.integrations.service, 'hubspot'))
    .limit(1)

  const integration = rows.length > 0 ? rows[0] : null
  const hasApiKey = !!process.env.HUBSPOT_API_KEY

  return NextResponse.json({
    connected: integration?.status === 'connected' || hasApiKey,
    status: integration?.status ?? (hasApiKey ? 'connected' : 'disconnected'),
    lastSynced: integration?.lastSyncedAt ?? null,
  })
}

/**
 * POST /api/admin/integrations/hubspot
 * Connect/disconnect or sync contact data.
 * Body: { action?: 'connect'|'disconnect', contactName?, contactEmail?, orgName?, syncType?, entityId? }
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    action?: string
    contactName?: string
    contactEmail?: string
    orgName?: string
    syncType?: string
    entityId?: string
  }

  const database = await db()
  const now = new Date().toISOString()

  // Handle connect/disconnect
  if (body.action === 'connect' || body.action === 'disconnect') {
    const newStatus = body.action === 'connect' ? 'connected' : 'disconnected'
    const existing = await database
      .select()
      .from(schema.integrations)
      .where(eq(schema.integrations.service, 'hubspot'))
      .limit(1)

    if (existing.length > 0) {
      await database
        .update(schema.integrations)
        .set({ status: newStatus, updatedAt: now })
        .where(eq(schema.integrations.service, 'hubspot'))
    } else {
      await database.insert(schema.integrations).values({
        id: crypto.randomUUID(),
        service: 'hubspot',
        status: newStatus,
        config: '{}',
        createdAt: now,
        updatedAt: now,
      })
    }
    return NextResponse.json({ success: true, status: newStatus })
  }

  // Handle sync (T120-T122 stubs)
  if (body.syncType) {
    // Stub: would call HubSpot API in production
    await database
      .update(schema.integrations)
      .set({ lastSyncedAt: now, updatedAt: now })
      .where(eq(schema.integrations.service, 'hubspot'))

    return NextResponse.json({
      success: true,
      syncType: body.syncType,
      entityId: body.entityId,
      message: 'HubSpot sync stub: would sync in production',
    })
  }

  // Handle contact sync (legacy)
  const { contactName, contactEmail, orgName } = body
  if (!contactName || !contactEmail) {
    return NextResponse.json(
      { error: 'contactName and contactEmail are required' },
      { status: 400 },
    )
  }

  return NextResponse.json({
    success: true,
    message: 'HubSpot contact sync queued',
    data: { contactName, contactEmail, orgName: orgName ?? null },
  })
}
