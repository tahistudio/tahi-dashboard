import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, lt, not, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// ── Types ─────────────────────────────────────────────────────────────────────

interface BriefingItem {
  category: 'invoice' | 'request' | 'health' | 'pipeline' | 'capacity' | 'task'
  priority: 'high' | 'medium' | 'low'
  title: string
  detail: string
  action?: string
  href?: string
}

interface BriefingResponse {
  generatedAt: string
  todayItems: BriefingItem[]
  weekItems: BriefingItem[]
  summary: string
}

// ── GET: return cached briefing if fresh ────────────────────────────────────

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db()
  const cached = await database.select()
    .from(schema.settings)
    .where(eq(schema.settings.key, 'ai_briefing_latest'))
    .limit(1)

  if (cached.length > 0 && cached[0].value) {
    try {
      const data = JSON.parse(cached[0].value) as BriefingResponse
      const generatedAt = new Date(data.generatedAt)
      const hoursAgo = (Date.now() - generatedAt.getTime()) / (1000 * 60 * 60)
      if (hoursAgo < 12) {
        return NextResponse.json(data)
      }
    } catch {
      // stale or corrupt, fall through
    }
  }

  return NextResponse.json({ stale: true, generatedAt: null })
}

// ── POST: generate a fresh briefing ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Gather data from internal APIs using direct DB queries for speed
    const database = await db()
    const now = new Date()
    const todayIso = now.toISOString().split('T')[0]
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const daysAgo14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()

    // 1. Overdue invoices (sent but past due date, not paid)
    const overdueInvoices = await database.select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      amountUsd: schema.invoices.amountUsd,
      dueDate: schema.invoices.dueDate,
      status: schema.invoices.status,
    }).from(schema.invoices)
      .where(and(
        eq(schema.invoices.status, 'overdue'),
      ))
      .limit(10)

    // 2. Stagnant requests (in_progress or in_review, no update in 7+ days)
    const stagnantRequests = await database.select({
      id: schema.requests.id,
      title: schema.requests.title,
      status: schema.requests.status,
      orgId: schema.requests.orgId,
      updatedAt: schema.requests.updatedAt,
    }).from(schema.requests)
      .where(and(
        inArray(schema.requests.status, ['in_progress', 'in_review', 'client_review']),
        lt(schema.requests.updatedAt, daysAgo14),
      ))
      .limit(10)

    // 3. Active organisations with health data
    const clients = await database.select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      healthStatus: schema.organisations.healthStatus,
      healthNote: schema.organisations.healthNote,
      status: schema.organisations.status,
    }).from(schema.organisations)
      .where(eq(schema.organisations.status, 'active'))

    // 4. Open deals (join with pipeline stages to filter out closed)
    const allDeals = await database.select({
      id: schema.deals.id,
      title: schema.deals.title,
      value: schema.deals.value,
      expectedCloseDate: schema.deals.expectedCloseDate,
      stageId: schema.deals.stageId,
      stageName: schema.pipelineStages.name,
      isClosedWon: schema.pipelineStages.isClosedWon,
      isClosedLost: schema.pipelineStages.isClosedLost,
    }).from(schema.deals)
      .leftJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
      .limit(20)

    const deals = allDeals.filter(d => !d.isClosedWon && !d.isClosedLost)

    // 5. Tasks due soon
    const tasksDueSoon = await database.select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      dueDate: schema.tasks.dueDate,
      priority: schema.tasks.priority,
      status: schema.tasks.status,
    }).from(schema.tasks)
      .where(and(
        not(inArray(schema.tasks.status, ['done', 'cancelled'])),
        lt(schema.tasks.dueDate, weekFromNow),
      ))
      .orderBy(schema.tasks.dueDate)
      .limit(15)

    // 6. Team capacity
    const teamMembers = await database.select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      weeklyCapacityHours: schema.teamMembers.weeklyCapacityHours,
    }).from(schema.teamMembers)

    // Build context for AI
    const context = buildBriefingContext({
      overdueInvoices,
      stagnantRequests,
      clients,
      deals,
      tasksDueSoon,
      teamMembers,
      todayIso,
      weekFromNow,
    })

    // Call Claude Sonnet
    const briefingText = await callClaudeSonnet(context)

    // Parse structured response
    const briefing = parseBriefingResponse(briefingText)

    // Cache it
    const existing = await database.select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'ai_briefing_latest'))
      .limit(1)

    const cacheValue = JSON.stringify(briefing)
    if (existing.length > 0) {
      await database.update(schema.settings)
        .set({ value: cacheValue, updatedAt: now.toISOString() })
        .where(eq(schema.settings.key, 'ai_briefing_latest'))
    } else {
      await database.insert(schema.settings).values({
        key: 'ai_briefing_latest',
        value: cacheValue,
        updatedAt: now.toISOString(),
      })
    }

    return NextResponse.json(briefing)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: 'Failed to generate briefing', detail: message }, { status: 500 })
  }
}

// ── Build context string ────────────────────────────────────────────────────

function buildBriefingContext(data: {
  overdueInvoices: Array<{ id: string; orgId: string; amountUsd: number | null; dueDate: string | null; status: string }>
  stagnantRequests: Array<{ id: string; title: string; status: string; orgId: string; updatedAt: string }>
  clients: Array<{ id: string; name: string; healthStatus: string | null; healthNote: string | null; status: string }>
  deals: Array<{ id: string; title: string; value: number | null; expectedCloseDate: string | null; stageId: string | null; stageName: string | null }>
  tasksDueSoon: Array<{ id: string; title: string; dueDate: string | null; priority: string | null; status: string }>
  teamMembers: Array<{ id: string; name: string; weeklyCapacityHours: number | null }>
  todayIso: string
  weekFromNow: string
}): string {
  const lines: string[] = []
  lines.push(`Today: ${data.todayIso}`)
  lines.push(`Week end: ${data.weekFromNow}`)
  lines.push('')

  // Overdue invoices
  lines.push(`## Overdue Invoices (${data.overdueInvoices.length})`)
  if (data.overdueInvoices.length === 0) {
    lines.push('None')
  } else {
    for (const inv of data.overdueInvoices) {
      const client = data.clients.find(c => c.id === inv.orgId)
      const daysPast = inv.dueDate ? Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24)) : 0
      lines.push(`- $${inv.amountUsd ?? 0} for ${client?.name ?? 'Unknown'} - ${daysPast} days overdue (due ${inv.dueDate ?? 'unknown'})`)
    }
  }
  lines.push('')

  // Stagnant requests
  lines.push(`## Stagnant Requests - no update in 14+ days (${data.stagnantRequests.length})`)
  if (data.stagnantRequests.length === 0) {
    lines.push('None')
  } else {
    for (const req of data.stagnantRequests) {
      const client = data.clients.find(c => c.id === req.orgId)
      const daysStale = Math.floor((Date.now() - new Date(req.updatedAt).getTime()) / (1000 * 60 * 60 * 24))
      lines.push(`- "${req.title}" (${req.status}) for ${client?.name ?? 'Unknown'} - ${daysStale} days since last update`)
    }
  }
  lines.push('')

  // Client health
  const unhealthyClients = data.clients.filter(c => c.healthStatus === 'amber' || c.healthStatus === 'red')
  lines.push(`## Client Health Concerns (${unhealthyClients.length})`)
  if (unhealthyClients.length === 0) {
    lines.push('All clients green')
  } else {
    for (const c of unhealthyClients) {
      lines.push(`- ${c.name}: ${c.healthStatus}${c.healthNote ? ` - ${c.healthNote}` : ''}`)
    }
  }
  lines.push('')

  // Pipeline deals
  lines.push(`## Open Pipeline Deals (${data.deals.length})`)
  for (const d of data.deals.slice(0, 10)) {
    lines.push(`- "${d.title}" $${d.value ?? 0} - stage: ${d.stageName ?? 'unknown'} - close date: ${d.expectedCloseDate ?? 'none set'}`)
  }
  lines.push('')

  // Tasks due
  lines.push(`## Tasks Due This Week (${data.tasksDueSoon.length})`)
  for (const t of data.tasksDueSoon) {
    lines.push(`- "${t.title}" due ${t.dueDate ?? 'unknown'} - ${t.priority ?? 'standard'} priority - status: ${t.status}`)
  }
  lines.push('')

  // Team capacity
  const totalCap = data.teamMembers.reduce((s, m) => s + (m.weeklyCapacityHours ?? 0), 0)
  lines.push(`## Team (${data.teamMembers.length} members, ${totalCap}h weekly capacity)`)
  for (const m of data.teamMembers) {
    lines.push(`- ${m.name}: ${m.weeklyCapacityHours ?? 0}h capacity`)
  }

  return lines.join('\n')
}

// ── Call Claude Sonnet ──────────────────────────────────────────────────────

async function callClaudeSonnet(context: string): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const systemPrompt = `You are the daily briefing assistant for Tahi Studio, a digital agency that manages client retainers, projects, and tasks through a custom dashboard.

Your job is to analyze the business data provided and produce a structured daily briefing. Focus on what NEEDS ATTENTION, not what is fine.

Rules:
- Be concise and actionable. Each item should be 1-2 sentences max.
- Prioritize by business impact: revenue risk > client health > deadlines > capacity
- For "today" items: things that need action in the next 24 hours
- For "this week" items: things to plan for or keep an eye on
- Invoices over 28 days overdue need manual follow-up - flag these as high priority
- Stagnant requests (14+ days no update) suggest a process issue - flag them
- Clients with red/amber health need proactive outreach
- Deals without close dates are pipeline hygiene issues - mention if any
- Team members over 85% utilization are at risk of burnout
- Large tasks with far due dates but no progress need to be started early

Output format - respond with ONLY this XML structure, no other text:
<briefing>
<summary>One sentence overview of today's priorities</summary>
<today>
<item category="invoice|request|health|pipeline|capacity|task" priority="high|medium|low">
<title>Short title</title>
<detail>Explanation and recommended action</detail>
</item>
</today>
<week>
<item category="invoice|request|health|pipeline|capacity|task" priority="high|medium|low">
<title>Short title</title>
<detail>Explanation and recommended action</detail>
</item>
</week>
</briefing>

If there are no items for today or this week, include an empty <today></today> or <week></week> tag.
Maximum 5 items for today, 8 items for this week.`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: context }],
  })

  const textBlock = response.content.find(
    (block) => block.type === 'text'
  )
  return (textBlock && 'text' in textBlock) ? textBlock.text : ''
}

// ── Parse XML response ──────────────────────────────────────────────────────

function parseBriefingResponse(text: string): BriefingResponse {
  const summary = text.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim() ?? 'No briefing available'

  const parseItems = (section: string): BriefingItem[] => {
    const sectionMatch = text.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))
    if (!sectionMatch) return []

    const items: BriefingItem[] = []
    const itemRegex = /<item\s+category="([^"]*?)"\s+priority="([^"]*?)">\s*<title>([\s\S]*?)<\/title>\s*<detail>([\s\S]*?)<\/detail>\s*<\/item>/g
    let match
    while ((match = itemRegex.exec(sectionMatch[1])) !== null) {
      items.push({
        category: match[1] as BriefingItem['category'],
        priority: match[2] as BriefingItem['priority'],
        title: match[3].trim(),
        detail: match[4].trim(),
      })
    }
    return items
  }

  return {
    generatedAt: new Date().toISOString(),
    todayItems: parseItems('today'),
    weekItems: parseItems('week'),
    summary,
  }
}
