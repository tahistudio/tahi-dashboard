import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and } from 'drizzle-orm'
import { notifyAllAdmins } from '@/lib/notifications'
import { studioProposalDecisionEmailPlan } from '@/lib/notification-email'

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

interface SnapshotVariant {
  id: string
  name: string
  oneOffAmount: number | null
  monthlyAmount: number | null
  currency: string | null
}

/**
 * The variants array out of a published snapshot (see the publish route,
 * which writes { proposal, sections, variants } as JSON). Returns null on a
 * missing or corrupt snapshot so the caller can fall back to the live table
 * rather than 500.
 */
function parseSnapshotVariants(raw: string | null): SnapshotVariant[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { variants?: unknown }
    if (!Array.isArray(parsed.variants)) return null
    return parsed.variants as SnapshotVariant[]
  } catch {
    return null
  }
}

/**
 * POST /api/public/proposals/[token]/accept
 * Public accept-or-decline endpoint. Validates token, requires variantId
 * (for accept; decline and question are whole-proposal). Records audit trail
 * (IP hash, UA, timestamp). Updates the proposal's status + decidedVariantId,
 * tells the studio (bell + email), and logs a deal activity when the
 * proposal is linked to one.
 *
 * Body: {
 *   status: 'accepted' | 'declined' | 'question',
 *   variantId?: string,  // required when status === 'accepted'
 *   acceptorName?: string,
 *   acceptorEmail?: string,
 *   acceptorRole?: string,
 *   comment?: string,    // required when status === 'question'
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

  const [proposal] = await database
    .select({
      id: schema.proposals.id,
      title: schema.proposals.title,
      status: schema.proposals.status,
      dealId: schema.proposals.dealId,
      orgId: schema.proposals.orgId,
      expiresAt: schema.proposals.expiresAt,
      publishedSnapshot: schema.proposals.publishedSnapshot,
      orgName: schema.organisations.name,
    })
    .from(schema.proposals)
    .leftJoin(schema.organisations, eq(schema.proposals.orgId, schema.organisations.id))
    .where(eq(schema.proposals.publicShareToken, token))
    .limit(1)
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Expiry gate, before any decision logic, mirroring the contract sign
  // route: an expired document refuses every write, at the price it had when
  // it expired, not whatever it reads as today.
  if (proposal.status === 'expired') {
    return NextResponse.json({ error: 'This proposal has expired.' }, { status: 410 })
  }
  if (proposal.status !== 'shared') {
    return NextResponse.json({ error: 'This proposal is no longer open for response.' }, { status: 409 })
  }
  if (proposal.expiresAt && new Date(proposal.expiresAt).getTime() < Date.now()) {
    await database.update(schema.proposals).set({ status: 'expired', updatedAt: now })
      .where(eq(schema.proposals.id, proposal.id))
    return NextResponse.json({ error: 'This proposal has expired.' }, { status: 410 })
  }

  // Validate the variant against what the client actually saw (the published
  // snapshot), not the live table, which the admin may have edited since
  // sharing. A legacy proposal published before the snapshot model existed
  // has no snapshot at all; fall back to the live table for those and say so
  // in the response rather than 500.
  let acceptedVariant: SnapshotVariant | null = null
  let snapshotFallback = false
  if (status === 'accepted' && body.variantId) {
    const snapshotVariants = parseSnapshotVariants(proposal.publishedSnapshot)
    if (snapshotVariants) {
      acceptedVariant = snapshotVariants.find((v) => v.id === body.variantId) ?? null
      if (!acceptedVariant) return NextResponse.json({ error: 'Invalid variant' }, { status: 400 })
    } else {
      snapshotFallback = true
      const [variant] = await database
        .select({
          id: schema.proposalVariants.id,
          name: schema.proposalVariants.name,
          oneOffAmount: schema.proposalVariants.oneOffAmount,
          monthlyAmount: schema.proposalVariants.monthlyAmount,
          currency: schema.proposalVariants.currency,
        })
        .from(schema.proposalVariants)
        .where(and(
          eq(schema.proposalVariants.id, body.variantId),
          eq(schema.proposalVariants.proposalId, proposal.id),
        ))
        .limit(1)
      if (!variant) return NextResponse.json({ error: 'Invalid variant' }, { status: 400 })
      acceptedVariant = variant
    }
  }

  // Capture audit metadata
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')
  const country = req.headers.get('cf-ipcountry')
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 200) || null
  const ipHash = await hashIp(ip)

  // Record acceptance, with the accepted amounts frozen from the snapshot
  // (migration 0098) so a later edit to the live variant can never change
  // what this row says was agreed.
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
    acceptedVariantName: acceptedVariant?.name ?? null,
    acceptedOneOffAmount: acceptedVariant?.oneOffAmount ?? null,
    acceptedMonthlyAmount: acceptedVariant?.monthlyAmount ?? null,
    acceptedCurrency: acceptedVariant?.currency ?? null,
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

  // Tell the studio: one call, both channels. The viewer promises a reply
  // within one business day, and this is the only signal that clock started.
  const clientName = proposal.orgName ?? 'A prospect'
  const eventType =
    status === 'accepted' ? 'proposal_signed' : status === 'declined' ? 'proposal_declined' : 'proposal_question'
  const title =
    status === 'accepted'
      ? `${clientName} accepted "${proposal.title}"`
      : status === 'declined'
        ? `${clientName} declined "${proposal.title}"`
        : `${clientName} asked a question on "${proposal.title}"`
  const notificationBody =
    status === 'question' ? (body.comment?.trim() || null) : (acceptedVariant?.name ?? null)

  await notifyAllAdmins(database, {
    type: eventType,
    title,
    body: notificationBody,
    entityType: 'proposal',
    entityId: proposal.id,
    email: studioProposalDecisionEmailPlan({
      decision: status,
      proposalId: proposal.id,
      proposalTitle: proposal.title,
      orgId: proposal.orgId,
      clientName,
      variantName: acceptedVariant?.name ?? null,
      comment: body.comment?.trim() || null,
      acceptorName: body.acceptorName?.trim() || null,
    }),
  })

  // A deal activity, when the proposal is actually linked to one. No stage
  // move here on purpose, that is a separate, deliberate Liam decision.
  if (proposal.dealId) {
    const activityType =
      status === 'accepted' ? 'proposal_accepted' : status === 'declined' ? 'proposal_declined' : 'proposal_question'
    const activityTitle =
      status === 'accepted'
        ? `Proposal accepted: ${proposal.title}`
        : status === 'declined'
          ? `Proposal declined: ${proposal.title}`
          : `Question on proposal: ${proposal.title}`
    await database.insert(schema.activities).values({
      id: crypto.randomUUID(),
      type: activityType,
      title: activityTitle,
      description: status === 'question' ? (body.comment?.trim() || null) : null,
      dealId: proposal.dealId,
      orgId: proposal.orgId,
      createdById: 'system',
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({
    id: acceptanceId,
    status: status,
    ...(snapshotFallback ? { snapshotFallback: true } : {}),
  })
}
