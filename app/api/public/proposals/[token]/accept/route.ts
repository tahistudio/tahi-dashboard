import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ token: string }> }

async function hashIp(ip: string | null): Promise<string | null> {
  if (!ip) return null
  const salt = process.env.ENCRYPTION_KEY ?? ''
  const data = new TextEncoder().encode(`${ip}|${salt}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  const bytes = Array.from(new Uint8Array(buf))
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * POST /api/public/proposals/[token]/accept
 * Public accept-or-decline endpoint. Validates token, requires variantId
 * (for accept; decline is whole-proposal). Records audit trail (IP hash,
 * UA, timestamp). Updates the proposal's status + decidedVariantId.
 *
 * Body: {
 *   status: 'accepted' | 'declined',
 *   variantId?: string,  // required when status === 'accepted'
 *   acceptorName?: string,
 *   acceptorEmail?: string,
 *   acceptorRole?: string,
 *   comment?: string,
 * }
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params
  if (!token || !/^[A-Za-z0-9_-]{20,64}$/.test(token)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: {
    status?: 'accepted' | 'declined' | 'question'
    variantId?: string
    acceptorName?: string
    acceptorEmail?: string
    acceptorRole?: string
    comment?: string
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  const VALID_STATUSES = ['accepted', 'declined', 'question'] as const
  type Status = typeof VALID_STATUSES[number]
  if (!VALID_STATUSES.includes(body.status as Status)) {
    return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` }, { status: 400 })
  }
  const status: Status = body.status as Status
  if (status === 'accepted' && !body.variantId) {
    return NextResponse.json({ error: 'variantId is required when accepting' }, { status: 400 })
  }
  if (status === 'question' && !body.comment?.trim()) {
    return NextResponse.json({ error: 'comment is required when asking a question' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  // Validate token + status. Reject if revoked or already decided (prevents
  // multiple acceptance / churn — admin can re-share to re-collect).
  const [proposal] = await database
    .select({ id: schema.proposals.id, status: schema.proposals.status })
    .from(schema.proposals)
    .where(eq(schema.proposals.publicShareToken, token))
    .limit(1)
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (proposal.status !== 'shared') {
    return NextResponse.json({ error: 'This proposal is no longer open for response.' }, { status: 409 })
  }

  // If acceptance, verify variantId belongs to this proposal.
  if (status === 'accepted' && body.variantId) {
    const [variant] = await database
      .select({ id: schema.proposalVariants.id })
      .from(schema.proposalVariants)
      .where(and(
        eq(schema.proposalVariants.id, body.variantId),
        eq(schema.proposalVariants.proposalId, proposal.id),
      ))
      .limit(1)
    if (!variant) return NextResponse.json({ error: 'Invalid variant' }, { status: 400 })
  }

  // Capture audit metadata
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')
  const country = req.headers.get('cf-ipcountry')
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 200) || null
  const ipHash = await hashIp(ip)

  // Record acceptance
  const acceptanceId = crypto.randomUUID()
  await database.insert(schema.proposalAcceptances).values({
    id: acceptanceId,
    proposalId: proposal.id,
    variantId: body.variantId ?? null,
    status: status,
    acceptorName: body.acceptorName?.trim() || null,
    acceptorEmail: body.acceptorEmail?.trim() || null,
    acceptorRole: body.acceptorRole?.trim() || null,
    comment: body.comment?.trim() || null,
    acceptorIpHash: ipHash,
    acceptorCountry: country,
    acceptorUa: ua,
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
  })

  // Update proposal status — questions don't lock the proposal; the prospect
  // can still come back and accept or decline after the question is answered.
  if (status === 'accepted' || status === 'declined') {
    await database.update(schema.proposals).set({
      status: status,
      decidedAt: now,
      decidedVariantId: status === 'accepted' ? (body.variantId ?? null) : null,
      updatedAt: now,
    }).where(eq(schema.proposals.id, proposal.id))
  } else {
    // Touch updatedAt so the admin sees activity on the proposal.
    await database.update(schema.proposals).set({ updatedAt: now })
      .where(eq(schema.proposals.id, proposal.id))
  }

  return NextResponse.json({ id: acceptanceId, status: status })
}
