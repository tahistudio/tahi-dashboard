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

// ── Category detection ────────────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  design: [
    'design', 'ui', 'ux', 'mockup', 'wireframe', 'logo', 'brand', 'graphic',
    'figma', 'layout', 'visual', 'icon', 'banner', 'hero', 'illustration',
    'thumbnail', 'poster', 'flyer', 'infographic', 'presentation',
  ],
  development: [
    'develop', 'build', 'code', 'implement', 'feature', 'bug', 'fix',
    'website', 'app', 'api', 'database', 'integration', 'deploy', 'page',
    'form', 'checkout', 'login', 'plugin', 'module', 'component',
    'responsive', 'mobile', 'performance', 'speed', 'migration',
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

// ── Category-specific follow-up questions ─────────────────────────────────────

const FOLLOW_UP_QUESTIONS: Record<string, string> = {
  design: [
    'I can help with that design work. A few questions to scope it properly:',
    '',
    '1. What is the specific deliverable? (e.g. web page mockup, social graphics, logo variations)',
    '2. Do you have brand guidelines or existing assets I should know about?',
    '3. What is the timeline - is there a deadline?',
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
    'SEO work - great. Let me understand the scope:',
    '',
    '1. Is this a site audit, keyword optimization, or technical SEO fix?',
    '2. Which pages or sections are the priority?',
    '3. Are there specific keywords or competitors you are targeting?',
  ].join('\n'),
  strategy: [
    'Strategy and planning - I can help structure that. A few questions:',
    '',
    '1. What is the goal? (increase conversions, launch a product, grow traffic)',
    '2. Do you have existing data or analytics to work from?',
    '3. What is the timeframe for implementation?',
  ].join('\n'),
}

// ── Estimate hours by category and size ───────────────────────────────────────

function estimateHours(category: string, size: 'small' | 'large'): number {
  const estimates: Record<string, Record<string, number>> = {
    design:      { small: 6,  large: 20 },
    development: { small: 8,  large: 32 },
    content:     { small: 4,  large: 12 },
    seo:         { small: 6,  large: 16 },
    strategy:    { small: 4,  large: 16 },
  }
  return estimates[category]?.[size] ?? (size === 'large' ? 16 : 6)
}

// ── Generate task title from description ──────────────────────────────────────

function generateTitle(text: string, category: string): string {
  // Take the first meaningful sentence, truncate to a reasonable title
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

// ── Main handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/admin/ai/task-wizard
 *
 * Conversational task creation wizard.
 * Currently uses deterministic heuristics (no external AI API).
 * Returns follow-up questions or generated task drafts.
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

  // Gather all user messages to build context
  const userMessages = messages.filter(m => m.role === 'user')
  const allUserText = userMessages.map(m => m.content).join(' ')
  const latestUserMessage = userMessages[userMessages.length - 1]?.content ?? ''
  const conversationLength = messages.length

  // Detect category from all user input
  const category = detectCategory(allUserText)

  // First user message: detect category and ask follow-ups
  if (conversationLength <= 1 && category) {
    const followUp = FOLLOW_UP_QUESTIONS[category]
    if (followUp) {
      const response: WizardResponse = {
        reply: followUp,
        done: false,
      }
      return NextResponse.json(response)
    }
  }

  // First user message but no category detected
  if (conversationLength <= 1 && !category) {
    const response: WizardResponse = {
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
    return NextResponse.json(response)
  }

  // Subsequent messages: we have enough context to generate tasks
  const resolvedCategory = category ?? 'design'
  const size = context.trackType === 'small' || context.trackType === 'large'
    ? context.trackType as 'small' | 'large'
    : detectSize(allUserText)
  const priority = detectPriority(allUserText)
  const isMulti = detectMultipleTasks(allUserText)

  const tasks: TaskDraft[] = []

  if (isMulti) {
    // Try to split on conjunctions and commas to create multiple tasks
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

  // If we did not generate multiple tasks, create a single one
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

  const response: WizardResponse = {
    reply: `${taskSummary}${trackNote}\n\nReview the details below and click "Create Tasks" when everything looks good. You can also edit any task before creating.`,
    tasks,
    done: true,
  }

  return NextResponse.json(response)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  // Simple ID for draft tasks (not persisted yet)
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'draft_'
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function buildDescription(text: string): string {
  // Clean up user text into a reasonable description
  const sentences = text.split(/[.!?]/).map(s => s.trim()).filter(Boolean)
  const desc = sentences
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
    .join('. ')

  return desc.length > 500 ? desc.slice(0, 497) + '...' : desc + '.'
}
