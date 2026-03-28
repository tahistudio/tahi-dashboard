import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'

// -- GET /api/admin/contracts -------------------------------------------------
// Returns contracts. Filter by ?orgId= for a specific client.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  let items
  if (filterOrgId) {
    items = await drizzle
      .select()
      .from(schema.contracts)
      .where(eq(schema.contracts.orgId, filterOrgId))
      .orderBy(desc(schema.contracts.createdAt))
  } else {
    items = await drizzle
      .select()
      .from(schema.contracts)
      .orderBy(desc(schema.contracts.createdAt))
  }

  return NextResponse.json({ items })
}

// -- POST /api/admin/contracts ------------------------------------------------
// Creates a new contract.
// Body: { orgId, type, name, storageKey, status?, startDate?, expiryDate?, signatoryName?, signatoryEmail? }
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    orgId?: string
    type?: string
    name?: string
    storageKey?: string
    status?: string
    startDate?: string
    expiryDate?: string
    signatoryName?: string
    signatoryEmail?: string
  }

  if (!body.orgId || typeof body.orgId !== 'string') {
    return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  }
  if (!body.type || typeof body.type !== 'string') {
    return NextResponse.json({ error: 'type is required' }, { status: 400 })
  }
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!body.storageKey || typeof body.storageKey !== 'string') {
    return NextResponse.json({ error: 'storageKey is required' }, { status: 400 })
  }

  const validTypes = ['nda', 'sla', 'msa', 'sow', 'other']
  if (!validTypes.includes(body.type)) {
    return NextResponse.json({ error: `type must be one of: ${validTypes.join(', ')}` }, { status: 400 })
  }

  const validStatuses = ['draft', 'sent', 'signed', 'expired', 'cancelled']
  const status = body.status ?? 'draft'
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const contractId = crypto.randomUUID()
  const now = new Date().toISOString()

  await drizzle.insert(schema.contracts).values({
    id: contractId,
    orgId: body.orgId,
    type: body.type,
    name: body.name.trim(),
    storageKey: body.storageKey,
    status,
    startDate: body.startDate ?? null,
    expiryDate: body.expiryDate ?? null,
    signatoryName: body.signatoryName ?? null,
    signatoryEmail: body.signatoryEmail ?? null,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ id: contractId })
}
