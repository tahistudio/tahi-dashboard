/**
 * POST /api/admin/invoices/[id]/draft-chase
 *
 * Drafts a polite overdue-payment follow-up (dunning) email for an
 * invoice. Clones the proven lead draft-reply triad: this route only
 * ever produces a PENDING draft - a human then edits it and clicks Send
 * on the separate /api/admin/ai-reply-drafts/[id]/send route. Nothing is
 * ever sent from here.
 *
 * The draft is grounded in the invoice: number, amount + currency, days
 * overdue, client org name, and the count of prior chases already sent
 * for this invoice (so the tone escalates gently on repeat follow-ups).
 *
 * Persisted as an ai_reply_drafts row (status='pending', invoiceId set,
 * leadId null). At most one pending chase draft exists per invoice - any
 * existing pending draft is dismissed first.
 *
 * GET returns the current pending chase draft (or null) so the invoice
 * detail UI can render it without a separate lookup.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, sql } from 'drizzle-orm'
import { loadAiContext } from '@/lib/ai-context'
import { requireAccessToOrg } from '@/lib/require-access'
import { SONNET_MODEL } from '@/lib/ai-models'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

const SYSTEM_PROMPT = `You are Liam Miller's billing assistant at Tahi Studio, a Webflow design and development agency based in New Zealand.

YOUR JOB
Draft a polite, professional overdue-payment follow-up email (a gentle dunning reminder) to a client whose invoice is past due. The goal is prompt payment while protecting the relationship. Assume good faith: most late payments are an oversight, not a refusal.

BRAND VOICE - Tahi
- Direct, warm, and human. Get to the point without being cold or robotic.
- Confident and clear about the ask (payment) but never aggressive, never threatening.
- No filler like "I hope this email finds you well" or "Just following up!". Open with the actual point.
- Contractions (we're, you'll, it's). Short sentences. Vary length.
- NZ English spelling (colour, organise, centre).
- NEVER use em dashes or en dashes. Use commas, colons, full stops, parentheses, or restructure.
- Sign off "Liam".

ESCALATION
- If this is the first chase (no prior chases sent), keep it light: a friendly nudge that the invoice may have slipped through.
- If one or more chases have already gone out, stay polite but be a touch firmer and more direct about needing the payment settled, and offer to help if there's a blocker (wrong details, needs a PO, etc).

STRUCTURE
- Subject line: short, specific, references the invoice. e.g. "Invoice INV-A1B2C3 - now overdue" or "Quick nudge on INV-A1B2C3".
- Body: 3-5 short paragraphs.
  1. Open by naming the invoice (number + amount) and that it's now past its due date (state how many days overdue if provided).
  2. Assume it's an oversight; ask them to arrange payment.
  3. Offer to resend the invoice or sort out any issue if something's blocking it.
  4. Sign off.
- DO NOT invent a payment link or bank details - Liam adds those on send if needed.
- DO NOT threaten late fees, legal action, or service suspension.

OUTPUT FORMAT (strict - parsed by regex):

<subject>The subject line</subject>
<body>
The email body. Plain text only. Line breaks for paragraphs.
No HTML, no markdown.
</body>`

interface ParsedDraft {
  subject: string | null
  body: string | null
}

function parseDraft(text: string): ParsedDraft {
  const subjectMatch = text.match(/<subject>([\s\S]*?)<\/subject>/i)
  const bodyMatch = text.match(/<body>([\s\S]*?)<\/body>/i)
  return {
    subject: subjectMatch?.[1].trim() ?? null,
    body: bodyMatch?.[1].trim() ?? null,
  }
}

function invoiceNumber(id: string): string {
  return `INV-${id.slice(0, 6).toUpperCase()}`
}

function daysOverdue(dueDate: string | null): number | null {
  if (!dueDate) return null
  const due = new Date(dueDate.includes('T') ? dueDate : dueDate + 'T23:59:59')
  if (Number.isNaN(due.getTime())) return null
  const diffMs = Date.now() - due.getTime()
  if (diffMs <= 0) return 0
  return Math.floor(diffMs / (1000 * 60 * 60 * 24))
}

// ── GET: current pending chase draft for this invoice ────────────────────────
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [owner] = await drizzle
    .select({ orgId: schema.invoices.orgId })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .limit(1)
  const denied = await requireAccessToOrg(drizzle, userId, owner?.orgId)
  if (denied) return denied

  const [draft] = await drizzle
    .select()
    .from(schema.aiReplyDrafts)
    .where(and(
      eq(schema.aiReplyDrafts.invoiceId, id),
      eq(schema.aiReplyDrafts.status, 'pending'),
    ))
    .orderBy(desc(schema.aiReplyDrafts.createdAt))
    .limit(1)

  return NextResponse.json({ draft: draft ?? null })
}

// ── POST: generate a new pending chase draft ─────────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const [invoice] = await drizzle
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      orgName: schema.organisations.name,
      status: schema.invoices.status,
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      dueDate: schema.invoices.dueDate,
      paidAt: schema.invoices.paidAt,
    })
    .from(schema.invoices)
    .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
    .where(eq(schema.invoices.id, id))
    .limit(1)

  if (!invoice) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  const denied = await requireAccessToOrg(drizzle, userId, invoice.orgId)
  if (denied) return denied

  // Only chase invoices that have actually been billed and remain unpaid.
  if (invoice.status !== 'sent' && invoice.status !== 'overdue') {
    return NextResponse.json({
      error: `Invoice is "${invoice.status}" - chase emails are only for sent or overdue invoices`,
    }, { status: 400 })
  }
  if (invoice.paidAt) {
    return NextResponse.json({ error: 'Invoice is already paid' }, { status: 400 })
  }

  // Resolve the recipient: the org's primary contact (must have an email).
  const [primaryContact] = await drizzle
    .select({
      id: schema.contacts.id,
      name: schema.contacts.name,
      email: schema.contacts.email,
    })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, invoice.orgId))
    .orderBy(desc(schema.contacts.isPrimary))
    .limit(1)

  if (!primaryContact || !primaryContact.email) {
    return NextResponse.json({
      error: 'This client has no contact with an email - add one before drafting a chase',
    }, { status: 400 })
  }

  // Prior chases already sent for this invoice - informs escalation tone.
  const [priorChaseRow] = await drizzle
    .select({ count: sql<number>`count(*)`.as('count') })
    .from(schema.aiReplyDrafts)
    .where(and(
      eq(schema.aiReplyDrafts.invoiceId, id),
      eq(schema.aiReplyDrafts.status, 'sent'),
    ))
  const priorChaseCount = Number(priorChaseRow?.count ?? 0)

  const overdue = daysOverdue(invoice.dueDate)
  const currency = (invoice.currency ?? 'NZD').toUpperCase()
  const amount = (invoice.totalUsd ?? 0).toLocaleString('en-NZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const lines: string[] = []
  lines.push(`Invoice: ${invoiceNumber(invoice.id)}`)
  lines.push(`Client: ${invoice.orgName ?? 'the client'}`)
  lines.push(`Recipient: ${primaryContact.name} (${primaryContact.email})`)
  lines.push(`Amount due: ${amount} ${currency}`)
  if (invoice.dueDate) lines.push(`Due date: ${invoice.dueDate}`)
  if (overdue != null) {
    lines.push(overdue > 0
      ? `Days overdue: ${overdue}`
      : `Status: due today / just past due`)
  }
  lines.push(priorChaseCount > 0
    ? `Prior chase emails already sent for this invoice: ${priorChaseCount} (escalate tone slightly - be a touch firmer)`
    : `This is the FIRST chase for this invoice (keep it light and friendly).`)
  lines.push('')
  lines.push('Draft the overdue-payment follow-up now.')

  const userMessage = lines.join('\n')

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Ground the draft in Tahi's brand voice + tone docs (cached, ~5min TTL).
  const contextText = await loadAiContext(['tone', 'brandDna'])

  let text = ''
  let totalTokens = 0
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    const systemBlocks = contextText
      ? [
          { type: 'text' as const, text: contextText, cache_control: { type: 'ephemeral' as const } },
          { type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } },
        ]
      : [
          { type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } },
        ]

    const response = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1000,
      system: systemBlocks,
      messages: [{ role: 'user', content: userMessage }],
    })
    text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
    const usage = response.usage as typeof response.usage & {
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    totalTokens =
      usage.input_tokens +
      usage.output_tokens +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0)
  } catch (err) {
    return NextResponse.json({
      error: 'Draft generation failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  const draft = parseDraft(text)
  if (!draft.body) {
    return NextResponse.json({
      error: 'Model returned no usable body',
      raw: text.slice(0, 500),
    }, { status: 500 })
  }

  const now = new Date().toISOString()

  // Single-active-draft invariant: dismiss any existing pending chase draft.
  await drizzle
    .update(schema.aiReplyDrafts)
    .set({ status: 'dismissed', updatedAt: now })
    .where(and(
      eq(schema.aiReplyDrafts.invoiceId, id),
      eq(schema.aiReplyDrafts.status, 'pending'),
    ))

  const draftId = crypto.randomUUID()
  await drizzle.insert(schema.aiReplyDrafts).values({
    id: draftId,
    leadId: null,
    invoiceId: id,
    aiDraftSubject: draft.subject ?? null,
    aiDraftBody: draft.body,
    finalSubject: draft.subject ?? null,
    finalBody: draft.body,
    status: 'pending',
    tokensSpent: totalTokens,
    createdAt: now,
    updatedAt: now,
  })

  // Activity stamp on the client timeline.
  await drizzle.insert(schema.activities).values({
    id: crypto.randomUUID(),
    type: 'invoice_chase_drafted',
    title: `AI drafted an overdue-invoice chase (${invoiceNumber(invoice.id)})`,
    description: 'Pending review - open the invoice to edit / send / dismiss.',
    orgId: invoice.orgId,
    contactId: primaryContact.id,
    createdById: 'system',
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({
    draftId,
    subject: draft.subject,
    body: draft.body,
    recipientEmail: primaryContact.email,
    recipientName: primaryContact.name,
    priorChaseCount,
    daysOverdue: overdue,
    tokensSpent: totalTokens,
  })
}
