/**
 * POST /api/admin/qa/rounds/[id]/samples
 *      Body: { groupKey: string, count?: integer 1 to 20 (default 3) }.
 *      Adds the next pages of that template group (sorted by path) that this
 *      round does not yet include. New rows are placed directly after the
 *      group's current last sortOrder; later rows shift down so ordering stays
 *      unique. 409 when the round is closed.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { loadRound } from '@/lib/qa/server'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** D1 caps bound parameters per statement at 100. A round page row binds 13 (7 rows = 91). */
const ROUND_PAGE_INSERT_CHUNK = 7
const DEFAULT_COUNT = 3
const MAX_COUNT = 20

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const body: unknown = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const groupKey = typeof body.groupKey === 'string' ? body.groupKey.trim() : ''
  if (!groupKey) return NextResponse.json({ error: 'groupKey is required' }, { status: 400 })
  let count = DEFAULT_COUNT
  if (body.count !== undefined) {
    if (typeof body.count !== 'number' || !Number.isInteger(body.count) || body.count < 1 || body.count > MAX_COUNT) {
      return NextResponse.json({ error: 'count must be an integer from 1 to 20' }, { status: 400 })
    }
    count = body.count
  }

  const { id } = await params
  const database = (await db()) as D1
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { round, site } = loaded
  if (round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })

  const roundPages = await database.select().from(schema.qaRoundPages).where(eq(schema.qaRoundPages.roundId, round.id))
  const included = new Set(roundPages.map(p => p.pageId))
  const groupOrders = roundPages.filter(p => p.groupKey === groupKey).map(p => p.sortOrder)
  const allOrders = roundPages.map(p => p.sortOrder)
  const base = groupOrders.length > 0 ? Math.max(...groupOrders) : allOrders.length > 0 ? Math.max(...allOrders) : -1

  const candidates = (await database.select().from(schema.qaPages)
    .where(and(
      eq(schema.qaPages.siteId, site.id),
      eq(schema.qaPages.groupKey, groupKey),
      isNull(schema.qaPages.removedAt),
    )))
    .filter(p => !included.has(p.id))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .slice(0, count)

  if (candidates.length === 0) return NextResponse.json({ items: [], added: 0 })

  const now = new Date().toISOString()
  const items = candidates.map((page, i) => ({
    id: crypto.randomUUID(),
    roundId: round.id,
    pageId: page.id,
    path: page.path,
    groupKey,
    sortOrder: base + 1 + i,
    updatedAt: now,
  }))

  const shift = database.update(schema.qaRoundPages)
    .set({ sortOrder: sql`${schema.qaRoundPages.sortOrder} + ${items.length}` })
    .where(and(eq(schema.qaRoundPages.roundId, round.id), gt(schema.qaRoundPages.sortOrder, base)))
  const inserts = chunkRows(items).map(rows => database.insert(schema.qaRoundPages).values(rows))
  const writes = [shift, ...inserts]
  await database.batch([writes[0], ...writes.slice(1)])

  return NextResponse.json({ items, added: items.length })
}

function chunkRows<T>(rows: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += ROUND_PAGE_INSERT_CHUNK) out.push(rows.slice(i, i + ROUND_PAGE_INSERT_CHUNK))
  return out
}
