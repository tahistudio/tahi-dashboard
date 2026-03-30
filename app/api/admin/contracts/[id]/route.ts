import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// GET /api/admin/contracts/[id]
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [contract] = await drizzle
    .select()
    .from(schema.contracts)
    .where(eq(schema.contracts.id, id))
    .limit(1)

  if (!contract) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({ contract })
}

// PUT /api/admin/contracts/[id]
export async function PUT(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as {
    name?: string
    status?: string
    type?: string
    startDate?: string | null
    expiryDate?: string | null
    signatoryName?: string | null
    signatoryEmail?: string | null
    signedStorageKey?: string | null
    signedAt?: string | null
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }

  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.status !== undefined) updates.status = body.status
  if (body.type !== undefined) updates.type = body.type
  if (body.startDate !== undefined) updates.startDate = body.startDate
  if (body.expiryDate !== undefined) updates.expiryDate = body.expiryDate
  if (body.signatoryName !== undefined) updates.signatoryName = body.signatoryName
  if (body.signatoryEmail !== undefined) updates.signatoryEmail = body.signatoryEmail
  if (body.signedStorageKey !== undefined) updates.signedStorageKey = body.signedStorageKey
  if (body.signedAt !== undefined) updates.signedAt = body.signedAt

  await drizzle
    .update(schema.contracts)
    .set(updates)
    .where(eq(schema.contracts.id, id))

  return NextResponse.json({ success: true })
}

// DELETE /api/admin/contracts/[id]
export async function DELETE(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  await drizzle
    .delete(schema.contracts)
    .where(eq(schema.contracts.id, id))

  return NextResponse.json({ success: true })
}
