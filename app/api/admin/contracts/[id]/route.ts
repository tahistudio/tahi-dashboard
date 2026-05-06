import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// GET /api/admin/contracts/documents/[id] — full detail with signers + signatures
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const [doc] = await database
    .select()
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.id, id))
    .limit(1)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [signers, signatures] = await Promise.all([
    database.select()
      .from(schema.contractSigners)
      .where(eq(schema.contractSigners.contractId, id))
      .orderBy(asc(schema.contractSigners.position)),
    database.select()
      .from(schema.contractSignatures)
      .where(eq(schema.contractSignatures.contractId, id))
      .orderBy(asc(schema.contractSignatures.signedAt)),
  ])

  return NextResponse.json({ contract: doc, signers, signatures })
}

// PATCH /api/admin/contracts/documents/[id] — partial update
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const body = await req.json() as {
    name?: string
    status?: 'draft' | 'sent' | 'partially_signed' | 'signed' | 'expired' | 'cancelled'
    bodyHtml?: string
    variableValues?: Record<string, string>
    expiresAt?: string | null
    orgId?: string | null
    dealId?: string | null
  }
  const database = await db() as unknown as D1
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() }
  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.status !== undefined) updates.status = body.status
  if (body.bodyHtml !== undefined) updates.bodyHtml = body.bodyHtml
  if (body.variableValues !== undefined) updates.variableValues = JSON.stringify(body.variableValues)
  if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.dealId !== undefined) updates.dealId = body.dealId
  await database.update(schema.contractDocuments).set(updates).where(eq(schema.contractDocuments.id, id))
  return NextResponse.json({ success: true })
}

// DELETE — cascades to signers + signatures via FK
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const database = await db() as unknown as D1
  await database.delete(schema.contractDocuments).where(eq(schema.contractDocuments.id, id))
  return NextResponse.json({ success: true })
}
