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
import { SONNET_MODEL } from '@/lib/ai-models'

export const dynamic = 'force-dynamic'

const MODEL = SONNET_MODEL
const MAX_TRANSCRIPT_CHARS = 40_000

// Meeting-type classifier values (see migration 0050 / sync-calendar
// classifier): 'discovery' and 'deal' calls are sales, 'client' are
// existing-org check-ins, 'partnership' are intro/sync, 'unclassified'
// needs triage. Action items only make sense for client/project work,
// so we gate on 'client' meeting type OR a concrete project linkage
// (org / request / task). Pure sales calls (lead/deal only) never get
// action-item extraction, keeping their output byte-compatible.
function isProjectishCall(call: {
  meetingType: string | null
  orgId: string | null
  requestId: string | null
  taskId: string | null
}): boolean {
  return call.meetingType === 'client'
    || !!call.orgId
    || !!call.requestId
    || !!call.taskId
}

const SYSTEM_PROMPT = `You are an extraction assistant for Tahi Studio, a Webflow design and development agency. You read transcripts of discovery and project calls, and pull structured information that helps the sales operator (Liam) capture deal-relevant details without re-watching the call.

RULES
1. Only extract what was EXPLICITLY discussed. Do not infer scope, budget, or timeline if they were not said out loud. If a field was not mentioned, omit the tag entirely.
2. Use NZ English (colour, organise, centre). No em dashes or en dashes - commas, colons, or full stops instead.
3. Keep summary tight: 2-3 sentences max, no filler.
4. Budget extraction must be conservative. If the client said "around 5 to 10k", emit budgetMin=5000 and budgetMax=10000. If they said "we have budget" with no number, omit both.
5. Outcome should reflect the call's actual sentiment + next step:
   - good_call: productive conversation, project moving forward but no commitment yet
   - promote: clear buy signal - they want to move to a proposal/SOW
   - nurture: timing or fit isn't right now but worth keeping warm
   - archive: dead, mismatched, or explicit no
   - no_show: client didn't attend (only if the transcript shows this)

OUTPUT FORMAT (strict - parsed by regex; omit tags that have no content):

<outcome>good_call | promote | nurture | archive | no_show</outcome>
<summary>2-3 sentence headline of the conversation. Lead with what they want and the next step.</summary>
<outcome_notes>One short paragraph: concrete next action(s) for Liam. e.g. "Send proposal by Friday covering pages X, Y, Z." Include any explicit deadlines.</outcome_notes>
<scope_notes>What they want built. Bullet-style is fine. Pages, sections, design references, integrations, content requirements, anything project-shaped. Skip if not discussed.</scope_notes>
<budget_min>Lower bound of the budget range if mentioned (integer, no currency symbol).</budget_min>
<budget_max>Upper bound if mentioned. If a single number was given, use the same value here.</budget_max>
<budget_currency>3-letter code like NZD / USD / AUD. Default NZD if a $ amount was given with no currency.</budget_currency>
<timeline>urgent | this_quarter | this_year | no_rush - based on what they said about when they need it.</timeline>`

// Appended as a SECOND system block (only for client/project calls) so
// the cached base SYSTEM_PROMPT above stays byte-identical for sales
// calls and keeps hitting the prompt cache.
const ACTION_ITEMS_PROMPT = `ADDITIONAL EXTRACTION FOR THIS CALL: ACTION ITEMS

This is a client or project call, not a pure sales call. In addition to the fields above, extract concrete action items: discrete pieces of work Tahi agreed to do, or next steps that were explicitly committed to on the call. These will become proposed tasks a human reviews before creating.

RULES
1. Only extract work that was EXPLICITLY discussed or agreed. Do not invent tasks or infer implied work.
2. Each action item must be one discrete, actionable thing. Split compound commitments into separate items.
3. Keep titles short and imperative (max ~10 words), e.g. "Update homepage hero copy".
4. Use NZ English. No em dashes or en dashes.
5. If no concrete action items were discussed, emit no action_item tags at all.

OUTPUT FORMAT (append after the fields above; emit one block per task):

<action_item>
<ai_title>Short imperative task title, max ~10 words.</ai_title>
<ai_detail>One line of extra context: the specific thing, any constraint, deadline, or reference mentioned. Omit the tag if there is nothing to add.</ai_detail>
<ai_assignee>Name of the person who should own it, ONLY if a specific person was named on the call. Otherwise omit this tag.</ai_assignee>
</action_item>`

export interface ExtractedActionItem {
  title: string
  oneLineDetail: string | null
  suggestedAssignee: string | null
}

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

  const projectish = isProjectishCall(call)

  // Cache the base system prompt - identical across every transcript
  // extraction and well over Sonnet's 1024-token cache minimum. Second +
  // subsequent extracts within the 5-minute TTL pay ~10% input price on
  // the cached portion. The action-items addendum is a separate,
  // uncached block appended only for client/project calls, so sales
  // calls send a byte-identical system array and keep hitting the cache.
  const systemBlocks: Array<{
    type: 'text'
    text: string
    cache_control?: { type: 'ephemeral' }
  }> = [{
    type: 'text',
    text: SYSTEM_PROMPT,
    cache_control: { type: 'ephemeral' },
  }]
  if (projectish) {
    systemBlocks.push({ type: 'text', text: ACTION_ITEMS_PROMPT })
  }

  let text = ''
  let inputTokens = 0
  let outputTokens = 0

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: systemBlocks,
      messages: [{ role: 'user', content: userMessage }],
    })
    text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
    // Include cached token counts so aiTokensSpent still reflects the
    // total volume routed through the model (cached tokens are
    // discounted but still count toward visibility).
    const usage = response.usage as typeof response.usage & {
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
    inputTokens = usage.input_tokens
      + (usage.cache_read_input_tokens ?? 0)
      + (usage.cache_creation_input_tokens ?? 0)
    outputTokens = usage.output_tokens
  } catch (err) {
    return NextResponse.json({
      error: 'Extraction failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  const extracted = parseExtraction(text)
  // Action items are only ever populated for client/project calls. Sales
  // calls always get an empty array, so their response is additive-only.
  const actionItems = projectish ? parseActionItems(text) : []

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
    actionItems,
    tokensSpent: inputTokens + outputTokens,
  })
}

// Parse zero or more <action_item> blocks. Each block carries an
// ai_title (required), optional ai_detail, and optional ai_assignee.
// Blocks without a usable title are skipped.
function parseActionItems(text: string): ExtractedActionItem[] {
  const items: ExtractedActionItem[] = []
  const blockRe = /<action_item>([\s\S]*?)<\/action_item>/gi
  let match: RegExpExecArray | null
  while ((match = blockRe.exec(text)) !== null) {
    const block = match[1]
    const inner = (name: string): string | null => {
      const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'))
      const v = m ? m[1].trim() : ''
      return v ? v : null
    }
    const title = inner('ai_title')
    if (!title) continue
    items.push({
      title,
      oneLineDetail: inner('ai_detail'),
      suggestedAssignee: inner('ai_assignee'),
    })
  }
  return items
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
