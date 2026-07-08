/**
 * POST /api/admin/requests/[id]/triage
 *
 * A small, cheap triage pass over a single request. Reads the request
 * (title, description, category) + its org + the current team roster,
 * and returns structured SUGGESTIONS for how to route it:
 *
 *   - suggestedAssigneeId : an id from the team roster (or null)
 *   - suggestedPriority   : 'standard' | 'high'
 *   - suggestedTrack      : 'small' | 'large'
 *   - oneLineReason       : one sentence explaining the call
 *
 * This endpoint NEVER mutates the request. It only returns suggestions.
 * The request-detail banner surfaces them with explicit per-field Apply
 * buttons that call the existing PATCH /api/admin/requests/[id] endpoint.
 * Human-in-the-loop is the whole point: nothing here changes state.
 *
 * Uses Haiku (cheap + fast) since this is a routing hint, not prose.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { HAIKU_MODEL } from '@/lib/ai-models'
import { requireAccessToOrg } from '@/lib/require-access'

export const dynamic = 'force-dynamic'

const MAX_DESCRIPTION_CHARS = 4000

const SYSTEM_PROMPT = `You are a triage assistant for Tahi Studio, a Webflow design and development agency. You read a single inbound work request and suggest how to route it. You never take action - you only propose, and a human decides.

You will be given the request (title, category, description), the client it belongs to, and the current team roster with each person's title/role. Suggest:

1. assignee: pick the single team member best suited to own this request, based on their title/role vs the request's nature (design, development, content, SEO, strategy). If nobody is an obvious fit, return null.
2. priority: "high" only if the request signals urgency, a launch dependency, a blocker, or an unhappy client. Otherwise "standard".
3. track: "small" for a quick task (a day or less: copy tweak, single component, small fix). "large" for multi-day / multi-week builds (new pages, full features, redesigns).
4. reason: ONE sentence, plain, explaining the routing call. NZ English. No em dashes or en dashes.

Only reason from what the request actually says. Do not invent urgency or scope that is not there.

OUTPUT: a single JSON object and nothing else. Shape:
{"suggestedAssigneeId": "<team member id or null>", "suggestedPriority": "standard|high", "suggestedTrack": "small|large", "oneLineReason": "<one sentence>"}`

interface TeamRosterRow {
  id: string
  name: string
  title: string | null
  role: string
  roles: string | null
}

interface TriageSuggestion {
  suggestedAssigneeId: string | null
  suggestedAssigneeName: string | null
  suggestedPriority: 'standard' | 'high'
  suggestedTrack: 'small' | 'large'
  oneLineReason: string
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pull the first JSON object out of the model text, tolerating fences. */
function parseSuggestion(
  text: string,
  roster: TeamRosterRow[],
): TriageSuggestion | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    return null
  }

  // Validate assignee against the actual roster - never trust a made-up id.
  const rawAssignee = parsed.suggestedAssigneeId
  const assigneeId = typeof rawAssignee === 'string' && rawAssignee.trim()
    ? rawAssignee.trim()
    : null
  const matched = assigneeId ? roster.find(r => r.id === assigneeId) ?? null : null

  const priority = parsed.suggestedPriority === 'high' ? 'high' : 'standard'
  const track = parsed.suggestedTrack === 'large' ? 'large' : 'small'
  const reason = typeof parsed.oneLineReason === 'string'
    ? parsed.oneLineReason.trim().slice(0, 300)
    : ''

  return {
    suggestedAssigneeId: matched?.id ?? null,
    suggestedAssigneeName: matched?.name ?? null,
    suggestedPriority: priority,
    suggestedTrack: track,
    oneLineReason: reason || 'Suggested routing based on the request contents.',
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

  const [request] = await drizzle
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      orgName: schema.organisations.name,
      type: schema.requests.type,
      category: schema.requests.category,
      title: schema.requests.title,
      description: schema.requests.description,
    })
    .from(schema.requests)
    .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
    .where(eq(schema.requests.id, id))
    .limit(1)

  if (!request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  // Access scoping - same gate the request GET/PATCH use.
  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  const roster: TeamRosterRow[] = await drizzle
    .select({
      id: schema.teamMembers.id,
      name: schema.teamMembers.name,
      title: schema.teamMembers.title,
      role: schema.teamMembers.role,
      roles: schema.teamMembers.roles,
    })
    .from(schema.teamMembers)
    // Defensive bound: the roster is small, but never render an unbounded
    // table into the prompt.
    .limit(50)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  // Build the user message: request + client + roster.
  const description = request.description ? stripHtml(request.description) : ''
  const lines: string[] = []
  lines.push('REQUEST')
  lines.push(`Title: ${request.title}`)
  if (request.category) lines.push(`Category: ${request.category}`)
  lines.push(`Type: ${request.type}`)
  lines.push(`Client: ${request.orgName ?? 'Unknown'}`)
  if (description) {
    lines.push('Description:')
    lines.push(description.slice(0, MAX_DESCRIPTION_CHARS))
  }
  lines.push('')
  lines.push('TEAM ROSTER (id - name - title/roles):')
  if (roster.length === 0) {
    lines.push('(no team members on file - return null for the assignee)')
  } else {
    for (const m of roster) {
      let roleLabel = m.title ?? m.role
      if (m.roles) {
        try {
          const parsed = JSON.parse(m.roles) as string[]
          if (Array.isArray(parsed) && parsed.length > 0) roleLabel = parsed.join(', ')
        } catch { /* keep title/role fallback */ }
      }
      lines.push(`${m.id} - ${m.name} - ${roleLabel}`)
    }
  }
  lines.push('')
  lines.push('Return the JSON triage object now.')

  const userMessage = lines.join('\n')

  let text = ''
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 400,
      // Stable system prompt - cache it so repeat triage passes within
      // the TTL pay the discounted input rate on the prompt portion.
      system: [{
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      }],
      messages: [{ role: 'user', content: userMessage }],
    })
    text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
  } catch (err) {
    return NextResponse.json({
      error: 'Triage failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  const suggestion = parseSuggestion(text, roster)
  if (!suggestion) {
    return NextResponse.json({
      error: 'Triage produced no usable suggestion',
      raw: text.slice(0, 400),
    }, { status: 500 })
  }

  return NextResponse.json({ requestId: id, suggestion })
}
