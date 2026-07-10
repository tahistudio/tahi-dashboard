import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, desc, isNotNull, isNull } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// Design pulse colours (data, passed to inline style in TheWire). These mirror
// the overview design's per-event accent hues; they are values, not tokens.
const COLOR = {
  request: '#5A824E', // brand — work shipped / moved
  message: '#2A6FDB', // blue — team messaged you
  file: '#C9A227', // gold — files shared
} as const

// Compact relative label for the ticker ("12m", "1h", "2d"). A glance, not a
// timestamp; the client also receives whenISO for exact formatting.
function rel(iso: string | null, now: number): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Math.max(0, now - t)
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return `${Math.floor(d / 7)}w`
}

interface ActivityItem {
  id: string
  who: string
  what: string
  when: string
  whenISO: string
  color: string
}

// Map a request's current status to a client-facing pulse phrase + timestamp.
function requestPhrase(
  status: string,
  title: string,
  deliveredAt: string | null,
  updatedAt: string,
): { what: string; at: string } | null {
  const t = title.trim() || 'a request'
  switch (status) {
    case 'delivered':
      return { what: `delivered "${t}" for your review`, at: deliveredAt ?? updatedAt }
    case 'client_review':
      return { what: `moved "${t}" to your review`, at: updatedAt }
    case 'in_progress':
      return { what: `started work on "${t}"`, at: updatedAt }
    case 'in_review':
      return { what: `is reviewing "${t}"`, at: updatedAt }
    default:
      return null
  }
}

// ── GET /api/portal/activity ─────────────────────────────────────────────────
// Recent org-visible events for the client TheWire pulse: request progress,
// team messages to the client, and file deliveries. Scoped to the caller's org,
// external-visible only (never internal requests/messages). Honest empty [] when
// there is no recent activity. Read-only, safe under Client-view impersonation.
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getPortalAuth(req)

  // Deny if not authenticated or if this is the Tahi admin org (no impersonation
  // target). An impersonating admin resolves to the target org and reads safely.
  if (!orgId || !userId || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const drizzle = database as D1
  const now = Date.now()

  const candidates: Array<{ item: ActivityItem; atMs: number }> = []
  // Collect team-member ids referenced by each source so names resolve in one
  // batched query rather than per-row joins.
  const memberIds = new Set<string>()

  // ── Request progress (external requests only) ──────────────────────────────
  let requestRows: Array<{
    id: string
    title: string
    status: string
    assigneeId: string | null
    deliveredAt: string | null
    updatedAt: string
  }> = []
  try {
    requestRows = await drizzle
      .select({
        id: schema.requests.id,
        title: schema.requests.title,
        status: schema.requests.status,
        assigneeId: schema.requests.assigneeId,
        deliveredAt: schema.requests.deliveredAt,
        updatedAt: schema.requests.updatedAt,
      })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.orgId, orgId),
        eq(schema.requests.isInternal, false),
      ))
      .orderBy(desc(schema.requests.updatedAt))
      .limit(12)
    for (const r of requestRows) if (r.assigneeId) memberIds.add(r.assigneeId)
  } catch {
    requestRows = []
  }

  // ── Team messages to the client (public, not deleted) ──────────────────────
  let messageRows: Array<{ id: string; authorId: string; createdAt: string }> = []
  try {
    messageRows = await drizzle
      .select({
        id: schema.messages.id,
        authorId: schema.messages.authorId,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(and(
        eq(schema.messages.orgId, orgId),
        eq(schema.messages.authorType, 'team_member'),
        eq(schema.messages.isInternal, false),
        isNull(schema.messages.deletedAt),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(12)
    for (const m of messageRows) memberIds.add(m.authorId)
  } catch {
    messageRows = []
  }

  // ── File deliveries from the team (exclude files on internal requests) ──────
  let fileRows: Array<{
    id: string
    filename: string
    uploadedById: string
    createdAt: string
    reqInternal: boolean | null
  }> = []
  try {
    fileRows = await drizzle
      .select({
        id: schema.files.id,
        filename: schema.files.filename,
        uploadedById: schema.files.uploadedById,
        createdAt: schema.files.createdAt,
        reqInternal: schema.requests.isInternal,
      })
      .from(schema.files)
      .leftJoin(schema.requests, eq(schema.files.requestId, schema.requests.id))
      .where(and(
        eq(schema.files.orgId, orgId),
        eq(schema.files.uploadedByType, 'team_member'),
        isNotNull(schema.files.createdAt),
      ))
      .orderBy(desc(schema.files.createdAt))
      .limit(12)
    for (const f of fileRows) if (f.reqInternal !== true) memberIds.add(f.uploadedById)
  } catch {
    fileRows = []
  }

  // Resolve all referenced team-member display names in one pass.
  const nameById = new Map<string, string>()
  if (memberIds.size > 0) {
    try {
      const members = await drizzle
        .select({ id: schema.teamMembers.id, name: schema.teamMembers.name })
        .from(schema.teamMembers)
      for (const m of members) {
        if (memberIds.has(m.id)) nameById.set(m.id, m.name)
      }
    } catch {
      // team_members unreadable — fall back to "Your team" below.
    }
  }
  const who = (id: string | null): string => (id && nameById.get(id)) || 'Your team'

  for (const r of requestRows) {
    const phrase = requestPhrase(r.status, r.title, r.deliveredAt, r.updatedAt)
    if (!phrase) continue
    const atMs = new Date(phrase.at).getTime()
    if (!Number.isFinite(atMs)) continue
    candidates.push({
      item: {
        id: `request:${r.id}`,
        who: who(r.assigneeId),
        what: phrase.what,
        when: rel(phrase.at, now),
        whenISO: phrase.at,
        color: COLOR.request,
      },
      atMs,
    })
  }

  for (const m of messageRows) {
    const atMs = new Date(m.createdAt).getTime()
    if (!Number.isFinite(atMs)) continue
    candidates.push({
      item: {
        id: `message:${m.id}`,
        who: who(m.authorId),
        what: 'sent you a message',
        when: rel(m.createdAt, now),
        whenISO: m.createdAt,
        color: COLOR.message,
      },
      atMs,
    })
  }

  for (const f of fileRows) {
    if (f.reqInternal === true) continue // never leak files on internal requests
    const atMs = new Date(f.createdAt).getTime()
    if (!Number.isFinite(atMs)) continue
    candidates.push({
      item: {
        id: `file:${f.id}`,
        who: who(f.uploadedById),
        what: `shared ${f.filename.trim() || 'a file'}`,
        when: rel(f.createdAt, now),
        whenISO: f.createdAt,
        color: COLOR.file,
      },
      atMs,
    })
  }

  const items: ActivityItem[] = candidates
    .sort((a, b) => b.atMs - a.atMs)
    .slice(0, 12)
    .map((c) => c.item)

  return NextResponse.json({ items })
}
