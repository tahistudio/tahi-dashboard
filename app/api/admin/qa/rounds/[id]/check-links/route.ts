import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { checkLinks } from '@/lib/qa/link-check'
import { loadRound, recomputeCounts, rowToLinkResult, serverFetch } from '@/lib/qa/server'
import type { QaLinkResult, QaTarget } from '@/lib/qa/types'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

const MAX_URLS = 100
/**
 * Most pages recomputed per request. A recompute costs about 3 to 4 D1
 * queries once the round and site are preloaded, so 40 pages is roughly 160
 * subrequests. Add the 400 fetch budget, about 13 upserts and a few lookups
 * and one request stays near 600 of the roughly 1000 a Worker may make.
 */
const MAX_RECOMPUTE = 40
/** Bound parameters per IN list stay under the D1 limit of 100. */
const IN_CHUNK = 90
/** Each link row binds 11 parameters, so 8 rows stay at 88. */
const UPSERT_ROWS = 8

function parseUrls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_URLS) return null
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string' || !v.trim()) return null
    out.push(v.trim())
  }
  return [...new Set(out)]
}

/**
 * Round pages that have scan rows whose stored links include any of the given
 * URLs. One query per chunk of URLs (1 + 90 bound parameters), filtered inside
 * SQLite with json_each so no scan JSON is loaded into the Worker.
 */
async function pagesLinkingTo(database: D1, roundId: string, urls: string[]): Promise<string[]> {
  const ids = new Set<string>()
  for (let i = 0; i < urls.length; i += IN_CHUNK) {
    const list = sql.join(urls.slice(i, i + IN_CHUNK).map(u => sql`${u}`), sql`, `)
    const rows = await database
      .selectDistinct({ id: schema.qaScanResults.roundPageId })
      .from(schema.qaScanResults)
      .innerJoin(schema.qaRoundPages, eq(schema.qaRoundPages.id, schema.qaScanResults.roundPageId))
      .where(and(
        eq(schema.qaRoundPages.roundId, roundId),
        sql`exists (select 1 from json_each(${schema.qaScanResults.result}, '$.links') as j where json_extract(j.value, '$.url') in (${list}))`,
      ))
    for (const r of rows) ids.add(r.id)
  }
  return [...ids].sort()
}

// POST /api/admin/qa/rounds/[id]/check-links
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await ctx.params
  const raw: unknown = await req.json().catch(() => null)
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const urls = parseUrls(body.urls)
  if (!urls) return NextResponse.json({ error: 'urls must be 1 to 100 non-empty strings' }, { status: 400 })
  const force = body.force === true

  const database = (await db()) as D1
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { round } = loaded
  if (round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })
  const target = round.target as QaTarget

  const cached = new Map<string, QaLinkResult>()
  if (!force) {
    for (let i = 0; i < urls.length; i += IN_CHUNK) {
      const rows = await database.select().from(schema.qaLinkResults).where(and(
        eq(schema.qaLinkResults.roundId, round.id),
        inArray(schema.qaLinkResults.url, urls.slice(i, i + IN_CHUNK)),
      ))
      for (const row of rows) cached.set(row.url, rowToLinkResult(row))
    }
  }

  const remaining = urls.filter(u => force || !cached.has(u))
  const { results: fresh, unchecked } = remaining.length > 0
    ? await checkLinks(remaining, { fetch: serverFetch, target })
    : { results: [] as QaLinkResult[], unchecked: [] as string[] }

  let recomputeSkipped = 0
  if (fresh.length > 0) {
    const checkedAt = new Date().toISOString()
    for (let i = 0; i < fresh.length; i += UPSERT_ROWS) {
      const rows = fresh.slice(i, i + UPSERT_ROWS).map(r => ({
        roundId: round.id,
        url: r.url,
        finalUrl: r.finalUrl,
        status: r.status,
        hops: JSON.stringify(r.hops),
        broken: r.broken ? 1 : 0,
        redirectChain: r.redirectChain ? 1 : 0,
        stagingOnLive: r.stagingOnLive ? 1 : 0,
        error: r.error,
        checkedAt,
      }))
      await database.insert(schema.qaLinkResults).values(rows).onConflictDoUpdate({
        target: [schema.qaLinkResults.roundId, schema.qaLinkResults.url],
        set: {
          finalUrl: sql`excluded.final_url`,
          status: sql`excluded.status`,
          hops: sql`excluded.hops`,
          broken: sql`excluded.broken`,
          redirectChain: sql`excluded.redirect_chain`,
          stagingOnLive: sql`excluded.staging_on_live`,
          error: sql`excluded.error`,
          checkedAt: sql`excluded.checked_at`,
        },
      })
    }

    const affected = await pagesLinkingTo(database, round.id, fresh.map(r => r.url))
    recomputeSkipped = Math.max(0, affected.length - MAX_RECOMPUTE)
    for (const pageId of affected.slice(0, MAX_RECOMPUTE)) await recomputeCounts(database, pageId, loaded)
  }

  const freshByUrl = new Map(fresh.map(r => [r.url, r]))
  const results = urls
    .map(u => freshByUrl.get(u) ?? cached.get(u))
    .filter((r): r is QaLinkResult => r !== undefined)
  return NextResponse.json({ results, unchecked, recomputeSkipped })
}
