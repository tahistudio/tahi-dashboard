/**
 * POST /api/admin/clients/[id]/health-summary
 *
 * Admin-triggered AI health check for a single client. Gathers the org's
 * recent requests, tasks, invoices, scheduled calls and messages (scoped
 * to this org and bounded to recent rows), then asks Claude Sonnet to
 * produce a structured read on the relationship.
 *
 * HUMAN-IN-THE-LOOP: this endpoint only ever returns SUGGESTIONS. It never
 * mutates the org. The narrative + suggested health status + suggested
 * actions are rendered in a dismissible card, and a human must explicitly
 * click "Apply health status" or "Save note" (both of which PATCH the
 * existing /api/admin/clients/[id] endpoint) for anything to persist.
 *
 * The data-gathering shape mirrors lib/ai-briefing.ts buildBriefingContext,
 * narrowed to one org.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'
import { SONNET_MODEL } from '@/lib/ai-models'
import { recordCost } from '@/lib/ai-cost'

export const dynamic = 'force-dynamic'

// Bounds - keep the context small and the token spend predictable.
const REQUEST_LIMIT = 15
const TASK_LIMIT = 15
const INVOICE_LIMIT = 15
const CALL_LIMIT = 10
const MESSAGE_LIMIT = 20
const MESSAGE_SNIPPET_CHARS = 240

const VALID_HEALTH = ['green', 'amber', 'red'] as const
type HealthStatus = (typeof VALID_HEALTH)[number]

interface HealthSuggestion {
  healthNarrative: string
  riskFlags: string[]
  suggestedHealthStatus: HealthStatus
  suggestedActions: string[]
}

// ── Tiptap / plain-text extractor ────────────────────────────────────────────
// Message bodies are Tiptap JSON (or legacy plain text). Walk the doc and
// collect text nodes; fall back to the raw string. Always truncated.
function extractText(body: string): string {
  let text = ''
  try {
    const doc = JSON.parse(body) as unknown
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const n = node as { type?: string; text?: string; content?: unknown[] }
      if (n.type === 'text' && typeof n.text === 'string') text += n.text + ' '
      if (Array.isArray(n.content)) n.content.forEach(walk)
    }
    walk(doc)
  } catch {
    text = body
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_SNIPPET_CHARS)
}

const SYSTEM_PROMPT = `You are the client-health analyst for Tahi Studio, a Webflow design and development agency in New Zealand that runs retainers and projects through a custom dashboard.

Your job: read the recent activity for ONE client and produce an honest, grounded read on the health of the relationship. Base everything strictly on the data provided. Do not invent facts. If the data is thin, say so and lean toward a cautious status rather than a confident one.

What to weigh (highest impact first):
- Overdue or unpaid invoices, and any billing friction.
- Stagnant requests (no update in a while) or a pile-up of open work.
- Communication cadence: long silences, one-sided threads, or unanswered client messages.
- Missed / cancelled / no-show calls.
- Tasks that are blocked or overdue.
- Positive signals too: steady delivery, paid invoices, active healthy dialogue.

Map the overall picture to exactly one status:
- "green": on track, no material concerns.
- "amber": mixed signals, worth a proactive check-in this week.
- "red": action needed soon, real risk of churn or escalation.

Rules:
- NEVER use em dashes or en dashes. Use commas, colons, full stops, or parentheses.
- Be specific and concrete. Reference the actual signals (e.g. "invoice 34 days overdue", "no request update in 21 days").
- riskFlags: short, scannable phrases, one risk each. Empty array if genuinely none.
- suggestedActions: each a single actionable line the team could do next. 2 to 4 of them.
- healthNarrative: 3 to 5 sentences, plain and direct.

Respond with ONLY a JSON object, no prose, no code fences:
{
  "healthNarrative": "3-5 sentence summary",
  "riskFlags": ["short risk phrase", "..."],
  "suggestedHealthStatus": "green" | "amber" | "red",
  "suggestedActions": ["one line action", "..."]
}`

// ── JSON parse (fence + slice tolerant) ──────────────────────────────────────
function parseSuggestion(raw: string): HealthSuggestion | null {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as Record<string, unknown>

  const narrative = typeof p.healthNarrative === 'string' ? p.healthNarrative.trim() : ''
  if (!narrative) return null

  const status = typeof p.suggestedHealthStatus === 'string'
    ? p.suggestedHealthStatus.trim().toLowerCase()
    : ''
  const suggestedHealthStatus: HealthStatus =
    (VALID_HEALTH as readonly string[]).includes(status) ? (status as HealthStatus) : 'amber'

  const toStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean)
      : []

  return {
    healthNarrative: narrative,
    riskFlags: toStringArray(p.riskFlags),
    suggestedHealthStatus,
    suggestedActions: toStringArray(p.suggestedActions),
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping (rule 11): team member must be allowed to see this org.
  const denied = await requireAccessToOrg(drizzle, userId, id)
  if (denied) return denied

  const [org] = await drizzle
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
      industry: schema.organisations.industry,
      status: schema.organisations.status,
      healthStatus: schema.organisations.healthStatus,
      healthNote: schema.organisations.healthNote,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, id))
    .limit(1)

  if (!org) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

  // ── Gather (all scoped to this org, all bounded) ──
  const [requests, tasks, invoices, calls, messages] = await Promise.all([
    drizzle
      .select({
        title: schema.requests.title,
        status: schema.requests.status,
        priority: schema.requests.priority,
        updatedAt: schema.requests.updatedAt,
      })
      .from(schema.requests)
      .where(and(eq(schema.requests.orgId, id), eq(schema.requests.isInternal, false)))
      .orderBy(desc(schema.requests.updatedAt))
      .limit(REQUEST_LIMIT),

    drizzle
      .select({
        title: schema.tasks.title,
        status: schema.tasks.status,
        priority: schema.tasks.priority,
        dueDate: schema.tasks.dueDate,
        updatedAt: schema.tasks.updatedAt,
      })
      .from(schema.tasks)
      .where(eq(schema.tasks.orgId, id))
      .orderBy(desc(schema.tasks.updatedAt))
      .limit(TASK_LIMIT),

    drizzle
      .select({
        status: schema.invoices.status,
        totalUsd: schema.invoices.totalUsd,
        currency: schema.invoices.currency,
        dueDate: schema.invoices.dueDate,
        paidAt: schema.invoices.paidAt,
      })
      .from(schema.invoices)
      .where(eq(schema.invoices.orgId, id))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(INVOICE_LIMIT),

    drizzle
      .select({
        title: schema.scheduledCalls.title,
        status: schema.scheduledCalls.status,
        scheduledAt: schema.scheduledCalls.scheduledAt,
      })
      .from(schema.scheduledCalls)
      .where(eq(schema.scheduledCalls.orgId, id))
      .orderBy(desc(schema.scheduledCalls.scheduledAt))
      .limit(CALL_LIMIT),

    drizzle
      .select({
        authorType: schema.messages.authorType,
        isInternal: schema.messages.isInternal,
        body: schema.messages.body,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(eq(schema.messages.orgId, id))
      .orderBy(desc(schema.messages.createdAt))
      .limit(MESSAGE_LIMIT),
  ])

  const dataCounts = {
    requests: requests.length,
    tasks: tasks.length,
    invoices: invoices.length,
    calls: calls.length,
    messages: messages.length,
  }

  // If there is genuinely nothing to analyse, tell the caller rather than
  // spending tokens hallucinating a narrative from thin air.
  const totalRows = requests.length + tasks.length + invoices.length + calls.length + messages.length
  if (totalRows === 0) {
    return NextResponse.json({
      error: 'Not enough activity to generate a health check for this client yet.',
      dataCounts,
    }, { status: 422 })
  }

  // ── Build the context text ──
  const now = Date.now()
  const daysSince = (iso: string | null): string => {
    if (!iso) return 'unknown'
    const d = Math.floor((now - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
    return Number.isFinite(d) ? `${d}d ago` : 'unknown'
  }

  const lines: string[] = []
  lines.push(`Client: ${org.name}`)
  if (org.industry) lines.push(`Industry: ${org.industry}`)
  lines.push(`Account status: ${org.status}`)
  lines.push(`Current health status on file: ${org.healthStatus ?? 'unset'}`)
  if (org.healthNote) lines.push(`Existing health note: ${org.healthNote}`)
  lines.push(`Today: ${new Date(now).toISOString().split('T')[0]}`)
  lines.push('')

  lines.push(`## Recent client requests (${requests.length})`)
  if (requests.length === 0) lines.push('None')
  for (const r of requests) {
    lines.push(`- "${r.title}" (${r.status}, ${r.priority} priority) last update ${daysSince(r.updatedAt)}`)
  }
  lines.push('')

  lines.push(`## Recent tasks (${tasks.length})`)
  if (tasks.length === 0) lines.push('None')
  for (const t of tasks) {
    lines.push(`- "${t.title}" (${t.status}, ${t.priority}) due ${t.dueDate ?? 'none'} last update ${daysSince(t.updatedAt)}`)
  }
  lines.push('')

  lines.push(`## Recent invoices (${invoices.length})`)
  if (invoices.length === 0) lines.push('None')
  for (const inv of invoices) {
    const amount = `${inv.currency ?? 'USD'} ${inv.totalUsd ?? 0}`
    const paid = inv.paidAt ? `paid ${daysSince(inv.paidAt)}` : 'unpaid'
    lines.push(`- ${amount} (${inv.status}, ${paid}) due ${inv.dueDate ?? 'none'}`)
  }
  lines.push('')

  lines.push(`## Scheduled calls (${calls.length})`)
  if (calls.length === 0) lines.push('None')
  for (const c of calls) {
    lines.push(`- "${c.title}" (${c.status}) at ${c.scheduledAt}`)
  }
  lines.push('')

  lines.push(`## Recent messages, newest first (${messages.length})`)
  if (messages.length === 0) lines.push('None')
  for (const m of messages) {
    const who = m.authorType === 'contact' ? 'CLIENT' : 'TAHI'
    const vis = m.isInternal ? ' [internal note]' : ''
    const snippet = extractText(m.body)
    lines.push(`- ${who}${vis} ${daysSince(m.createdAt)}: ${snippet || '(no text)'}`)
  }

  const contextText = lines.join('\n')

  // ── Claude Sonnet call ──
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  let text = ''
  let inputTokens = 0
  let outputTokens = 0
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contextText }],
    })
    text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
    inputTokens = response.usage.input_tokens
    outputTokens = response.usage.output_tokens
  } catch (err) {
    return NextResponse.json({
      error: 'Health check generation failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  const suggestion = parseSuggestion(text)
  if (!suggestion) {
    return NextResponse.json({
      error: 'The model returned an unreadable response. Try again.',
      raw: text.slice(0, 500),
    }, { status: 502 })
  }

  // Log spend (best-effort; never break the response on a logging failure).
  try {
    await recordCost(drizzle as unknown as Parameters<typeof recordCost>[0], {
      scope: 'health',
      scopeId: id,
      stage: 'client_health_summary',
      provider: 'anthropic',
      model: SONNET_MODEL,
      inputTokens,
      outputTokens,
      note: `Client health check for ${org.name}`,
    })
  } catch {
    // cost log column/table missing or write failed - non-fatal.
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    currentHealthStatus: org.healthStatus ?? null,
    healthNarrative: suggestion.healthNarrative,
    riskFlags: suggestion.riskFlags,
    suggestedHealthStatus: suggestion.suggestedHealthStatus,
    suggestedActions: suggestion.suggestedActions,
    dataCounts,
  })
}
