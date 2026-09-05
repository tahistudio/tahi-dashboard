import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, isNull, inArray, gte, desc } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// How far back an inbound (client-authored) last message can be and still count
// as "waiting on you". Older than this is treated as stale, not a live reply.
const LOOKBACK_DAYS = 60
// Max rows the card ever needs. Every row is a request now, so a single cap can
// no longer be spent by one kind on behalf of another.
const CAP = 12
// Newest messages read per request in the window. Only the newest VISIBLE row
// per request decides the answer, so the read is bounded rather than pulling
// the whole 60 day history (bodies are Tiptap JSON, and D1's result size is the
// failure mode on a migrated org). Twenty apiece leaves room for a burst of
// internal notes on top of the reply that settles it.
const MESSAGE_BUDGET_PER_REQUEST = 20

interface ReplyThread {
  id: string
  kind: 'request'
  threadTitle: string
  clientName: string | null
  lastSnippet: string
  ago: string
  at: string
  to: string
}

// ── GET /api/admin/overview/replies-waiting?scope=me ────────────────────────
// Request threads the signed-in team member is on where the LAST message the
// client can see was authored by a client contact - i.e. the ball is in the
// member's court. Newest inbound first, capped.
//
// Honest empty: returns { threads: [] } when nothing is waiting (or the caller
// has no team_members row). Only scope=me is supported today; any other scope
// yields the same member-scoped feed.
//
// Every row opens the REQUEST the reply was written on. The standalone
// Messages page is hidden (app/(dashboard)/messages/page.tsx redirects an
// admin to /overview and there is no [id] route at all), so this feed no
// longer reads conversations at all: it used to hand rows out as
// `/messages/{id}` (a hard 404), then as the request its conversation was
// attached to, which resolved the client name off conversations.org_id and the
// title off a left join that a deleted request answers with nulls. Every
// message on a request carries requests.id whether or not it also carries a
// conversation id, so the request branch alone already sees the whole thread,
// and dropping the second pass saves two D1 reads on every overview load.
// Restore it in the same change that re-renders the Messages surface.
//
// "The last message the client can see": internal notes are excluded, so
// reading a client's question and writing a studio-only note beside it does
// not clear the request off this card. An answer the client never receives is
// not an answer.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as D1

  let memberId: string | null = null
  if (userId) {
    try {
      const [m] = await drizzle
        .select({ id: schema.teamMembers.id })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.clerkUserId, userId))
        .limit(1)
      memberId = m?.id ?? null
    } catch {
      memberId = null
    }
  }

  if (!memberId) return NextResponse.json({ threads: [] })

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const now = Date.now()
  const threads: ReplyThread[] = []

  // ── Request threads the member owns or participates on ────────────────────
  try {
    const reqIds = new Set<string>()
    const directReqs = await drizzle
      .select({ id: schema.requests.id })
      .from(schema.requests)
      .where(eq(schema.requests.assigneeId, memberId))
    for (const r of directReqs) reqIds.add(r.id)

    const partReqs = await drizzle
      .select({ requestId: schema.requestParticipants.requestId })
      .from(schema.requestParticipants)
      .where(and(
        eq(schema.requestParticipants.participantId, memberId),
        eq(schema.requestParticipants.participantType, 'team_member'),
        isNull(schema.requestParticipants.removedAt),
      ))
    for (const p of partReqs) reqIds.add(p.requestId)

    const reqIdList = [...reqIds]
    if (reqIdList.length > 0) {
      const rows = await drizzle
        .select({
          messageId: schema.messages.id,
          requestId: schema.messages.requestId,
          body: schema.messages.body,
          authorType: schema.messages.authorType,
          createdAt: schema.messages.createdAt,
          reqTitle: schema.requests.title,
          orgName: schema.organisations.name,
        })
        .from(schema.messages)
        .innerJoin(schema.requests, eq(schema.messages.requestId, schema.requests.id))
        .leftJoin(schema.organisations, eq(schema.requests.orgId, schema.organisations.id))
        .where(and(
          inArray(schema.messages.requestId, reqIdList),
          // Studio-only notes are not an answer to the client, so they must not
          // win the per-request "last message" race. Without this, reading a
          // client's question and writing an internal note beside it cleared
          // the request off the card while the client was still waiting.
          eq(schema.messages.isInternal, false),
          isNull(schema.messages.deletedAt),
          gte(schema.messages.createdAt, cutoff),
        ))
        .orderBy(desc(schema.messages.createdAt))
        .limit(reqIdList.length * MESSAGE_BUDGET_PER_REQUEST)

      const seen = new Set<string>()
      for (const r of rows) {
        const key = r.requestId
        if (!key || seen.has(key)) continue
        seen.add(key)
        if (r.authorType !== 'contact') continue
        threads.push({
          id: key,
          kind: 'request',
          threadTitle: r.reqTitle?.trim() || 'Request',
          clientName: r.orgName?.trim() || null,
          lastSnippet: snippet(r.body),
          ago: relativeAgo(r.createdAt, now),
          at: r.createdAt,
          to: `/requests/${key}`,
        })
      }
    }
  } catch {
    // requests / messages tables missing - skip request threads.
  }

  threads.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  return NextResponse.json({ threads: threads.slice(0, CAP) })
}

// Plain-text preview of a Tiptap-JSON (or raw) message body, whitespace
// collapsed and truncated. Total + safe: malformed JSON falls back to raw text.
function snippet(body: string, max = 140): string {
  let text = ''
  try {
    const doc: unknown = JSON.parse(body)
    const parts: string[] = []
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const n = node as { text?: unknown; content?: unknown }
      if (typeof n.text === 'string') parts.push(n.text)
      if (Array.isArray(n.content)) n.content.forEach(walk)
    }
    walk(doc)
    text = parts.join(' ').replace(/\s+/g, ' ').trim()
  } catch {
    text = body.replace(/\s+/g, ' ').trim()
  }
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 3).trimEnd()}...` : text
}

// Compact relative age, e.g. "just now", "5m ago", "3h ago", "2d ago", "4w ago".
function relativeAgo(at: string, now: number): string {
  const t = new Date(at).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.floor((now - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.floor(d / 7)
  return `${w}w ago`
}
