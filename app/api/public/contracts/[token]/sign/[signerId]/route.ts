import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { sendFullySignedContractEmails } from '@/lib/contract-fully-signed-emails'
import { sha256Hex, computeChainHash } from '@/lib/contract-chain'
import { notifyStudioOfContractSignature } from '@/lib/contract-signature-notify'
import { isContractPastExpiry } from '@/lib/contract-signing-state'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ token: string; signerId: string }> }

async function hashIp(ip: string | null): Promise<string | null> {
  if (!ip) return null
  const salt = process.env.ENCRYPTION_KEY ?? ''
  return sha256Hex(`${ip}|${salt}`)
}

/**
 * POST /api/public/contracts/[token]/sign/[signerId]
 * Records a signature with tamper-evident hash chain.
 *
 * Hash chain rule (lib/contract-chain.ts):
 *   chainHash = sha256(prevChainHash || signerId || signatureDataUrl || timestamp || bodyHash)
 *
 * Where prevChainHash is the chainHash of the most recent existing signature on
 * this contract, or '' if this is the first signature, and bodyHash is
 * sha256(contract body) at the moment of THIS signature. Tampering with any
 * earlier signature breaks every later chainHash (recomputable to verify), and
 * editing the contract body after signing is independently detectable by
 * re-hashing the current body and comparing it against the bodyHash stored on
 * each signature.
 *
 * When this is the final pending signer, the contract status flips to 'signed'
 * and finalHash is recorded. Every signature, partial or final, notifies the
 * studio (lib/contract-signature-notify.ts).
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { token, signerId } = await ctx.params
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: { signatureDataUrl?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const sigUrl = body.signatureDataUrl
  if (typeof sigUrl !== 'string' || !sigUrl.startsWith('data:image/')) {
    return NextResponse.json({ error: 'signatureDataUrl must be a data URL' }, { status: 400 })
  }
  if (sigUrl.length > 200_000) {
    return NextResponse.json({ error: 'Signature too large' }, { status: 413 })
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  // Validate token + status. Reject if revoked or already signed.
  const [doc] = await database
    .select({
      id: schema.contractDocuments.id,
      status: schema.contractDocuments.status,
      expiresAt: schema.contractDocuments.expiresAt,
      dealId: schema.contractDocuments.dealId,
      orgId: schema.contractDocuments.orgId,
      name: schema.contractDocuments.name,
      type: schema.contractDocuments.type,
      bodyHtml: schema.contractDocuments.bodyHtml,
    })
    .from(schema.contractDocuments)
    .where(eq(schema.contractDocuments.publicShareToken, token))
    .limit(1)
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status === 'cancelled' || doc.status === 'expired') {
    return NextResponse.json({ error: 'This contract is no longer active.' }, { status: 410 })
  }
  if (doc.status === 'signed') {
    return NextResponse.json({ error: 'This contract is already fully signed.' }, { status: 409 })
  }
  // Same rule the read route applies (lib/contract-signing-state.ts), so the
  // viewer never offers a pad this route would refuse. The read route leaves
  // the row alone; this write is where the status actually flips.
  if (isContractPastExpiry(doc.status, doc.expiresAt)) {
    await database.update(schema.contractDocuments)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(schema.contractDocuments.id, doc.id))
    return NextResponse.json({ error: 'This contract has expired.' }, { status: 410 })
  }

  // Verify signer belongs to this contract + still pending.
  const [signer] = await database
    .select({
      id: schema.contractSigners.id,
      status: schema.contractSigners.status,
      role: schema.contractSigners.role,
      name: schema.contractSigners.name,
      email: schema.contractSigners.email,
    })
    .from(schema.contractSigners)
    .where(and(
      eq(schema.contractSigners.id, signerId),
      eq(schema.contractSigners.contractId, doc.id),
    ))
    .limit(1)
  if (!signer) return NextResponse.json({ error: 'Invalid signer' }, { status: 404 })
  if (signer.status === 'signed') {
    return NextResponse.json({ error: 'You have already signed this contract.' }, { status: 409 })
  }
  if (signer.status === 'skipped') {
    return NextResponse.json({ error: 'This signer was removed from the contract.' }, { status: 409 })
  }

  // Compute chain: pull most recent prior signature for this contract.
  const prior = await database
    .select({ chainHash: schema.contractSignatures.chainHash })
    .from(schema.contractSignatures)
    .where(eq(schema.contractSignatures.contractId, doc.id))
    .orderBy(asc(schema.contractSignatures.signedAt))
  const prevChainHash = prior.length ? prior[prior.length - 1].chainHash : ''
  // The body hash anchors this signature to the exact body it was taken
  // against: fold it into the chain input and store it on the row (migration
  // 0099) so a body edit after signing is independently detectable via
  // lib/contract-chain.ts#bodyMatchesSignedHash, not just implied by the
  // chain no longer matching.
  const bodyHash = await sha256Hex(doc.bodyHtml)
  const chainHash = await computeChainHash({
    prevChainHash,
    signerId,
    signatureDataUrl: sigUrl,
    timestamp: now,
    bodyHash,
  })

  // Audit metadata
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')
  const country = req.headers.get('cf-ipcountry')
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 200) || null
  const ipHash = await hashIp(ip)

  // Insert signature row
  const sigId = crypto.randomUUID()
  await database.insert(schema.contractSignatures).values({
    id: sigId,
    contractId: doc.id,
    signerId,
    signatureDataUrl: sigUrl,
    ipHash,
    userAgent: ua,
    country,
    chainHash,
    bodyHash,
    signedAt: now,
    createdAt: now,
    updatedAt: now,
  })

  // Mark signer signed
  await database.update(schema.contractSigners).set({
    status: 'signed',
    signedAt: now,
    signatureId: sigId,
    updatedAt: now,
  }).where(eq(schema.contractSigners.id, signerId))

  // Are all signers done? If yes, mark contract signed + record finalHash.
  const remaining = await database
    .select({ id: schema.contractSigners.id })
    .from(schema.contractSigners)
    .where(and(
      eq(schema.contractSigners.contractId, doc.id),
      eq(schema.contractSigners.status, 'pending'),
    ))

  let contractStatus: 'partially_signed' | 'signed' = 'partially_signed'
  let finalHash: string | null = null
  if (remaining.length === 0) {
    contractStatus = 'signed'
    // Final hash anchors the entire chain — recomputable from all signatures
    // in order. Stored separately for fast verification.
    finalHash = chainHash
  }

  await database.update(schema.contractDocuments).set({
    status: contractStatus,
    signedAt: contractStatus === 'signed' ? now : undefined,
    finalHash: finalHash ?? undefined,
    updatedAt: now,
  }).where(eq(schema.contractDocuments.id, doc.id))

  // ── Tell the studio. Every signature notifies, not only the last one: a
  // mid-flight signature on a multi-party contract used to produce nothing
  // at all, so a team member could open it believing it untouched when one
  // party had already signed. Awaited (it is a bell insert plus at most a
  // couple of admin emails, not the heavy PDF work below) and never lets a
  // notification failure surface to the signer.
  try {
    const totalSigners = await database
      .select({ id: schema.contractSigners.id })
      .from(schema.contractSigners)
      .where(eq(schema.contractSigners.contractId, doc.id))
    await notifyStudioOfContractSignature(database, {
      contractId: doc.id,
      contractName: doc.name,
      contractType: doc.type,
      orgId: doc.orgId,
      dealId: doc.dealId,
      signerName: signer.name,
      totalSigners: totalSigners.length,
      signedCount: totalSigners.length - remaining.length,
      final: contractStatus === 'signed',
    })
  } catch (err) {
    console.error('[sign route] studio notification failed:', err)
  }

  // ── Fully signed? Kick off the signed-PDF email send asynchronously.
  // We re-verify status from the DB to guard against race conditions (two
  // signers POST'ing at once), then hand the heavy work (PDF render +
  // multi-recipient send + audit log) to ctx.waitUntil so the signer's
  // HTTP response isn't blocked.
  if (contractStatus === 'signed') {
    try {
      const [verify] = await database
        .select({ status: schema.contractDocuments.status })
        .from(schema.contractDocuments)
        .where(eq(schema.contractDocuments.id, doc.id))
        .limit(1)
      if (verify?.status === 'signed') {
        const cfCtx = await getCloudflareContext({ async: true })
        const work = sendFullySignedContractEmails(doc.id)
        if (cfCtx?.ctx?.waitUntil) {
          cfCtx.ctx.waitUntil(work)
        } else {
          // No execution context (e.g. local dev): fire-and-forget.
          // The promise still runs; we just don't get the worker to wait
          // for it before tearing down.
          void work
        }
      }
    } catch (err) {
      // Trigger errors must never block the signer response.
      console.error('[sign route] fully-signed trigger setup failed:', err)
    }
  }

  return NextResponse.json({
    id: sigId,
    chainHash,
    contractStatus,
    finalHash,
  })
}
