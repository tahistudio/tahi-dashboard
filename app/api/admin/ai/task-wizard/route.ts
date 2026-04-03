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
  trackType?: string
}

interface WizardBody {
  messages: WizardMessage[]
  context: WizardContext
}

interface TaskDraft {
  id: string
  title: string
  description: string
  category: string
  type: 'small' | 'large'
  estimatedHours: number
  priority: 'low' | 'medium' | 'high' | 'urgent'
}

interface WizardResponse {
  reply: string
  tasks?: TaskDraft[]
  done: boolean
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a task creation assistant for Tahi Studio, a Webflow design and development agency. You help break down client requests into well-structured tasks.

BRAND VOICE:
- Direct, warm, and human. Get to the point without being blunt.
- Confident recommendations. Lead with your suggestion, then offer alternatives.
- No filler phrases like "I'd be happy to" or "Great question!" Just respond naturally.
- Use contractions (we're, you'll, it's). Short sentences. Vary length for rhythm.
- NEVER use em dashes or en dashes. Use commas, colons, full stops, or restructure the sentence instead.
- NZ English spelling (colour, organise, centre).

SERVICE CATEGORIES:
- design: UI/UX, page mockups, graphics, icons, illustrations, brand assets, presentations, visual redesigns, layout changes, brand refresh, Figma work, wireframes, style guides
- development: Webflow builds (after design is approved), code, integrations, bug fixes, features, migrations, performance, CMS setup, custom code
- content: Blog posts, copy, newsletters, email sequences, case studies, scripts
- seo: Audits, keyword optimisation, meta tags, sitemaps, technical SEO, AEO (AI overview optimisation)
- strategy: Roadmaps, audits, competitor analysis, conversion funnels, growth planning, campaign planning

CATEGORY RULES (important):
- Visual redesign, mockup, and layout work is ALWAYS "design" category. Webflow build/implementation is "development". For full redesign projects, create design tasks first, then development tasks.
- For any redesign or new build project, ALWAYS recommend creating designs/mockups first in Figma before building in Webflow. Never suggest jumping straight into building without design approval. This is a core process at Tahi.
- When a project involves both design and development, create the design task(s) first with a note that development will follow after design approval.
- "Redesign" = design. "Rebuild" = development. "Redesign and rebuild" = design task first, then development task.

TRACK TYPES:
- small: Tasks that take up to 1 day. Quick fixes, section updates, copy changes, bug fixes, small design tweaks.
- large: Tasks that take 1+ weeks. Full page builds, redesigns, SEO overhauls, CMS restructures, multi-day integrations.

PRICING CONTEXT (internal, do not share with clients):
- Maintain plan: 1 small track running at a time. $1,500/month.
- Scale plan: 1 large track + 1 small track running simultaneously. $4,000/month.
- Hours are internal estimates only. Never mention hours or pricing to the client.

HOUR ESTIMATES (use these as baselines, adjust based on complexity):
- design small: 6-12 hours | design large: 24-40 hours
- development small: 8-16 hours | development large: 32-60 hours
- content small: 4-8 hours | content large: 12-24 hours
- seo small: 6-12 hours | seo large: 16-30 hours
- strategy small: 4-8 hours | strategy large: 16-30 hours

YOUR JOB:
1. When a user describes what they need, identify the category and ask 2-3 smart follow-up questions to scope the task properly. Questions should cover: specific deliverable, affected pages/sections, available assets, and deadline.
2. Once you have enough detail (usually after 1-2 follow-up rounds), generate task drafts.
3. If the request spans multiple categories or is clearly multiple tasks, break it into separate tasks.
4. For each task, provide a clear title and actionable description.

OUTPUT FORMAT:
When you are still gathering information, respond with a natural conversational message. Ask focused questions.

When you are ready to generate tasks, you MUST include a JSON block wrapped in <tasks> tags at the END of your response. The JSON must be a valid array of task objects. Example:

Here is what I have put together based on your description. Review the details below and let me know if anything needs adjusting.

<tasks>
[
  {
    "title": "Update homepage hero section",
    "description": "Replace the current hero image and headline. Client has provided the new image asset. Update CTA copy to match new messaging.",
    "category": "design",
    "type": "small",
    "estimatedHours": 6,
    "priority": "medium"
  }
]
</tasks>

RULES:
- Always include estimatedHours as a number (integer).
- category must be one of: design, development, content, seo, strategy.
- type must be "small" or "large".
- priority must be one of: low, medium, high, urgent.
- Title should be concise (under 60 characters).
- Description should be actionable and include key details from the conversation.
- If the user mentions urgency, ASAP, or a tight deadline, set priority to high or urgent.
- If the user says "no rush" or "whenever", set priority to low.
- Default priority is medium.
- When generating tasks, your conversational reply should summarise what you have created. Mention if any tasks are large track items.
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
  contextNote: string
): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

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
    (block: { type: string; text?: string }) => block.type === 'text'
  )
  return textBlock?.text ?? ''
}

function parseTasksFromResponse(text: string): { reply: string; tasks: TaskDraft[] } {
  const tasksMatch = text.match(/<tasks>([\s\S]*?)<\/tasks>/)

  if (!tasksMatch) {
    return { reply: text.trim(), tasks: [] }
  }

  // Extract the reply text (everything before the <tasks> block)
  const reply = text.slice(0, text.indexOf('<tasks>')).trim()

  try {
    const parsed = JSON.parse(tasksMatch[1]) as Array<{
      title: string
      description: string
      category: string
      type: 'small' | 'large'
      estimatedHours: number
      priority: 'low' | 'medium' | 'high' | 'urgent'
    }>

    if (!Array.isArray(parsed)) {
      return { reply: text.replace(/<tasks>[\s\S]*?<\/tasks>/, '').trim(), tasks: [] }
    }

    const tasks: TaskDraft[] = parsed.map((t) => ({
      id: generateId(),
      title: (t.title ?? 'New task').slice(0, 60),
      description: t.description ?? '',
      category: ['design', 'development', 'content', 'seo', 'strategy'].includes(t.category)
        ? t.category
        : 'design',
      type: t.type === 'large' ? 'large' : 'small',
      estimatedHours: typeof t.estimatedHours === 'number' ? t.estimatedHours : 6,
      priority: ['low', 'medium', 'high', 'urgent'].includes(t.priority)
        ? t.priority
        : 'medium',
    }))

    return { reply, tasks }
  } catch {
    // JSON parse failed, return the text without the tags
    return { reply: text.replace(/<tasks>[\s\S]*?<\/tasks>/, '').trim(), tasks: [] }
  }
}

// ── Deterministic fallback ────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  design: [
    'design', 'redesign', 'ui', 'ux', 'mockup', 'wireframe', 'logo', 'brand',
    'graphic', 'figma', 'layout', 'visual', 'icon', 'banner', 'hero',
    'illustration', 'thumbnail', 'poster', 'flyer', 'infographic',
    'presentation', 'style guide', 'colour palette', 'color palette',
    'brand refresh', 'look and feel', 'aesthetic', 'rebrand',
  ],
  development: [
    'develop', 'build', 'code', 'implement', 'feature', 'bug', 'fix',
    'webflow', 'app', 'api', 'database', 'integration', 'deploy',
    'form', 'checkout', 'login', 'plugin', 'module', 'component',
    'responsive', 'mobile', 'performance', 'speed', 'migration', 'cms',
  ],
  content: [
    'content', 'copy', 'blog', 'write', 'article', 'newsletter', 'email',
    'post', 'caption', 'script', 'headline', 'tagline', 'press release',
    'case study', 'whitepaper', 'ebook',
  ],
  seo: [
    'seo', 'search', 'ranking', 'keywords', 'meta', 'sitemap', 'backlink',
    'organic', 'traffic', 'audit', 'analytics', 'google', 'search engine',
  ],
  strategy: [
    'strategy', 'plan', 'roadmap', 'audit', 'consult', 'review', 'analysis',
    'research', 'competitor', 'market', 'growth', 'funnel', 'conversion',
    'campaign', 'launch',
  ],
}

function detectCategory(text: string): string | null {
  const lower = text.toLowerCase()
  let bestCategory: string | null = null
  let bestScore = 0

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0
    for (const kw of keywords) {
      if (lower.includes(kw)) score++
    }
    if (score > bestScore) {
      bestScore = score
      bestCategory = category
    }
  }

  return bestScore > 0 ? bestCategory : null
}

function detectSize(text: string): 'small' | 'large' {
  const lower = text.toLowerCase()
  const largeIndicators = [
    'complex', 'redesign', 'overhaul', 'rebuild', 'migration', 'full',
    'complete', 'entire', 'multi-page', 'multi page', 'several', 'multiple',
    'big', 'large', 'major', 'extensive', 'comprehensive', 'new website',
    'new app', 'e-commerce', 'ecommerce', 'platform', 'system',
  ]

  for (const indicator of largeIndicators) {
    if (lower.includes(indicator)) return 'large'
  }
  return 'small'
}

function detectPriority(text: string): 'low' | 'medium' | 'high' | 'urgent' {
  const lower = text.toLowerCase()
  if (lower.includes('urgent') || lower.includes('asap') || lower.includes('emergency')) return 'urgent'
  if (lower.includes('important') || lower.includes('critical') || lower.includes('rush')) return 'high'
  if (lower.includes('low priority') || lower.includes('no rush') || lower.includes('whenever')) return 'low'
  return 'medium'
}

function detectMultipleTasks(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes(' and ') || lower.includes(' plus ') ||
    lower.includes('also need') || lower.includes('as well as') ||
    lower.includes('additionally') || lower.includes('multiple') ||
    (lower.match(/,/g)?.length ?? 0) >= 2
}

const FOLLOW_UP_QUESTIONS: Record<string, string> = {
  design: [
    'I can help with that design work. A few questions to scope it properly:',
    '',
    '1. What is the specific deliverable? (e.g. web page mockup, social graphics, logo variations)',
    '2. Do you have brand guidelines or existing assets I should know about?',
    '3. What is the timeline? Is there a deadline?',
  ].join('\n'),
  development: [
    'Got it, sounds like a development task. Let me ask a few things:',
    '',
    '1. Is this a new feature, a change to something existing, or a bug fix?',
    '2. Which part of the site or app does this affect?',
    '3. Is there a deadline or is this flexible?',
  ].join('\n'),
  content: [
    'I can help plan that content work. A few questions:',
    '',
    '1. What type of content is this? (blog post, email, landing page copy, social posts)',
    '2. Who is the target audience?',
    '3. Do you have a rough word count or length in mind?',
  ].join('\n'),
  seo: [
    'SEO work. Let me understand the scope:',
    '',
    '1. Is this a site audit, keyword optimisation, or technical SEO fix?',
    '2. Which pages or sections are the priority?',
    '3. Are there specific keywords or competitors you are targeting?',
  ].join('\n'),
  strategy: [
    'Strategy and planning. Let me get a bit more detail:',
    '',
    '1. What is the goal? (increase conversions, launch a product, grow traffic)',
    '2. Do you have existing data or analytics to work from?',
    '3. What is the timeframe for implementation?',
  ].join('\n'),
}

function estimateHours(category: string, size: 'small' | 'large'): number {
  const estimates: Record<string, Record<string, number>> = {
    design:      { small: 9,  large: 32 },
    development: { small: 12, large: 46 },
    content:     { small: 6,  large: 18 },
    seo:         { small: 9,  large: 23 },
    strategy:    { small: 6,  large: 23 },
  }
  return estimates[category]?.[size] ?? (size === 'large' ? 23 : 9)
}

function generateTitle(text: string, category: string): string {
  const firstSentence = text.split(/[.!?\n]/)[0].trim()
  const cleaned = firstSentence
    .replace(/^(i need|we need|i want|we want|can you|please|i'd like|we'd like)\s+/i, '')
    .replace(/^(to|a|an|the)\s+/i, '')

  const capitalised = cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
  const truncated = capitalised.length > 60
    ? capitalised.slice(0, 57) + '...'
    : capitalised

  return truncated || `New ${category} task`
}

function handleDeterministic(messages: WizardMessage[], context: WizardContext): WizardResponse {
  const userMessages = messages.filter(m => m.role === 'user')
  const allUserText = userMessages.map(m => m.content).join(' ')
  const latestUserMessage = userMessages[userMessages.length - 1]?.content ?? ''
  const conversationLength = messages.length

  const category = detectCategory(allUserText)

  if (conversationLength <= 1 && category) {
    const followUp = FOLLOW_UP_QUESTIONS[category]
    if (followUp) {
      return { reply: followUp, done: false }
    }
  }

  if (conversationLength <= 1 && !category) {
    return {
      reply: [
        'I want to make sure I set this up correctly. Could you tell me a bit more about what you need?',
        '',
        'For example:',
        '- "I need a new landing page designed for our product launch"',
        '- "We need to fix a bug in the checkout flow"',
        '- "Write 4 blog posts about our new features"',
        '- "Run an SEO audit on our marketing site"',
      ].join('\n'),
      done: false,
    }
  }

  const resolvedCategory = category ?? 'design'
  const size = context.trackType === 'small' || context.trackType === 'large'
    ? context.trackType as 'small' | 'large'
    : detectSize(allUserText)
  const priority = detectPriority(allUserText)
  const isMulti = detectMultipleTasks(allUserText)

  const tasks: TaskDraft[] = []

  if (isMulti) {
    const parts = allUserText
      .split(/(?:,\s*(?:and\s+)?|\s+and\s+|\s+plus\s+|\s+also\s+|\s+as well as\s+)/i)
      .map(p => p.trim())
      .filter(p => p.length > 10)

    for (const part of parts) {
      const partCategory = detectCategory(part) ?? resolvedCategory
      const partSize = detectSize(part)
      tasks.push({
        id: generateId(),
        title: generateTitle(part, partCategory),
        description: part.charAt(0).toUpperCase() + part.slice(1),
        category: partCategory,
        type: partSize,
        estimatedHours: estimateHours(partCategory, partSize),
        priority,
      })
    }
  }

  if (tasks.length === 0) {
    tasks.push({
      id: generateId(),
      title: generateTitle(latestUserMessage || allUserText, resolvedCategory),
      description: buildDescription(allUserText),
      category: resolvedCategory,
      type: size,
      estimatedHours: estimateHours(resolvedCategory, size),
      priority,
    })
  }

  const taskSummary = tasks.length === 1
    ? `Here is the task I have put together based on your description:`
    : `I have broken this down into ${tasks.length} tasks:`

  const trackNote = tasks.some(t => t.type === 'large')
    ? '\n\nNote: Large track items (1+ weeks) will be queued in your large track slot.'
    : ''

  return {
    reply: `${taskSummary}${trackNote}\n\nReview the details below and click "Create Tasks" when everything looks good. You can also edit any task before creating.`,
    tasks,
    done: true,
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/ai/task-wizard
 *
 * Conversational task creation wizard powered by Claude Haiku.
 * Falls back to deterministic heuristics when ANTHROPIC_API_KEY is not set.
 */
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

  // Validate message shape
  for (const msg of messages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string') {
      return NextResponse.json({ error: 'Each message must have a role and content string' }, { status: 400 })
    }
    if (msg.role !== 'user' && msg.role !== 'assistant') {
      return NextResponse.json({ error: 'Message role must be "user" or "assistant"' }, { status: 400 })
    }
  }

  // Fall back to deterministic logic if no API key
  if (!process.env.ANTHROPIC_API_KEY) {
    const result = handleDeterministic(messages, context ?? {})
    return NextResponse.json(result)
  }

  // Build context note for the system prompt
  const contextParts: string[] = []
  if (context?.trackType) {
    contextParts.push(`The client's current track type is "${context.trackType}".`)
  }
  if (context?.orgId) {
    contextParts.push(`Client org ID: ${context.orgId}.`)
  }
  const contextNote = contextParts.join(' ')

  try {
    const anthropicMessages: AnthropicMessage[] = messages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    const responseText = await callClaudeHaiku(anthropicMessages, SYSTEM_PROMPT, contextNote)

    if (!responseText) {
      // Empty response from API, fall back
      const result = handleDeterministic(messages, context ?? {})
      return NextResponse.json(result)
    }

    const { reply, tasks } = parseTasksFromResponse(responseText)

    const response: WizardResponse = {
      reply: reply || 'Could you tell me more about what you need?',
      done: tasks.length > 0,
      ...(tasks.length > 0 ? { tasks } : {}),
    }

    return NextResponse.json(response)
  } catch (err: unknown) {
    console.error('Claude Haiku API error:', err)

    // Check for rate limiting
    if (err instanceof Error && 'status' in err) {
      const statusErr = err as Error & { status: number }
      if (statusErr.status === 429) {
        // Rate limited, fall back to deterministic
        const result = handleDeterministic(messages, context ?? {})
        return NextResponse.json(result)
      }
    }

    // For other API errors, fall back to deterministic logic
    const result = handleDeterministic(messages, context ?? {})
    return NextResponse.json(result)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'draft_'
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function buildDescription(text: string): string {
  const sentences = text.split(/[.!?]/).map(s => s.trim()).filter(Boolean)
  const desc = sentences
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('. ')

  return desc.length > 500 ? desc.slice(0, 497) + '...' : desc + '.'
}
