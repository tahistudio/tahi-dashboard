import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc } from 'drizzle-orm'
import { isContractPastExpiry, isMarkedSigned } from '@/lib/contract-signing-state'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ token: string }> }

/**
 * GET /api/public/contracts/[token]
 * Public read of contract document + signers + signatures (sans audit data).
 * Used by the public sign page.
 *
 * A contract past its signing deadline answers 410 with reason 'expired'
 * here, on the read, so the viewer shows the expired state before any
 * signature pad renders. It used to answer 200 until the status itself said
 * 'expired', which only the sign route writes, so a client on a lapsed link
 * drew a signature, submitted it, and only then heard it had expired.
 *
 * The status is not flipped here. A GET stays free of side effects (link
 * unfurlers and prefetchers call it too), and a row still reading 'sent'
 * keeps its expiry date editable in the admin, so the studio can extend it
 * and the same link works again. The sign route still refuses a lapsed
 * contract and still writes 'expired' lazily, on the first attempt.
 */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const database = await db() as unknown as D1
  const [doc] = await database
    .select({
      id: schema.contractDocuments.id,
      orgId: schema.contractDocuments.orgId,
      type: schema.contractDocuments.type,
      name: schema.contractDocuments.name,
      status: schema.contractDocuments.status,
      bodyHtml: schema.contractDocuments.bodyHtml,
      sentAt: schema.contractDocuments.sentAt,
      signedAt: schema.contractDocuments.signedAt,
      expiresAt: schema.contractDocuments.expiresAt,
      finalHash: schema.contractDocuments.finalHash,
    })
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.publicShareToken, token))
    .limit(1)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status === 'cancelled') {
    return NextResponse.json(
      { error: 'This contract is no longer active.', reason: 'cancelled' },
      { status: 410 },
    )
  }
  if (isContractPastExpiry(doc.status, doc.expiresAt)) {
    // The viewer prints expiresAt as the deadline that lapsed, so it goes out
    // only once it has actually passed. A row set to 'expired' by hand (admin
    // PATCH or MCP update_contract) can still carry a future date.
    const deadline = doc.expiresAt ? Date.parse(doc.expiresAt) : Number.NaN
    const lapsedOn = Number.isFinite(deadline) && deadline < Date.now() ? doc.expiresAt : null
    return NextResponse.json(
      { error: 'This contract has expired.', reason: 'expired', expiresAt: lapsedOn },
      { status: 410 },
    )
  }

  const signers = await database
    .select({
      id: schema.contractSigners.id,
      role: schema.contractSigners.role,
      name: schema.contractSigners.name,
      email: schema.contractSigners.email,
      position: schema.contractSigners.position,
      status: schema.contractSigners.status,
      signedAt: schema.contractSigners.signedAt,
    })
    .from(schema.contractSigners)
    .where(eq(schema.contractSigners.contractId, doc.id))
    .orderBy(asc(schema.contractSigners.position))

  // Surface the signature data URL so the public page can render the
  // visual sigs of those who've already signed. Audit metadata stays internal.
  const signatures = await database
    .select({
      id: schema.contractSignatures.id,
      signerId: schema.contractSignatures.signerId,
      signatureDataUrl: schema.contractSignatures.signatureDataUrl,
      signedAt: schema.contractSignatures.signedAt,
    })
    .from(schema.contractSignatures)
    .where(eq(schema.contractSignatures.contractId, doc.id))
    .orderBy(asc(schema.contractSignatures.signedAt))

  // The final hash stays server-side; the viewer only needs to know whether
  // 'signed' came from the signatures below or from the studio marking it
  // (lib/contract-signing-state.ts), so it never implies a signing it has
  // no record of.
  const { finalHash, ...contract } = doc
  return NextResponse.json({
    contract: { ...contract, markedSigned: isMarkedSigned({ status: doc.status, finalHash }) },
    signers,
    signatures,
  })
}
