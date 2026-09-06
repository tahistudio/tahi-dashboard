import { getRequestAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, or, count, lt, gte, inArray } from 'drizzle-orm'
import {
  buildNotificationFacets,
  entityTypesForKinds,
  type NotificationFacetRow,
} from '@/lib/notification-links'
// One definition of the service identity, shared with every other gate that
// special-cases it (lib/access-scope, lib/permissions).
import { SERVICE_USER_ID } from '@/lib/team-identity'

// What the bell popover renders when nothing asks for more. The /notifications
// page asks for more; the unread COUNT is deliberately not derived from either
// page size (see below).
const PAGE_SIZE = 20
// A page can ask for more, but not for the whole table: D1 reads are billed by
// rows scanned and a client on a phone has no use for 5,000 rows.
const MAX_PAGE_SIZE = 100

/**
 * Cursor is `${createdAt}|${id}`, not a bare timestamp.
 *
 * Notifications are written in batches with `new Date().toISOString()`, so two
 * rows for one user can share a millisecond. A timestamp-only cursor silently
 * drops the ties; the composite one walks them.
 */
interface Cursor { createdAt: string; id: string }

function parseCursor(raw: string | null): Cursor | null {
  if (!raw) return null
  const at = raw.lastIndexOf('|')
  if (at <= 0 || at === raw.length - 1) return null
  return { createdAt: raw.slice(0, at), id: raw.slice(at + 1) }
}

function encodeCursor(row: { createdAt: string | null; id: string }): string | null {
  return row.createdAt ? `${row.createdAt}|${row.id}` : null
}

/** ISO-8601 only. A junk value is ignored rather than silently widening. */
function parseIso(raw: string | null): string | null {
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

function parseLimit(raw: string | null): number {
  if (!raw) return PAGE_SIZE
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return PAGE_SIZE
  return Math.min(n, MAX_PAGE_SIZE)
}

// ── GET /api/notifications ────────────────────────────────────────────────────
// The caller's own notifications, newest first, plus the true unread count.
//
// Query params, all optional:
//   limit=1..100     page size (default 20)
//   cursor=<c>       keyset cursor from a previous nextCursor; returns rows
//                    strictly older than it
//   since=<iso>      only rows at or after this instant (the All tab's window)
//   before=<iso>     only rows before this instant (the Past tab's window)
//   kind=a,b         filter by plain kind (request, invoice, ...), expanded to
//                    entity types by lib/notification-links.ts so the page and
//                    the query can never disagree about what "Invoices" means
//   unread=true      unread only
//   facets=true      adds `facets`: row totals per view (All / Unread / Past)
//                    and per kind within each of them, so the rail can put an
//                    honest number on every row it draws and grey out the
//                    kinds with nothing behind them. Two grouped counts, no
//                    row bodies, and absent from the response unless asked
//                    for, so the bell's read is untouched.
//   userId=<id>      SERVICE TOKEN ONLY (see below)
export async function GET(req: NextRequest) {
  const { userId, sessionId } = await getRequestAuth(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const params = req.nextUrl.searchParams

  // Notifications are keyed on the Clerk user id, so a service-token caller
  // (MCP) has none of its own and would always read an empty feed. It may name
  // the user it is reading for; a real browser session may NOT, so no signed-in
  // person can read anyone else's bell by adding a query param. The service
  // token already carries full admin read, so this grants it nothing new.
  const isService = userId === SERVICE_USER_ID && sessionId === null
  const requestedUser = params.get('userId')
  if (requestedUser && !isService) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const subjectId = isService && requestedUser ? requestedUser : userId

  const limit = parseLimit(params.get('limit'))
  const cursor = parseCursor(params.get('cursor'))
  const since = parseIso(params.get('since'))
  const before = parseIso(params.get('before'))
  const unreadOnly = params.get('unread') === 'true'
  const wantsFacets = params.get('facets') === 'true'
  const kinds = (params.get('kind') ?? '').split(',').map(k => k.trim()).filter(Boolean)
  const entityTypes = kinds.length ? entityTypesForKinds(kinds) : []

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  const filters = [eq(schema.notifications.userId, subjectId)]
  if (since) filters.push(gte(schema.notifications.createdAt, since))
  if (before) filters.push(lt(schema.notifications.createdAt, before))
  if (unreadOnly) filters.push(eq(schema.notifications.read, false))
  if (kinds.length) {
    // An unrecognised kind expands to nothing, which must narrow to nothing
    // rather than fall through to "every row".
    filters.push(inArray(schema.notifications.entityType, entityTypes))
  }
  if (cursor) {
    filters.push(
      or(
        lt(schema.notifications.createdAt, cursor.createdAt),
        and(
          eq(schema.notifications.createdAt, cursor.createdAt),
          lt(schema.notifications.id, cursor.id),
        ),
      )!,
    )
  }

  // One row past the page, so hasMore is known without a second count.
  const rows = await drizzle
    .select()
    .from(schema.notifications)
    .where(and(...filters))
    .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
    .limit(limit + 1)

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  const nextCursor = hasMore && last
    ? encodeCursor(last as { createdAt: string | null; id: string })
    : null

  // Counted over the whole table, not over the page above. Filtering the rows
  // we happened to load reported 50 unread as 20, which is the number the
  // bell's aria-label reads out.
  const [unread] = await drizzle
    .select({ n: count() })
    .from(schema.notifications)
    .where(and(
      eq(schema.notifications.userId, subjectId),
      eq(schema.notifications.read, false),
    ))

  // The rail's numbers. Counted, never derived from `items`: the page holds
  // one page and the rail speaks for the whole window.
  //
  // The boundary is whichever window the caller named. The page sends `since`
  // on All and Unread and `before` on Past, always the same instant, so one
  // read answers all three views and switching view needs no refetch.
  //
  // Deliberately NOT narrowed by `kind` or `unread`: a kind's count has to say
  // what pressing it would return, so selecting one cannot zero the others.
  let facets: ReturnType<typeof buildNotificationFacets> | undefined
  if (wantsFacets) {
    const boundary = since ?? before
    const facetSelect = {
      entityType: schema.notifications.entityType,
      read: schema.notifications.read,
      n: count(),
    }
    const groupFacets = (side: 'recent' | 'past') => {
      const facetFilters = [eq(schema.notifications.userId, subjectId)]
      if (boundary) {
        facetFilters.push(side === 'recent'
          ? gte(schema.notifications.createdAt, boundary)
          : lt(schema.notifications.createdAt, boundary))
      }
      return drizzle
        .select(facetSelect)
        .from(schema.notifications)
        .where(and(...facetFilters))
        .groupBy(schema.notifications.entityType, schema.notifications.read)
    }
    const [recentRows, pastRows] = await Promise.all([
      groupFacets('recent'),
      // With no boundary there is no "older than the window" side to count,
      // and asking for one would re-count every row the recent side just did.
      boundary ? groupFacets('past') : Promise.resolve([]),
    ])
    facets = buildNotificationFacets(
      recentRows as NotificationFacetRow[],
      pastRows as NotificationFacetRow[],
    )
  }

  return NextResponse.json({
    items,
    unreadCount: Number(unread?.n ?? 0),
    nextCursor,
    hasMore,
    ...(facets ? { facets } : {}),
  })
}

// ── PATCH /api/notifications ──────────────────────────────────────────────────
// Mark notifications as read.
// Body: { id?: string, all?: boolean, entityType?: string, entityId?: string,
//         kinds?: string[], before?: string }
//   - { all: true }                      marks every notification for the user as read
//   - { id: "..." }                      marks a single notification as read
//   - { entityType: "request", entityId } marks every unread row pointing at that
//     entity as read. This is what opening a request clears: a bell that only
//     empties when you click each row through the popover is a bell people stop
//     looking at, and the row you just acted on is the one you already read.
//
// `kinds` and `before` narrow `all` to what the page is actually showing, so
// "Mark all as read" under a kind filter clears what the reader can see rather
// than silently emptying the whole inbox behind it.
//
// There is deliberately no mark-UNREAD, delete or archive: `read` is a one-way
// flag with no endpoint behind those verbs, and three honest verbs beat four
// with one that lies.
export async function PATCH(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    id?: string
    all?: boolean
    entityType?: string
    entityId?: string
    kinds?: string[]
    before?: string
  }
  try {
    body = await req.json() as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { entityType, entityId } = body
  const hasEntity = !!entityType && !!entityId
  if (!body.id && !body.all && !hasEntity) {
    return NextResponse.json({ error: 'Provide id, all: true, or entityType + entityId' }, { status: 400 })
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  if (body.all) {
    const filters = [eq(schema.notifications.userId, userId)]
    const kinds = Array.isArray(body.kinds) ? body.kinds.filter(k => typeof k === 'string') : []
    if (kinds.length) {
      filters.push(inArray(schema.notifications.entityType, entityTypesForKinds(kinds)))
    }
    const before = parseIso(body.before ?? null)
    if (before) filters.push(lt(schema.notifications.createdAt, before))
    await drizzle
      .update(schema.notifications)
      .set({ read: true })
      .where(and(...filters))
  } else if (body.id) {
    await drizzle
      .update(schema.notifications)
      .set({ read: true })
      .where(
        and(
          eq(schema.notifications.id, body.id),
          eq(schema.notifications.userId, userId),
        )
      )
  } else if (entityType && entityId) {
    // Always scoped to the caller's own rows, so this cannot be used to clear
    // somebody else's bell by guessing an entity id.
    await drizzle
      .update(schema.notifications)
      .set({ read: true })
      .where(
        and(
          eq(schema.notifications.userId, userId),
          eq(schema.notifications.entityType, entityType),
          eq(schema.notifications.entityId, entityId),
        )
      )
  }

  return NextResponse.json({ success: true })
}
