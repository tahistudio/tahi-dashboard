import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { isRecord, loadOrgNames, parseSiteFieldPatch } from '@/lib/qa/server'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** D1 caps bound parameters per statement at 100. Keep each IN list under that. */
const ID_CHUNK = 90

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * GET /api/admin/qa/sites  - active sites, optional ?orgId= filter.
 * POST /api/admin/qa/sites - create a site for a client.
 */
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const orgFilter = new URL(req.url).searchParams.get('orgId')
  const database = (await db()) as D1

  const conditions = [isNull(schema.qaSites.archivedAt)]
  if (orgFilter) conditions.push(eq(schema.qaSites.orgId, orgFilter))
  const sites = await database.select().from(schema.qaSites)
    .where(and(...conditions))
    .orderBy(schema.qaSites.name)

  // Newest open round per site.
  const openRounds: (typeof schema.qaRounds.$inferSelect)[] = []
  for (const ids of chunk(sites.map(s => s.id), ID_CHUNK)) {
    openRounds.push(...await database.select().from(schema.qaRounds)
      .where(and(eq(schema.qaRounds.status, 'open'), inArray(schema.qaRounds.siteId, ids)))
      .orderBy(desc(schema.qaRounds.createdAt)))
  }
  const siteIds = new Set(sites.map(s => s.id))
  const newestOpen = new Map<string, typeof schema.qaRounds.$inferSelect>()
  for (const r of openRounds) {
    if (!siteIds.has(r.siteId)) continue
    const current = newestOpen.get(r.siteId)
    if (!current || r.createdAt > current.createdAt) newestOpen.set(r.siteId, r)
  }

  // One grouped query over every open round's pages, then picked per round.
  const issueColumns = [
    schema.qaRoundPages.a11yCritical, schema.qaRoundPages.a11ySerious, schema.qaRoundPages.a11yModerate,
    schema.qaRoundPages.a11yMinor, schema.qaRoundPages.brokenLinks, schema.qaRoundPages.seoIssues,
    schema.qaRoundPages.launchIssues, schema.qaRoundPages.perfIssues,
  ]
  const vpColumns = [
    schema.qaRoundPages.vpXl, schema.qaRoundPages.vpDesktop, schema.qaRoundPages.vpTablet,
    schema.qaRoundPages.vpMobileL, schema.qaRoundPages.vpMobileP,
  ]
  const statRows: { roundId: string; pageCount: number; ticksDone: number; failing: number; issues: number }[] = []
  for (const ids of chunk([...newestOpen.values()].map(r => r.id), ID_CHUNK)) {
    statRows.push(...await database
      .select({
        roundId: schema.qaRoundPages.roundId,
        pageCount: sql<number>`count(*)`,
        ticksDone: sql<number>`coalesce(sum(${sql.join(vpColumns, sql` + `)}), 0)`,
        failing: sql<number>`coalesce(sum(case when ${schema.qaRoundPages.status} = 'fail' then 1 else 0 end), 0)`,
        issues: sql<number>`coalesce(sum(${sql.join(issueColumns.map(c => sql`coalesce(${c}, 0)`), sql` + `)}), 0)`,
      })
      .from(schema.qaRoundPages)
      .where(inArray(schema.qaRoundPages.roundId, ids))
      .groupBy(schema.qaRoundPages.roundId))
  }
  const statsByRound = new Map(statRows.map(r => [r.roundId, r]))

  const names = await loadOrgNames(database, sites.map(s => s.orgId))
  const items = sites.map(site => {
    const round = newestOpen.get(site.id)
    const stats = round ? statsByRound.get(round.id) : undefined
    return {
      ...site,
      orgName: names.get(site.orgId) ?? null,
      openRound: round ? {
        id: round.id,
        name: round.name,
        target: round.target,
        ticksDone: Number(stats?.ticksDone ?? 0),
        ticksTotal: Number(stats?.pageCount ?? 0) * 5,
        failing: Number(stats?.failing ?? 0),
        issues: Number(stats?.issues ?? 0),
      } : null,
    }
  })
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const body = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const parsed = parseSiteFieldPatch(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const clientId = typeof body.orgId === 'string' ? body.orgId.trim() : ''
  if (!clientId) return NextResponse.json({ error: 'orgId is required' }, { status: 400 })
  const name = parsed.patch.name
  if (!name) return NextResponse.json({ error: 'Name must be 1 to 120 characters' }, { status: 400 })
  const stagingUrl = parsed.patch.stagingUrl ?? null
  const liveUrl = parsed.patch.liveUrl ?? null
  if (!stagingUrl && !liveUrl) {
    return NextResponse.json({ error: 'Add a staging URL or a live URL' }, { status: 400 })
  }

  const database = (await db()) as D1
  const [org] = await database.select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations).where(eq(schema.organisations.id, clientId)).limit(1)
  if (!org) return NextResponse.json({ error: 'Client not found' }, { status: 400 })

  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  const notes = parsed.patch.notes ?? null
  await database.insert(schema.qaSites).values({
    id, orgId: clientId, name, stagingUrl, liveUrl, notes, createdBy: userId, createdAt: now, updatedAt: now,
  })
  return NextResponse.json({
    item: {
      id, orgId: clientId, name, stagingUrl, liveUrl, notes, createdBy: userId, createdAt: now, updatedAt: now,
      archivedAt: null, orgName: org.name, openRound: null,
    },
  }, { status: 201 })
}
