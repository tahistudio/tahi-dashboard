/**
 * POST /api/admin/leads/[id]/draft-reply
 *
 * Generates an AI-drafted first reply for an inbound lead. Uses the
 * lead's enrichment (aiSummary + signals + scope hints) plus the last
 * N sent tone-examples (where Liam edited the AI version) so the
 * draft picks up his actual voice over time.
 *
 * Returns the draft (subject + body) AND persists it as an
 * ai_reply_drafts row with status='pending'. Client can then call
 * PATCH to update finalSubject/finalBody before send, or POST
 * /api/admin/leads/[id]/draft-reply/send to fire it via Resend.
 *
 * Side effect: marks any existing pending draft for this lead as
 * 'dismissed' so we always have at most one pending draft per lead.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, ne, sql } from 'drizzle-orm'
import { loadAiContext } from '@/lib/ai-context'

export const dynamic = 'force-dynamic'

const MODEL = 'claude-sonnet-4-6'
const TONE_EXAMPLE_COUNT = 5

const SYSTEM_PROMPT = `You are Liam Miller's reply-drafting assistant at Tahi Studio, a Webflow design and development agency based in New Zealand.

YOUR JOB
Draft a personalised first reply email to a fresh inbound lead. The reply should feel like Liam wrote it himself — direct, warm, no filler. The goal is to land a discovery call.

BRAND VOICE — Tahi
- Direct, warm, and human. Get to the point.
- Confident but not pushy. Lead with what you'd suggest, then offer alternatives.
- No filler phrases like "I'd be happy to" / "Great to hear from you!" / "Thanks for reaching out!" Open with the actual point.
- Contractions (we're, you'll, it's). Short sentences. Vary length.
- NZ English spelling (colour, organise, centre).
- NEVER use em dashes or en dashes. Commas, colons, full stops, parentheses, or restructure.
- Sign off "Liam".

STRUCTURE
- Subject line: short and specific. Mention the prospect's project + Tahi together. e.g. "Re: Tara Winery rebuild" or "Quick thoughts on glasswall.com".
- Body: 4-6 short paragraphs.
  1. Open by referencing something specific about their company / website / situation (from the enrichment briefing). Shows you've actually looked.
  2. Acknowledge their ask in your own words.
  3. Suggest a 30-min discovery call. Propose 2-3 specific time blocks (you don't have their calendar yet, so use "this week / next week / mid-morning" style).
  4. One short paragraph on what you'd cover in the call (so they know it's worth their time).
  5. Sign off.
- DO NOT add a meeting link — Liam adds his Calendly manually on send.

TONE EXAMPLES
If past reply edits are provided below, study them carefully. They show exactly how Liam phrases things, what he cuts, what he adds. Match his voice from those examples over the generic brand voice when they conflict.

OUTPUT FORMAT (strict — parsed by regex):

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

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()

  const [lead] = await database
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, id))
    .limit(1)

  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }
  if (!lead.email) {
    return NextResponse.json({
      error: 'Lead has no email — cannot draft a reply without an address',
    }, { status: 400 })
  }

  // Pull the last N tone examples: drafts where finalBody exists AND
  // differs from aiDraftBody. These are the rows where Liam edited
  // before sending — gold for capturing his voice.
  const toneExamples = await database
    .select({
      aiDraftSubject: schema.aiReplyDrafts.aiDraftSubject,
      aiDraftBody: schema.aiReplyDrafts.aiDraftBody,
      finalSubject: schema.aiReplyDrafts.finalSubject,
      finalBody: schema.aiReplyDrafts.finalBody,
    })
    .from(schema.aiReplyDrafts)
    .where(and(
      eq(schema.aiReplyDrafts.status, 'sent'),
      sql`${schema.aiReplyDrafts.finalBody} IS NOT NULL`,
      sql`${schema.aiReplyDrafts.finalBody} != ${schema.aiReplyDrafts.aiDraftBody}`,
    ))
    .orderBy(desc(schema.aiReplyDrafts.sentAt))
    .limit(TONE_EXAMPLE_COUNT)

  // Build the user message: lead context + tone examples (if any)
  const aiSummary = lead.aiSummary
  const aiSignals = lead.aiSignals
  let parsedSummary: { snapshot?: string; fit?: string; watchOuts?: string } | null = null
  if (aiSummary) {
    try {
      const parsed = JSON.parse(aiSummary)
      if (parsed && typeof parsed === 'object') parsedSummary = parsed
    } catch { /* legacy plain-text summary */ }
  }

  const lines: string[] = []
  lines.push(`Lead: ${lead.name}`)
  if (lead.jobTitle) lines.push(`Role: ${lead.jobTitle}`)
  if (lead.company) lines.push(`Company: ${lead.company}`)
  if (lead.website) lines.push(`Website: ${lead.website}`)
  lines.push(`Email: ${lead.email}`)
  if (lead.brief) lines.push(`Their brief: ${lead.brief}`)
  lines.push(`Source: ${lead.source}${lead.sourceDetail ? ` (${lead.sourceDetail})` : ''}`)
  if (lead.estimatedValue) lines.push(`Estimated value: ${lead.estimatedValue} ${lead.currency}`)
  lines.push('')

  if (parsedSummary) {
    lines.push('AI BRIEFING')
    if (parsedSummary.snapshot) lines.push(`Snapshot: ${parsedSummary.snapshot}`)
    if (parsedSummary.fit) lines.push(`Why they might fit: ${parsedSummary.fit}`)
    if (parsedSummary.watchOuts) lines.push(`Watch-outs: ${parsedSummary.watchOuts}`)
    lines.push('')
  } else if (aiSummary) {
    lines.push(`AI briefing: ${aiSummary.slice(0, 1500)}`)
    lines.push('')
  }

  if (aiSignals) {
    try {
      const sig = JSON.parse(aiSignals) as Record<string, string | undefined>
      const sigLines: string[] = []
      if (sig.employeeCount) sigLines.push(`Team: ${sig.employeeCount}`)
      if (sig.fundingRaised) sigLines.push(`Funding: ${sig.fundingRaised}`)
      if (sig.siteTechStack) sigLines.push(`Tech: ${sig.siteTechStack}`)
      if (sig.decisionMaker) sigLines.push(`Decision-maker: ${sig.decisionMaker}`)
      if (sigLines.length > 0) {
        lines.push('SIGNALS')
        lines.push(...sigLines)
        lines.push('')
      }
    } catch { /* ignore */ }
  }

  if (toneExamples.length > 0) {
    lines.push('PAST EDITS (study these — they show how Liam writes):')
    toneExamples.forEach((ex, i) => {
      lines.push(`--- Example ${i + 1} ---`)
      lines.push('AI version:')
      lines.push(ex.aiDraftBody ?? '')
      lines.push('Liam sent:')
      lines.push(ex.finalBody ?? '')
      lines.push('')
    })
  }

  lines.push('Draft the first reply now.')

  const userMessage = lines.join('\n')

  // Call Sonnet
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Load the canonical Tahi context docs (ICP, brand DNA, tone of voice,
  // Liam's personal voice, AI writing tells, services + pricing). These
  // are cached and prepended to the system prompt as a single ephemeral
  // block, so the doc-hub edits propagate to AI replies within 5min.
  const contextText = await loadAiContext([
    'icp', 'brandDna', 'tone', 'liamVoice', 'aiTells', 'services',
  ])

  let text = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheCreationTokens = 0
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })

    // Build the system blocks. Two ephemeral cache prefixes — the docs
    // change rarely (5min TTL on our side, ~5min cache TTL on Anthropic's
    // side), and the role prompt is stable. This means subsequent draft
    // calls within the cache window pay only the user-message + output
    // tokens, ~10% of the full-prompt cost.
    const systemBlocks = contextText
      ? [
          { type: 'text' as const, text: contextText, cache_control: { type: 'ephemeral' as const } },
          { type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } },
        ]
      : [
          { type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } },
        ]

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
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
    inputTokens = usage.input_tokens
    outputTokens = usage.output_tokens
    cacheReadTokens = usage.cache_read_input_tokens ?? 0
    cacheCreationTokens = usage.cache_creation_input_tokens ?? 0
  } catch (err) {
    return NextResponse.json({
      error: 'Draft generation failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  const draft = parseDraft(text)
  if (!draft.body) {
    return NextResponse.json({
      error: 'Sonnet returned no usable body',
      raw: text.slice(0, 500),
    }, { status: 500 })
  }

  // Dismiss any existing pending draft (single-active-draft invariant)
  await database
    .update(schema.aiReplyDrafts)
    .set({ status: 'dismissed', updatedAt: new Date().toISOString() })
    .where(and(
      eq(schema.aiReplyDrafts.leadId, id),
      eq(schema.aiReplyDrafts.status, 'pending'),
    ))

  // Persist this draft
  const draftId = crypto.randomUUID()
  const now = new Date().toISOString()
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens
  await database.insert(schema.aiReplyDrafts).values({
    id: draftId,
    leadId: id,
    aiDraftSubject: draft.subject ?? null,
    aiDraftBody: draft.body,
    finalSubject: draft.subject ?? null,
    finalBody: draft.body,
    status: 'pending',
    tokensSpent: totalTokens,
    createdAt: now,
    updatedAt: now,
  })

  // Roll tokens into the lead's running total
  await database
    .update(schema.leads)
    .set({
      aiTokensSpent: (lead.aiTokensSpent ?? 0) + totalTokens,
      updatedAt: now,
    })
    .where(eq(schema.leads.id, id))

  // Activity stamp so the timeline shows the draft was generated
  await database.insert(schema.activities).values({
    id: crypto.randomUUID(),
    type: 'lead_reply_drafted',
    title: 'AI drafted a first reply',
    description: 'Pending your review — open the lead to send / edit / dismiss.',
    leadId: id,
    createdById: 'system',
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({
    draftId,
    subject: draft.subject,
    body: draft.body,
    toneExamplesUsed: toneExamples.length,
    tokensSpent: totalTokens,
    cacheReadTokens,
  })
}

// Just so the path serves something on GET (debugging convenience).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const database = await db()
  const drafts = await database
    .select()
    .from(schema.aiReplyDrafts)
    .where(eq(schema.aiReplyDrafts.leadId, id))
    .orderBy(desc(schema.aiReplyDrafts.createdAt))
    .limit(10)
  return NextResponse.json({ drafts })
}

// Silence the unused-import warning when ne is imported but not used.
void ne
