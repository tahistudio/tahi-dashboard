/**
 * POST /api/admin/ai/request-wizard
 *
 * Conversational request-drafting wizard. Same shape as the task wizard
 * but tuned for client-facing requests: shorter titles, plain-English
 * descriptions the client will actually read, and the request-specific
 * type enum (small_task | large_task | bug_fix | new_feature).
 *
 * Decision #048 (2026-04-21): AI help is now on both tasks and requests.
 * Clients see this through the portal (Phase 2); admins use it when
 * drafting requests on behalf of a client.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

interface WizardMessage {
  role: 'user' | 'assistant'
  content: string
}

interface WizardContext {
  orgId?: string
  /** Whose voice is drafting: 'client' (portal) or 'admin' (internal-on-behalf-of). */
  speaker?: 'client' | 'admin'
  /** The client org's plan, so we can nudge track sizing appropriately. */
  planType?: string
}

interface WizardBody {
  messages: WizardMessage[]
  context: WizardContext
}

interface RequestDraft {
  id: string
  title: string
  /** Plain description. The caller is responsible for converting to Tiptap
   *  JSON when it actually submits the request. */
  description: string
  category: 'design' | 'development' | 'content' | 'strategy'
  type: 'small_task' | 'large_task' | 'bug_fix' | 'new_feature'
  priority: 'standard' | 'high'
  estimatedHours: number
}

interface WizardResponse {
  reply: string
  requests?: RequestDraft[]
  done: boolean
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a request-drafting assistant for Tahi Studio, a Webflow design and development agency. You help users turn a rough idea into a well-scoped work request that is easy for the Tahi team to action.

BRAND VOICE:
- Direct, warm, and human. Get to the point without being blunt.
- Confident recommendations. Lead with your suggestion, then offer alternatives.
- No filler phrases like "I'd be happy to" or "Great question!" Just respond naturally.
- Use contractions (we're, you'll, it's). Short sentences. Vary length for rhythm.
- NEVER use em dashes or en dashes. Use commas, colons, full stops, or restructure the sentence instead.
- NZ English spelling (colour, organise, centre).

REQUESTS VS TASKS (important):
- Requests are client-facing work items. The client sees the title, description, status, and comments.
- Tasks are internal to Tahi (clients never see them). Do not mention tasks to the user.
- This wizard creates REQUESTS only.

REQUEST TYPES:
- small_task: takes a day or less. Section updates, copy tweaks, small design edits, bug fixes.
- large_task: 1+ weeks. Full page builds, redesigns, SEO overhauls, CMS restructures.
- bug_fix: something that used to work and doesn't anymore. Map to small_task sizing unless complex.
- new_feature: a genuinely new capability. Usually large_task.

CATEGORIES:
- design: UI/UX, page mockups, graphics, icons, brand assets, presentations, visual redesigns, layout changes, Figma work, wireframes, style guides.
- development: Webflow builds (after design is approved), code, integrations, bug fixes, features, migrations, performance, CMS setup, custom code.
- content: Blog posts, copy, newsletters, email sequences, case studies, scripts.
- strategy: Roadmaps, audits, competitor analysis, conversion funnels, growth planning, campaign planning.

CATEGORY RULES:
- Visual redesign, mockup, and layout work is ALWAYS "design". Webflow build/implementation is "development".
- For redesign + rebuild projects, create a "design" request first with a note that development follows after design approval. If it's genuinely one tight package, suggest splitting into two requests.

HOUR ESTIMATES (baselines, adjust for complexity):
- design small: 6-12 | design large: 24-40
- development small: 8-16 | development large: 32-60
- content small: 4-8 | content large: 12-24
- strategy small: 4-8 | strategy large: 16-30

YOUR JOB:
1. When the user describes what they need, ask 2-3 smart follow-up questions to scope properly: specific deliverable, affected pages/sections, available assets, deadline.
2. Once you have enough detail (usually 1-2 follow-up rounds), generate one or more request drafts.
3. If the user describes multiple distinct deliverables, split into separate requests. Don't lump unrelated work into one request.
4. For each request, provide a short title (under 60 chars, no filler like "I need to" or "please help with") and an actionable description written in the user's voice.

OUTPUT FORMAT:
Still gathering information: respond with a natural conversational message and focused questions.

Ready to generate requests: include a JSON block wrapped in <requests> tags at the END of your response. The JSON must be a valid array of request objects.

Example:
Here's what I've drafted based on your description. Have a look and let me know if anything needs tweaking.

<requests>
[
  {
    "title": "Redesign homepage hero section",
    "description": "Replace the current hero image and headline. New image and CTA copy to be provided. Design mockup needed first before build.",
    "category": "design",
    "type": "small_task",
    "estimatedHours": 8,
    "priority": "standard"
  }
]
</requests>

RULES:
- estimatedHours must be a number (integer).
- category must be one of: design, development, content, strategy.
- type must be one of: small_task, large_task, bug_fix, new_feature.
- priority must be "standard" or "high". Map urgent/ASAP/deadline-today to "high". Default is "standard".
- Title under 60 characters, no filler phrases.
- Description should read as something the user could edit and submit as-is.
- When generating requests, your reply should briefly summarise what you've drafted.
- Never use em dashes or en dashes in titles, descriptions, or replies.`

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
    model: 'claude-haiku-4-5-20251001',
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

// ── Deterministic fallback ────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<RequestDraft['category'], string[]> = {
  design: ['design', 'redesign', 'ui', 'ux', 'mockup', 'wireframe', 'logo', 'brand', 'figma', 'layout', 'visual', 'hero', 'illustration', 'graphic', 'icon', 'banner', 'style guide', 'colour palette', 'color palette'],
  development: ['develop', 'build', 'code', 'implement', 'feature', 'bug', 'fix', 'webflow', 'api', 'database', 'integration', 'deploy', 'form', 'checkout', 'login', 'module', 'component', 'responsive', 'performance', 'speed', 'migration', 'cms'],
  content: ['content', 'copy', 'blog', 'write', 'article', 'newsletter', 'email', 'caption', 'script', 'headline', 'tagline', 'case study', 'whitepaper'],
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
          `Let's get this scoped. Could you tell me a bit more about what you need?`,
          '',
          'A couple of examples:',
          '- "Redesign our homepage hero for the new product launch"',
          '- "Fix the broken signup form on /register"',
          '- "Write 4 blog posts about our new features"',
          '- "Run an SEO audit on the marketing site"',
        ].join('\n'),
        done: false,
      }
    }
    const prompts: Record<RequestDraft['category'], string> = {
      design: [
        `Got it. A few questions to scope the design work:`,
        ``,
        `1. What's the specific deliverable? (mockup, graphic, brand refresh, etc.)`,
        `2. Which pages or sections does it affect?`,
        `3. Any deadline?`,
      ].join('\n'),
      development: [
        `OK. A couple of questions:`,
        ``,
        `1. Is this a new feature, a change to something existing, or a bug fix?`,
        `2. Which area of the site does this affect?`,
        `3. Is there a deadline?`,
      ].join('\n'),
      content: [
        `Let me understand the content work:`,
        ``,
        `1. What type of content (blog post, email, landing page copy, social)?`,
        `2. Who's the target audience?`,
        `3. Rough length or word count?`,
      ].join('\n'),
      strategy: [
        `Let's shape the strategy work:`,
        ``,
        `1. What's the goal (more conversions, new launch, more traffic)?`,
        `2. Any existing data or analytics to work from?`,
        `3. Timeframe?`,
      ].join('\n'),
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
    reply: `Here's the request I've drafted. Review and tweak anything, then submit.`,
    requests: [draft],
    done: true,
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  // Deterministic fallback when API key is absent.
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(handleDeterministic(messages))
  }

  const contextParts: string[] = []
  if (context?.speaker === 'admin') contextParts.push(`The speaker is a Tahi team member drafting on behalf of a client.`)
  if (context?.speaker === 'client') contextParts.push(`The speaker is the client themselves.`)
  if (context?.planType) contextParts.push(`The client's plan is "${context.planType}".`)
  const contextNote = contextParts.join(' ')

  try {
    const anthropicMessages: AnthropicMessage[] = messages.map(m => ({ role: m.role, content: m.content }))
    const responseText = await callClaudeHaiku(anthropicMessages, SYSTEM_PROMPT, contextNote)
    if (!responseText) return NextResponse.json(handleDeterministic(messages))
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
      if (statusErr.status === 429) return NextResponse.json(handleDeterministic(messages))
    }
    return NextResponse.json(handleDeterministic(messages))
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
