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
// Max rows the card ever needs, PER KIND. A single shared cap let a run of
// newer conversation rows spend the whole budget, so the card could render its
// empty line while request replies were in fact waiting. Each kind now gets
// its own budget and the consumer filters on kind, so one can never starve the
// other.
const CAP_PER_KIND = 12

interface ReplyThread {
  id: string
  kind: 'conversation' | 'request'
  threadTitle: string
  clientName: string | null
  lastSnippet: string
  ago: string
  at: string
  to: string
}

// ── GET /api/admin/overview/replies-waiting?scope=me ────────────────────────
// Threads (conversations + request threads) the signed-in team member is on
// where the LAST non-deleted message was authored by a client contact - i.e.
// the ball is in the member's court. Newest inbound first, capped.
//
// Honest empty: returns { threads: [] } when nothing is waiting (or the caller
// has no team_members row). Only scope=me is supported today; any other scope
// yields the same member-scoped feed.
//
// Every row opens the REQUEST the reply was written on. The standalone
// Messages page is hidden (app/(dashboard)/messages/page.tsx redirects an
// admin to /overview and there is no [id] route at all), so the conversation
// rows this feed used to hand out as `/messages/{id}` were a hard 404. A
// conversation that is attached to a request is emitted against that request
// instead; one that is attached to nothing has nowhere to land and is skipped
// until the surface comes back.
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
  // Requests already listed, so a reply that reaches this member through BOTH
  // the request and its conversation is one row, not two. The request branch
  // runs first because it sees every message on the request (with or without a
  // conversation id) and so settles the "last message" question properly.
  const listedRequestIds = new Set<string>()

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
          isNull(schema.messages.deletedAt),
          gte(schema.messages.createdAt, cutoff),
        ))
        .orderBy(desc(schema.messages.createdAt))

      const seen = new Set<string>()
      for (const r of rows) {
        const key = r.requestId
        if (!key || seen.has(key)) continue
        seen.add(key)
        listedRequestIds.add(key)
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

  // ── Conversations the member participates in ──────────────────────────────
  try {
    const convRows = await drizzle
      .select({ conversationId: schema.conversationParticipants.conversationId })
      .from(schema.conversationParticipants)
      .where(and(
        eq(schema.conversationParticipants.participantId, memberId),
        eq(schema.conversationParticipants.participantType, 'team_member'),
      ))
    const convIds = [...new Set(convRows.map(c => c.conversationId))]

    if (convIds.length > 0) {
      const rows = await drizzle
        .select({
          messageId: schema.messages.id,
          conversationId: schema.messages.conversationId,
          body: schema.messages.body,
          authorType: schema.messages.authorType,
          createdAt: schema.messages.createdAt,
          convName: schema.conversations.name,
          convOrgId: schema.conversations.orgId,
          convRequestId: schema.conversations.requestId,
          reqTitle: schema.requests.title,
          orgName: schema.organisations.name,
        })
        .from(schema.messages)
        .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
        .leftJoin(schema.requests, eq(schema.conversations.requestId, schema.requests.id))
        .leftJoin(schema.organisations, eq(schema.conversations.orgId, schema.organisations.id))
        .where(and(
          inArray(schema.messages.conversationId, convIds),
          isNull(schema.messages.deletedAt),
          gte(schema.messages.createdAt, cutoff),
        ))
        .orderBy(desc(schema.messages.createdAt))

      const seen = new Set<string>()
      for (const r of rows) {
        const key = r.conversationId
        if (!key || seen.has(key)) continue
        seen.add(key)
        if (r.authorType !== 'contact') continue
        // Only a conversation attached to a request has a page to open, and
        // the request branch above already carries every request this member
        // is ON. What survives here is the reply that arrived on a request
        // somebody else owns while this member sits in its thread.
        const target = r.convRequestId
        if (!target || listedRequestIds.has(target)) continue
        listedRequestIds.add(target)
        threads.push({
          id: target,
          kind: 'request',
          threadTitle: r.reqTitle?.trim() || r.convName?.trim() || 'Request',
          clientName: r.orgName?.trim() || null,
          lastSnippet: snippet(r.body),
          ago: relativeAgo(r.createdAt, now),
          at: r.createdAt,
          to: `/requests/${target}`,
        })
      }
    }
  } catch {
    // conversations / messages tables missing - skip conversation threads.
  }

  threads.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())

  return NextResponse.json({ threads: capPerKind(threads, CAP_PER_KIND) })
}

/** Keep at most `cap` rows of each kind, newest first, order preserved. Local
 *  by rule: a route module may only export HTTP methods and route config. */
function capPerKind(threads: ReplyThread[], cap: number): ReplyThread[] {
  const used = new Map<ReplyThread['kind'], number>()
  const kept: ReplyThread[] = []
  for (const t of threads) {
    const n = used.get(t.kind) ?? 0
    if (n >= cap) continue
    used.set(t.kind, n + 1)
    kept.push(t)
  }
  return kept
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
