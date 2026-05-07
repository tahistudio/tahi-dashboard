import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, asc } from 'drizzle-orm'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { sendFullySignedContractEmails } from '@/lib/contract-fully-signed-emails'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ token: string; signerId: string }> }

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function hashIp(ip: string | null): Promise<string | null> {
  if (!ip) return null
  const salt = process.env.ENCRYPTION_KEY ?? ''
  return sha256Hex(`${ip}|${salt}`)
}

/**
 * POST /api/public/contracts/[token]/sign/[signerId]
 * Records a signature with tamper-evident hash chain.
 *
 * Hash chain rule:
 *   chainHash = sha256(prevChainHash || signerId || signatureDataUrl || timestamp)
 *
 * Where prevChainHash is the chainHash of the most recent existing signature on
 * this contract, or '' if this is the first signature. Tampering with any earlier
 * signature breaks every later chainHash (recomputable to verify).
 *
 * When this is the final pending signer, the contract status flips to 'signed'
 * and finalHash is recorded.
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
  if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) {
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
  const chainHash = await sha256Hex(`${prevChainHash}|${signerId}|${sigUrl}|${now}`)

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
