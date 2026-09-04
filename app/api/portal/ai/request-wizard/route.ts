/**
 * POST /api/portal/ai/request-wizard
 *
 * Portal-scoped AI wizard for clients drafting their own requests.
 *
 * Differences from the admin endpoint (`/api/admin/ai/request-wizard`):
 *  - Portal auth: denies the Tahi admin org and any unauthenticated user.
 *    The client's `orgId` is derived from Clerk, not supplied by the caller.
 *  - Client-safe prompt: no internal hour estimates, no pricing, no admin
 *    track-sizing commentary. The client doesn't see / shouldn't see those.
 *  - Priority is not surfaced to the client; requests land at `standard`
 *    unless the client explicitly says "urgent" / "ASAP", in which case we
 *    flag it `high`.
 *  - Only exposes the four client-facing categories.
 *
 * Decision #048 (Phase 2).
 */

import { getRequestAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { HAIKU_MODEL } from '@/lib/ai-models'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardMessage {
  role: 'user' | 'assistant'
  content: string
}

interface WizardContext {
  /** Optional plan hint; the server ignores it beyond passing into the
   *  prompt as colour. Clients never see internal pricing/hours anyway. */
  planType?: string
}

interface WizardBody {
  messages: WizardMessage[]
  context?: WizardContext
}

interface RequestDraft {
  id: string
  title: string
  description: string
  category: 'design' | 'development' | 'content' | 'strategy'
  type: 'small_task' | 'large_task' | 'bug_fix' | 'new_feature'
  priority: 'standard' | 'high'
  /** Included so the prompt and the UI stay consistent with the admin wizard.
   *  The portal submit path ignores this value (clients don't set internal hours). */
  estimatedHours: number
}

interface WizardResponse {
  reply: string
  requests?: RequestDraft[]
  done: boolean
  /** True when the answer came from the keyword fallback, not the model. */
  degraded?: true
  reason?: 'ai_unavailable'
}

// ── Failure payloads ─────────────────────────────────────────────────────────
// This endpoint is client-facing, so a model that was never reached must not
// come back as a 200 carrying a draft built by regex from the client's own
// words. The panel renders `error` and paints a degraded answer as a notice.

const DEGRADED = { degraded: true, reason: 'ai_unavailable' } as const

const AI_UNAVAILABLE = {
  error: 'The AI assistant could not be reached. Try again shortly, or write the request yourself.',
  reason: 'ai_unavailable',
} as const

const AI_RATE_LIMITED = {
  error: 'The AI assistant is busy right now. Wait a moment and send that again.',
  reason: 'ai_rate_limited',
} as const

// ── Per-user daily cap ───────────────────────────────────────────────────────
// One Anthropic call per turn with nothing counting them is invisible spend the
// moment the wizard opens to clients. The repo has no KV binding and no
// rate-limit helper in lib/, so the cheapest brake it can carry is a counter
// row in `settings`.
//
// Two rules keep that from turning into litter. One row per user, not one per
// user per day: GET /api/admin/settings selects every row and flattens it with
// no key filter, so a key per day would grow that payload forever, while a key
// per user is bounded by the portal roll and needs no sweep. And the row
// carries the UTC day it belongs to, so a row left from an earlier day reads
// as zero rather than as yesterday's spend.
//
// The write lands only after the model has actually answered, so a turn that
// ends in a 502 or an upstream 429 costs the client nothing. Two turns landing
// in the same millisecond can both read the same count, which costs at most one
// extra call over the cap.

const DAILY_TURN_CAP = 40
const TURN_COUNTER_PREFIX = 'ai_wizard_turns'

function turnCounterKey(userId: string): string {
  return `${TURN_COUNTER_PREFIX}:${userId}`
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** Turns already spent today. A row left over from an earlier day reads as 0. */
function turnsSpentToday(raw: string | null | undefined, today: string): number {
  if (!raw) return 0
  try {
    const parsed = JSON.parse(raw) as { day?: unknown; count?: unknown }
    if (parsed?.day !== today) return 0
    const count = typeof parsed.count === 'number' ? parsed.count : 0
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  } catch {
    return 0
  }
}

function turnCounterValue(day: string, count: number): string {
  return JSON.stringify({ day, count })
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a request-drafting assistant for clients of Tahi Studio. You help the user turn a rough idea into a clear request they can submit to the Tahi team.

BRAND VOICE:
- Direct, warm, and human. Get to the point without being blunt.
- No filler phrases like "I'd be happy to" or "Great question!"
- Use contractions (we're, you'll, it's). Short sentences.
- NEVER use em dashes or en dashes. Use commas, colons, full stops, or restructure.
- NZ English spelling (colour, organise, centre).

YOU ARE SPEAKING TO A CLIENT (NOT INTERNAL TAHI STAFF):
- Never mention pricing, hour estimates, plan tiers, or internal tracks.
- Never refer to "tasks", they are "requests" from the client's side.
- Never say things like "our team will", "we'll get the designer on this", or anything that assumes internal staffing decisions. Just help scope the work.
- If the client asks about cost or timeline, tell them the Tahi team will follow up once the request is submitted.

REQUEST TYPES (internal labels, not shown to the user verbatim):
- small_task: takes a day or less.
- large_task: 1+ weeks.
- bug_fix: something that stopped working.
- new_feature: a genuinely new capability.

CATEGORIES (shown to the user as labels):
- design: mockups, layouts, visuals, graphics, brand assets, presentations, Figma work.
- development: Webflow builds, code changes, integrations, bug fixes, CMS work.
- content: blog posts, copy, newsletters, case studies.
- strategy: audits, roadmaps, competitor research, conversion planning.

YOUR JOB:
1. When the user describes what they need, ask 2-3 focused questions to scope it properly: what specifically they want delivered, which pages or sections are affected, any assets they'll provide, and deadline.
2. Once you have enough detail (usually 1-2 rounds), draft one or more requests.
3. If the user describes multiple separate things, split into separate requests.
4. Write titles under 60 characters, in the user's voice. Write descriptions as if the user could submit them unchanged.

OUTPUT FORMAT:
Still gathering info: natural conversational reply.
Ready to draft: include a JSON block wrapped in <requests> tags at the END of your response.

Example:
Here's a draft of your request. Review it and let me know if anything needs tweaking.

<requests>
[
  {
    "title": "Redesign homepage hero section",
    "description": "Replace the current hero image and headline. New image and CTA copy provided separately. Design mockup first, then build.",
    "category": "design",
    "type": "small_task",
    "estimatedHours": 8,
    "priority": "standard"
  }
]
</requests>

RULES:
- category must be one of: design, development, content, strategy.
- type must be one of: small_task, large_task, bug_fix, new_feature.
- priority: "standard" by default, "high" ONLY when the client explicitly says urgent, ASAP, or sets a tight deadline within a week.
- estimatedHours must be a positive integer.
- Title under 60 characters, no filler like "I need you to" or "please help with".
- Description should sound like the client wrote it.
- Never use em dashes or en dashes.`

// ── Claude Haiku integration ──────────────────────────────────────────────────

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>
}

async function callClaudeHaiku(
  messages: AnthropicMessage[],
  systemPrompt: string,
  contextNote: string,
): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const fullSystem = contextNote
    ? `${systemPrompt}\n\nCONTEXT: ${contextNote}`
    : systemPrompt

  const response = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1024,
    system: fullSystem,
    messages,
  }) as AnthropicResponse

  const textBlock = response.content.find(
    (block: { type: string; text?: string }) => block.type === 'text',
  )
  return textBlock?.text ?? ''
}

function parseRequestsFromResponse(text: string): { reply: string; requests: RequestDraft[] } {
  const match = text.match(/<requests>([\s\S]*?)<\/requests>/)
  if (!match) {
    return { reply: text.trim(), requests: [] }
  }
  const reply = text.slice(0, text.indexOf('<requests>')).trim()
  try {
    const parsed = JSON.parse(match[1]) as Array<Partial<RequestDraft>>
    if (!Array.isArray(parsed)) {
      return { reply: text.replace(/<requests>[\s\S]*?<\/requests>/, '').trim(), requests: [] }
    }
    const CATEGORIES = ['design', 'development', 'content', 'strategy'] as const
    const TYPES = ['small_task', 'large_task', 'bug_fix', 'new_feature'] as const
    const PRIORITIES = ['standard', 'high'] as const
    const requests: RequestDraft[] = parsed.map(r => ({
      id: generateId(),
      title: (typeof r.title === 'string' ? r.title : 'New request').slice(0, 60),
      description: typeof r.description === 'string' ? r.description : '',
      category: (CATEGORIES as readonly string[]).includes(r.category as string)
        ? r.category as RequestDraft['category']
        : 'design',
      type: (TYPES as readonly string[]).includes(r.type as string)
        ? r.type as RequestDraft['type']
        : 'small_task',
      priority: (PRIORITIES as readonly string[]).includes(r.priority as string)
        ? r.priority as RequestDraft['priority']
        : 'standard',
      estimatedHours: typeof r.estimatedHours === 'number' ? r.estimatedHours : 8,
    }))
    return { reply, requests }
  } catch {
    return { reply: text.replace(/<requests>[\s\S]*?<\/requests>/, '').trim(), requests: [] }
  }
}

// ── Deterministic fallback (identical shape to the admin endpoint) ───────────

const CATEGORY_KEYWORDS: Record<RequestDraft['category'], string[]> = {
  design: ['design', 'redesign', 'ui', 'ux', 'mockup', 'wireframe', 'logo', 'brand', 'figma', 'layout', 'visual', 'hero', 'illustration', 'graphic', 'icon', 'banner'],
  development: ['develop', 'build', 'code', 'implement', 'feature', 'bug', 'fix', 'webflow', 'api', 'database', 'integration', 'deploy', 'form', 'checkout', 'login', 'module', 'component', 'responsive', 'performance', 'speed', 'migration', 'cms'],
  content: ['content', 'copy', 'blog', 'write', 'article', 'newsletter', 'email', 'caption', 'script', 'headline', 'tagline', 'case study'],
  strategy: ['strategy', 'plan', 'roadmap', 'audit', 'review', 'analysis', 'research', 'competitor', 'growth', 'funnel', 'conversion', 'campaign', 'launch'],
}

function detectCategory(text: string): RequestDraft['category'] | null {
  const lower = text.toLowerCase()
  let best: RequestDraft['category'] | null = null
  let bestScore = 0
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS) as Array<[RequestDraft['category'], string[]]>) {
    let score = 0
    for (const kw of keywords) if (lower.includes(kw)) score++
    if (score > bestScore) { bestScore = score; best = category }
  }
  return bestScore > 0 ? best : null
}

function detectType(text: string): RequestDraft['type'] {
  const lower = text.toLowerCase()
  if (/\bbug\b|broken|not working|error|fix/.test(lower) && !/new/.test(lower)) return 'bug_fix'
  if (/new feature|build out|launch|ship|create a/.test(lower)) return 'new_feature'
  const largeWords = ['redesign', 'overhaul', 'rebuild', 'migration', 'full', 'entire', 'multi-page', 'multi page', 'complete']
  for (const w of largeWords) if (lower.includes(w)) return 'large_task'
  return 'small_task'
}

function detectPriority(text: string): RequestDraft['priority'] {
  const lower = text.toLowerCase()
  if (/urgent|asap|emergency|critical|today|tomorrow/.test(lower)) return 'high'
  return 'standard'
}

function estimateHours(category: RequestDraft['category'], type: RequestDraft['type']): number {
  const isLarge = type === 'large_task' || type === 'new_feature'
  const estimates: Record<RequestDraft['category'], { small: number; large: number }> = {
    design:      { small: 8,  large: 32 },
    development: { small: 12, large: 46 },
    content:     { small: 6,  large: 18 },
    strategy:    { small: 6,  large: 23 },
  }
  return estimates[category][isLarge ? 'large' : 'small']
}

function generateTitle(text: string, category: RequestDraft['category']): string {
  const firstSentence = text.split(/[.!?\n]/)[0].trim()
  const cleaned = firstSentence
    .replace(/^(i need|we need|i want|we want|can you|could you|please|i'd like|we'd like)\s+/i, '')
    .replace(/^(to|a|an|the)\s+/i, '')
  const capitalised = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  const truncated = capitalised.length > 60 ? capitalised.slice(0, 57) + '...' : capitalised
  return truncated || `New ${category} request`
}

function handleDeterministic(messages: WizardMessage[]): WizardResponse {
  const userMessages = messages.filter(m => m.role === 'user')
  const allText = userMessages.map(m => m.content).join(' ')
  const latest = userMessages[userMessages.length - 1]?.content ?? ''
  const conversationLength = messages.length

  const category = detectCategory(allText)

  if (conversationLength <= 1) {
    if (!category) {
      return {
        reply: [
          `Let\u2019s scope your request. Could you tell me a bit more about what you\u2019re after?`,
          '',
          `Some examples:`,
          `- "Redesign our homepage hero for the new product launch"`,
          `- "Fix the broken signup form on /register"`,
          `- "Write 4 blog posts about our new features"`,
        ].join('\n'),
        done: false,
      }
    }
    const prompts: Record<RequestDraft['category'], string> = {
      design: `Got it. A couple of questions:\n\n1. What\u2019s the specific deliverable (mockup, graphic, visual refresh)?\n2. Which pages or sections does it affect?\n3. Any deadline?`,
      development: `OK. A few questions:\n\n1. Is this a new feature, a change to something existing, or a bug fix?\n2. Which area of the site does it affect?\n3. Is there a deadline?`,
      content: `Let me understand:\n\n1. What type of content (blog post, email, landing page copy)?\n2. Who\u2019s the audience?\n3. Rough length?`,
      strategy: `Let\u2019s shape it:\n\n1. What\u2019s the goal (more conversions, a new launch, more traffic)?\n2. Any existing data to work from?\n3. Timeframe?`,
    }
    return { reply: prompts[category], done: false }
  }

  const resolvedCategory: RequestDraft['category'] = category ?? 'design'
  const type = detectType(allText)
  const priority = detectPriority(allText)

  const draft: RequestDraft = {
    id: generateId(),
    title: generateTitle(latest || allText, resolvedCategory),
    description: buildDescription(allText),
    category: resolvedCategory,
    type,
    estimatedHours: estimateHours(resolvedCategory, type),
    priority,
  }
  return {
    reply: `Here\u2019s the request I\u2019ve drafted based on what you\u2019ve said. Review it and tweak anything, then submit.`,
    requests: [draft],
    done: true,
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  // Portal-only: authenticated client, NOT the Tahi admin org.
  if (!userId || !orgId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  // A client denied Requests cannot draft one either. `orgId` here is the raw
  // Clerk org (getRequestAuth); resolvePermissions normalises it to the D1 id.
  const featureDenied = await requirePortalFeature({ userId, orgId, clerkOrgId: orgId }, 'requests')
  if (featureDenied) return featureDenied

  let body: WizardBody
  try {
    body = (await req.json()) as WizardBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { messages, context } = body
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'Messages array is required' }, { status: 400 })
  }
  for (const msg of messages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string') {
      return NextResponse.json({ error: 'Each message must have a role and content string' }, { status: 400 })
    }
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      return NextResponse.json({ error: 'Message role must be "user" or "assistant"' }, { status: 400 })
    }
  }

  // No key configured. In production that is a broken deploy, and a 200 that
  // answers forever from a regex hides it from the logs and from monitoring, so
  // it fails loudly there. Local dev keeps the keyword draft, flagged degraded
  // and labelled on screen, so the wizard is still workable without a key.
  if (!process.env.ANTHROPIC_API_KEY) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(AI_UNAVAILABLE, { status: 503 })
    }
    return NextResponse.json({ ...handleDeterministic(messages), ...DEGRADED })
  }

  // Read the brake before the call. The write happens after it, so a failed
  // turn does not spend one of the client's.
  const now = new Date()
  const today = utcDay(now)
  const counterKey = turnCounterKey(userId)
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>
  const [counter] = await drizzle
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, counterKey))
    .limit(1)
  const turnsToday = turnsSpentToday(counter?.value, today)
  if (turnsToday >= DAILY_TURN_CAP) {
    return NextResponse.json(
      {
        error: "You have reached today's limit for AI drafting. Write the request yourself, or try again later.",
        reason: 'ai_daily_cap',
      },
      { status: 429 },
    )
  }
  const recordTurn = async () => {
    const value = turnCounterValue(today, turnsToday + 1)
    const stamp = now.toISOString()
    await drizzle
      .insert(schema.settings)
      .values({ key: counterKey, value, updatedAt: stamp })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: stamp } })
  }

  const contextNote = context?.planType
    ? `The client's plan is "${context.planType}". Do not mention this to the user.`
    : ''

  try {
    const anthropicMessages: AnthropicMessage[] = messages.map(m => ({ role: m.role, content: m.content }))
    const responseText = await callClaudeHaiku(anthropicMessages, SYSTEM_PROMPT, contextNote)
    // Empty text is a failed call, not an answer. Say so rather than handing a
    // client a keyword draft under the model's name.
    if (!responseText) return NextResponse.json(AI_UNAVAILABLE, { status: 502 })
    // The model answered, so the turn counts. A counter row that fails to write
    // is not worth losing the answer over: the cap is a brake, not a gate, and
    // the catch below would otherwise turn a good reply into a 502.
    await recordTurn().catch(err => console.error('AI wizard turn counter write failed:', err))
    const { reply, requests } = parseRequestsFromResponse(responseText)
    const response: WizardResponse = {
      reply: reply || 'Could you tell me a bit more about what you need?',
      done: requests.length > 0,
      ...(requests.length > 0 ? { requests } : {}),
    }
    return NextResponse.json(response)
  } catch (err: unknown) {
    console.error('Claude Haiku API error:', err)
    if (err instanceof Error && 'status' in err) {
      const statusErr = err as Error & { status: number }
      if (statusErr.status === 429) return NextResponse.json(AI_RATE_LIMITED, { status: 429 })
    }
    return NextResponse.json(AI_UNAVAILABLE, { status: 502 })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'draft_'
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

function buildDescription(text: string): string {
  const sentences = text.split(/[.!?]/).map(s => s.trim()).filter(Boolean)
  const desc = sentences
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('. ')
  return desc.length > 500 ? desc.slice(0, 497) + '...' : desc + '.'
}
