/**
 * POST /api/admin/requests/[id]/draft-reply
 *
 * Drafts a reply for the team to post into a request thread. Grounded in
 * the request (title, category, description), the client it belongs to,
 * the recent thread history, and Tahi's canonical brand voice + tone
 * docs (loaded from the Docs Hub via loadAiContext, same as the leads
 * draft-reply exemplar).
 *
 * This endpoint ONLY returns draft text. It does NOT post anything and
 * does NOT mutate the request. The request-detail page surfaces the draft
 * as a PENDING review card: the human reads it, edits it, then explicitly
 * posts it through the existing message-post flow (POST .../messages).
 * The AI never posts. That human click is the sole approval gate.
 *
 * Persistence: unlike the leads flow (which has a separate Resend /send
 * route + a tone-learning loop keyed on ai_reply_drafts), request replies
 * are posted through the normal thread composer, so there is no second
 * send step to persist a pending row for. We generate + return; the draft
 * lives in the page until the human posts or dismisses it.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq } from 'drizzle-orm'
import { loadAiContext } from '@/lib/ai-context'
import { SONNET_MODEL } from '@/lib/ai-models'
import { requireAccessToOrg } from '@/lib/require-access'

export const dynamic = 'force-dynamic'

const MAX_DESCRIPTION_CHARS = 4000
const THREAD_HISTORY_LIMIT = 8

const SYSTEM_PROMPT = `You are a reply-drafting assistant for the Tahi Studio delivery team. Tahi is a Webflow design and development agency based in New Zealand. You draft a reply that a Tahi team member will post into a client request thread.

YOUR JOB
Draft a clear, helpful reply to the most recent activity on this request. The reply is posted publicly into the thread, so the client will read it. Write it as the Tahi team talking to the client.

BRAND VOICE - Tahi
- Direct, warm, and human. Get to the point.
- Confident and reassuring about the work. No filler.
- No filler phrases like "I'd be happy to" / "Thanks for reaching out!" Open with the actual point.
- Contractions (we're, you'll, it's). Short sentences. Vary length.
- NZ English spelling (colour, organise, centre).
- NEVER use em dashes or en dashes. Use commas, colons, full stops, or parentheses.

WHAT TO WRITE
- If the client asked a question, answer it directly.
- If they gave feedback, acknowledge it and say what happens next.
- If the thread is quiet and you're opening it, give a short, useful status update grounded ONLY in what the request says. Do not invent progress, dates, or deliverables that are not in the request.
- Keep it to 2-4 short paragraphs. No subject line - this is a thread message, not an email.
- Do not sign off with a name - the poster's identity is already on the message.

OUTPUT FORMAT (strict - parsed by regex):

<body>
The reply body. Plain text only. Blank line between paragraphs.
No HTML, no markdown, no subject line, no signature.
</body>`

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

function parseBody(text: string): string | null {
  const m = text.match(/<body>([\s\S]*?)<\/body>/i)
  const body = (m ? m[1] : text).trim()
  return body.length > 0 ? body : null
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
      category: schema.requests.category,
      status: schema.requests.status,
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

  const denied = await requireAccessToOrg(drizzle, userId, request.orgId)
  if (denied) return denied

  // Recent thread history (public + internal), oldest-first for the prompt.
  const recent = await drizzle
    .select({
      body: schema.messages.body,
      authorType: schema.messages.authorType,
      isInternal: schema.messages.isInternal,
      createdAt: schema.messages.createdAt,
      authorName: schema.teamMembers.name,
    })
    .from(schema.messages)
    .leftJoin(schema.teamMembers, eq(schema.messages.authorId, schema.teamMembers.id))
    .where(eq(schema.messages.requestId, id))
    .orderBy(desc(schema.messages.createdAt))
    .limit(THREAD_HISTORY_LIMIT)
  const history = recent.slice().reverse()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const description = request.description ? stripHtml(request.description) : ''
  const lines: string[] = []
  lines.push('REQUEST')
  lines.push(`Title: ${request.title}`)
  if (request.category) lines.push(`Category: ${request.category}`)
  lines.push(`Status: ${request.status}`)
  lines.push(`Client: ${request.orgName ?? 'Unknown'}`)
  if (description) {
    lines.push('Description:')
    lines.push(description.slice(0, MAX_DESCRIPTION_CHARS))
  }
  lines.push('')

  if (history.length > 0) {
    lines.push('THREAD SO FAR (oldest first):')
    for (const m of history) {
      const who = m.authorType === 'contact'
        ? 'Client'
        : `Tahi (${m.authorName ?? 'team'})`
      const visibility = m.isInternal ? ' [internal note]' : ''
      lines.push(`${who}${visibility}: ${stripHtml(m.body).slice(0, 800)}`)
    }
    lines.push('')
    lines.push('Draft the next public reply from Tahi to the client.')
  } else {
    lines.push('The thread is empty. Draft an opening public reply from Tahi to the client, grounded only in the request above.')
  }

  const userMessage = lines.join('\n')

  // Canonical Tahi voice, loaded from the Docs Hub. Additive: if the
  // settings/docs aren't wired the string is empty and we just proceed.
  const contextText = await loadAiContext(['brandDna', 'tone'])

  const systemBlocks = contextText
    ? [
        { type: 'text' as const, text: contextText, cache_control: { type: 'ephemeral' as const } },
        { type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } },
      ]
    : [
        { type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } },
      ]

  let text = ''
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: SONNET_MODEL,
      max_tokens: 900,
      system: systemBlocks,
      messages: [{ role: 'user', content: userMessage }],
    })
    text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
  } catch (err) {
    return NextResponse.json({
      error: 'Draft generation failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }

  const body = parseBody(text)
  if (!body) {
    return NextResponse.json({
      error: 'Draft returned no usable body',
      raw: text.slice(0, 400),
    }, { status: 500 })
  }

  return NextResponse.json({ requestId: id, body })
}
