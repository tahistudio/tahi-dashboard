import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, ne, and } from 'drizzle-orm'
import { requireContractAccess } from '@/app/api/admin/_sales-access/artifact-scope'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

function mintToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// POST /api/admin/contracts/documents/[id]/send, mint share token + flip status.
//
// Note: this does NOT trigger Resend emails. Email send is a separate
// concern (operator can paste signer URLs from the response into their
// own email, or we'll add automated send in a follow-up). The route
// returns each signer's per-signer URL.
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const url = new URL(req.url)
  const rotate = url.searchParams.get('rotate') === '1'

  const denied = await requireContractAccess(database, { userId, orgId }, id)
  if (denied) return denied

  const [doc] = await database
    .select({ id: schema.contractDocuments.id, token: schema.contractDocuments.publicShareToken, status: schema.contractDocuments.status })
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.id, id))
    .limit(1)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let token = doc.token
  const now = new Date().toISOString()
  if (!token || rotate) {
    token = mintToken()
  }

  await database.update(schema.contractDocuments).set({
    publicShareToken: token,
    publicSharedAt: now,
    status: doc.status === 'draft' ? 'sent' : doc.status,
    sentAt: doc.status === 'draft' ? now : undefined,
    updatedAt: now,
  }).where(eq(schema.contractDocuments.id, id))

  // Return signer URLs so the operator can paste them into emails.
  const signers = await database
    .select({ id: schema.contractSigners.id, name: schema.contractSigners.name, email: schema.contractSigners.email, status: schema.contractSigners.status })
    .from(schema.contractSigners)
    .where(eq(schema.contractSigners.contractId, id))

  // We don't know the public-facing host server-side, so the client
  // composes the URL using window.location.origin. Return token + signerIds.
  return NextResponse.json({
    token,
    signers: signers.map(s => ({ ...s, signPath: `/p/contract/${token}/sign/${s.id}` })),
  })
}

// DELETE, revoke: back to draft, clear token, and actually undo every
// signature rather than only resetting the document. Before this a revoke on
// a partly-signed contract left the document reading 'draft' while its
// signers still read 'signed' and its signatures still existed, chained
// under a document the UI now called unsent. Every non-pending signer goes
// back to pending, every signature this contract has is deleted, and the
// discarded signature ids are written to auditLog FIRST: once the rows are
// gone that log entry is the only forensic trail left of what got revoked.
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const denied = await requireContractAccess(database, { userId, orgId }, id)
  if (denied) return denied

  const now = new Date().toISOString()

  const discarded = await database
    .select({ id: schema.contractSignatures.id, signerId: schema.contractSignatures.signerId })
    .from(schema.contractSignatures)
    .where(eq(schema.contractSignatures.contractId, id))

  if (discarded.length > 0) {
    await database.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorId: userId,
      actorType: 'team_member',
      action: 'contract_revoked_signatures_discarded',
      entityType: 'contract',
      entityId: id,
      metadata: JSON.stringify({
        discardedSignatureIds: discarded.map(d => d.id),
        discardedSignerIds: discarded.map(d => d.signerId),
      }),
      ipAddress: null,
      createdAt: now,
    })
  }

  await database.delete(schema.contractSignatures).where(eq(schema.contractSignatures.contractId, id))

  await database.update(schema.contractSigners).set({
    status: 'pending',
    signedAt: null,
    signatureId: null,
    updatedAt: now,
  }).where(and(
    eq(schema.contractSigners.contractId, id),
    ne(schema.contractSigners.status, 'pending'),
  ))

  await database.update(schema.contractDocuments).set({
    publicShareToken: null,
    publicSharedAt: null,
    status: 'draft',
    sentAt: null,
    signedAt: null,
    finalHash: null,
    updatedAt: now,
  }).where(eq(schema.contractDocuments.id, id))

  return NextResponse.json({ success: true })
}
