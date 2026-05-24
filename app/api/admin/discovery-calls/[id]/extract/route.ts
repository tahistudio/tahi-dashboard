/**
 * POST /api/admin/discovery-calls/[id]/extract
 *
 * Read the call's transcript via Sonnet 4.6 and return structured
 * suggestions for the post-call fields: outcome, summary, scope notes,
 * budget signal, timeline, next-step (outcome notes). Action items
 * extracted from the transcript get folded into outcomeNotes.
 *
 * Returns the suggestions (does NOT auto-apply). The UI surfaces them
 * with a one-click "Apply" banner so Liam can review before they
 * overwrite anything.
 *
 * Tokens are tracked against the lead's aiTokensSpent if the call is
 * linked to a lead (most common case). Otherwise they're not gated.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

const MODEL = 'claude-sonnet-4-6'
const MAX_TRANSCRIPT_CHARS = 40_000

const SYSTEM_PROMPT = `You are an extraction assistant for Tahi Studio, a Webflow design and development agency. You read transcripts of discovery and project calls, and pull structured information that helps the sales operator (Liam) capture deal-relevant details without re-watching the call.

RULES
1. Only extract what was EXPLICITLY discussed. Do not infer scope, budget, or timeline if they were not said out loud. If a field was not mentioned, omit the tag entirely.
2. Use NZ English (colour, organise, centre). No em dashes or en dashes — commas, colons, or full stops instead.
3. Keep summary tight: 2-3 sentences max, no filler.
4. Budget extraction must be conservative. If the client said "around 5 to 10k", emit budgetMin=5000 and budgetMax=10000. If they said "we have budget" with no number, omit both.
5. Outcome should reflect the call's actual sentiment + next step:
   - good_call: productive conversation, project moving forward but no commitment yet
   - promote: clear buy signal — they want to move to a proposal/SOW
   - nurture: timing or fit isn't right now but worth keeping warm
   - archive: dead, mismatched, or explicit no
   - no_show: client didn't attend (only if the transcript shows this)

OUTPUT FORMAT (strict — parsed by regex; omit tags that have no content):

<outcome>good_call | promote | nurture | archive | no_show</outcome>
<summary>2-3 sentence headline of the conversation. Lead with what they want and the next step.</summary>
<outcome_notes>One short paragraph: concrete next action(s) for Liam. e.g. "Send proposal by Friday covering pages X, Y, Z." Include any explicit deadlines.</outcome_notes>
<scope_notes>What they want built. Bullet-style is fine. Pages, sections, design references, integrations, content requirements, anything project-shaped. Skip if not discussed.</scope_notes>
<budget_min>Lower bound of the budget range if mentioned (integer, no currency symbol).</budget_min>
<budget_max>Upper bound if mentioned. If a single number was given, use the same value here.</budget_max>
<budget_currency>3-letter code like NZD / USD / AUD. Default NZD if a $ amount was given with no currency.</budget_currency>
<timeline>urgent | this_quarter | this_year | no_rush — based on what they said about when they need it.</timeline>`

interface ExtractedFields {
  outcome?: string
  summary?: string
  outcomeNotes?: string
  scopeNotes?: string
  budgetMin?: number
  budgetMax?: number
  budgetCurrency?: string
  timeline?: string
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

  const [call] = await database
    .select()
    .from(schema.discoveryCalls)
    .where(eq(schema.discoveryCalls.id, id))
    .limit(1)

  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 })
  }
  if (!call.transcript?.trim()) {
    return NextResponse.json({
      error: 'No transcript on this call. Paste the Gemini transcript before extracting.',
    }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Cap transcript to MAX_TRANSCRIPT_CHARS so a giant paste doesn't
  // blow the model context budget unnecessarily.
  const transcript = call.transcript.length > MAX_TRANSCRIPT_CHARS
    ? call.transcript.slice(0, MAX_TRANSCRIPT_CHARS)
    : call.transcript

  const userMessage = [
    `Transcript of a call on ${call.scheduledAt} (${call.durationMinutes} minutes).`,
    `Title: ${call.title}`,
    '',
    'TRANSCRIPT:',
    transcript,
  ].join('\n')

  let text = ''
  let inputTokens = 0
  let outputTokens = 0

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })
    text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
    inputTokens = response.usage.input_tokens
    outputTokens = response.usage.output_tokens
  } catch (err) {
    return NextResponse.json({
      error: 'Extraction failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  const extracted = parseExtraction(text)

  // Token accounting: roll into the lead's aiTokensSpent if linked.
  if (call.leadId) {
    const [lead] = await database
      .select({ aiTokensSpent: schema.leads.aiTokensSpent })
      .from(schema.leads)
      .where(eq(schema.leads.id, call.leadId))
      .limit(1)
    if (lead) {
      await database
        .update(schema.leads)
        .set({
          aiTokensSpent: (lead.aiTokensSpent ?? 0) + inputTokens + outputTokens,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.leads.id, call.leadId))
    }
  }

  return NextResponse.json({
    callId: id,
    suggestions: extracted,
    tokensSpent: inputTokens + outputTokens,
  })
}

function parseExtraction(text: string): ExtractedFields {
  const tag = (name: string): string | null => {
    const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))
    return m ? m[1].trim() : null
  }
  const tagInt = (name: string): number | null => {
    const v = tag(name)
    if (v == null) return null
    const n = parseInt(v.replace(/[^0-9-]/g, ''), 10)
    return Number.isFinite(n) ? n : null
  }
  const out: ExtractedFields = {}
  const outcome = tag('outcome')?.toLowerCase()
  if (outcome && ['good_call', 'promote', 'nurture', 'archive', 'no_show'].includes(outcome)) {
    out.outcome = outcome
  }
  const summary = tag('summary')
  if (summary) out.summary = summary
  const outcomeNotes = tag('outcome_notes')
  if (outcomeNotes) out.outcomeNotes = outcomeNotes
  const scopeNotes = tag('scope_notes')
  if (scopeNotes) out.scopeNotes = scopeNotes
  const budgetMin = tagInt('budget_min')
  if (budgetMin != null) out.budgetMin = budgetMin
  const budgetMax = tagInt('budget_max')
  if (budgetMax != null) out.budgetMax = budgetMax
  const budgetCurrency = tag('budget_currency')?.toUpperCase()
  if (budgetCurrency && /^[A-Z]{3}$/.test(budgetCurrency)) out.budgetCurrency = budgetCurrency
  const timeline = tag('timeline')?.toLowerCase()
  if (timeline && ['urgent', 'this_quarter', 'this_year', 'no_rush'].includes(timeline)) {
    out.timeline = timeline
  }
  return out
}
