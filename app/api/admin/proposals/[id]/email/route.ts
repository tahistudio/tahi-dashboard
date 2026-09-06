import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { render } from '@react-email/render'
import { ProposalShareEmail } from '@/emails/proposal-share'
import { publicUrl } from '@/lib/app-url'
import { emailFromAddress } from '@/lib/email'
import { deliverEmail } from '@/lib/email-delivery'
import { requireProposalAccess } from '@/app/api/admin/_sales-access/artifact-scope'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

interface Recipient { name: string; email: string }

/**
 * POST /api/admin/proposals/[id]/email
 *
 * Sends the public proposal link to a list of recipients, through the one
 * delivery gate in lib/email-delivery.ts. Recipients the tahi.studio allowlist
 * holds back come back in `suppressed` rather than being silently dropped.
 * Requires the proposal to be in 'shared' status (token must exist).
 *
 * Body: {
 *   to: Array<{ name: string; email: string }>   // required, ≥1
 *   message?: string                              // optional note
 * }
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const body = await req.json().catch(() => ({})) as {
    to?: Recipient[]
    cc?: Recipient[]
    bcc?: Recipient[]
    subject?: string
    message?: string
  }
  if (!Array.isArray(body.to) || body.to.length === 0) {
    return NextResponse.json({ error: 'to[] required with at least one recipient' }, { status: 400 })
  }
  const ccList = (Array.isArray(body.cc) ? body.cc : []).filter(r => r.email?.trim()).map(r => r.email.trim())
  const bccList = (Array.isArray(body.bcc) ? body.bcc : []).filter(r => r.email?.trim()).map(r => r.email.trim())
  const customSubject = body.subject?.trim() || null
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 500 })
  }

  const database = await db() as unknown as D1

  const denied = await requireProposalAccess(database, { userId, orgId }, id)
  if (denied) return denied

  const [proposal] = await database
    .select({
      id: schema.proposals.id,
      // Carried into the delivery gate so a client whose org is on
      // `email.allowedOrgIds` can be mailed even from an outside domain.
      orgId: schema.proposals.orgId,
      title: schema.proposals.title,
      subtitle: schema.proposals.subtitle,
      expiresAt: schema.proposals.expiresAt,
      status: schema.proposals.status,
      token: schema.proposals.publicShareToken,
    })
    .from(schema.proposals)
    .where(eq(schema.proposals.id, id))
    .limit(1)
  if (!proposal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!proposal.token) {
    return NextResponse.json({ error: 'Share the proposal first to mint a public link.' }, { status: 400 })
  }

  const fromName = 'Liam Miller'
  const customMessage = body.message?.trim() || null
  const viewUrl = publicUrl(`/p/proposal/${proposal.token}`)

  const sent: string[] = []
  const failed: Array<{ email: string; error: string }> = []
  // Recipients the delivery allowlist held back, reported rather than hidden.
  const suppressed: string[] = []

  for (const r of body.to) {
    if (!r.email?.trim()) continue
    try {
      const html = await render(ProposalShareEmail({
        recipientName: r.name?.trim() || r.email.split('@')[0],
        proposalTitle: proposal.title,
        proposalSubtitle: proposal.subtitle,
        viewUrl,
        fromName,
        customMessage,
        expiresAt: proposal.expiresAt,
      }))
      const outcome = await deliverEmail({
        from: emailFromAddress(),
        to: r.email,
        cc: ccList,
        bcc: bccList,
        subject: customSubject ?? `Proposal from Tahi Studio: ${proposal.title}`,
        html,
        template: 'proposal-share',
        orgId: proposal.orgId,
      })
      suppressed.push(...outcome.suppressed)
      if (outcome.success) sent.push(r.email)
      else failed.push({ email: r.email, error: outcome.error ?? 'Unknown error' })
    } catch (err) {
      failed.push({ email: r.email, error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return NextResponse.json({ sent, failed, suppressed, viewUrl })
}
