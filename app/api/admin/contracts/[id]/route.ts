import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'
import { requireArtifactAccess, requireContractAccess } from '@/app/api/admin/_sales-access/artifact-scope'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// GET /api/admin/contracts/documents/[id] — full detail with signers + signatures
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const [doc] = await database
    .select()
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.id, id))
    .limit(1)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const denied = await requireArtifactAccess(database, { userId, orgId }, doc)
  if (denied) return denied

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

// PATCH /api/admin/contracts/[id] — partial update
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
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
    leadId?: string | null
    proposalId?: string | null
  }
  const database = await db() as unknown as D1
  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { updatedAt: now }

  // Read current state so we can log link/unlink activity if dealId changes.
  const [current] = await database
    .select({
      orgId: schema.contractDocuments.orgId,
      dealId: schema.contractDocuments.dealId,
      name: schema.contractDocuments.name,
    })
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.id, id))
    .limit(1)

  const denied = await requireArtifactAccess(database, { userId, orgId }, current)
  if (denied) return denied

  // Re-linking has to land on a client the caller can also reach, so a scoped
  // member cannot move a contract into or out of an org outside their scope.
  if (body.orgId !== undefined || body.dealId !== undefined) {
    const deniedTarget = await requireArtifactAccess(database, { userId, orgId }, {
      orgId: body.orgId !== undefined ? body.orgId : current?.orgId ?? null,
      dealId: body.dealId !== undefined ? body.dealId : current?.dealId ?? null,
    })
    if (deniedTarget) return deniedTarget
  }

  if (body.name !== undefined) updates.name = body.name.trim()
  if (body.status !== undefined) updates.status = body.status
  if (body.bodyHtml !== undefined) updates.bodyHtml = body.bodyHtml
  if (body.variableValues !== undefined) updates.variableValues = JSON.stringify(body.variableValues)
  if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.dealId !== undefined) updates.dealId = body.dealId
  if (body.leadId !== undefined) updates.leadId = body.leadId
  if (body.proposalId !== undefined) updates.proposalId = body.proposalId
  await database.update(schema.contractDocuments).set(updates).where(eq(schema.contractDocuments.id, id))

  // Activity log on deal link/unlink — keeps the pipeline timeline complete.
  if (body.dealId !== undefined && current && body.dealId !== current.dealId) {
    const contractName = (body.name?.trim() ?? current.name ?? 'Contract')
    const actor = userId ?? 'system'
    if (current.dealId) {
      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: 'contract_unlinked',
        title: `Contract unlinked: ${contractName}`,
        description: null,
        dealId: current.dealId,
        createdById: actor,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      })
    }
    if (body.dealId) {
      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: 'contract_linked',
        title: `Contract linked: ${contractName}`,
        description: null,
        dealId: body.dealId,
        createdById: actor,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      })
    }
  }

  return NextResponse.json({ success: true })
}

// DELETE — cascades to signers + signatures via FK
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const denied = await requireContractAccess(database, { userId, orgId }, id)
  if (denied) return denied
  await database.delete(schema.contractDocuments).where(eq(schema.contractDocuments.id, id))
  return NextResponse.json({ success: true })
}
