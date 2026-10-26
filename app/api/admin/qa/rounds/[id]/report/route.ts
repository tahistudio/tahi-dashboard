import { NextRequest, NextResponse } from 'next/server'
import { eq, asc } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { loadRound } from '@/lib/qa/server'
import { QA_VIEWPORT_KEYS, type QaPageCounts, type QaPageStatus, type QaViewportKey } from '@/lib/qa/types'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RoundPageRow = typeof schema.qaRoundPages.$inferSelect

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function parseRequestIds(raw: string | null): string[] {
  const parsed = parseJson<unknown>(raw)
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
}

/** Null until the page has been scanned: recomputeCounts writes every count column together. */
function countsFor(row: RoundPageRow): QaPageCounts | null {
  if (row.a11yCritical === null) return null
  return {
    a11yCritical: row.a11yCritical ?? 0,
    a11ySerious: row.a11ySerious ?? 0,
    a11yModerate: row.a11yModerate ?? 0,
    a11yMinor: row.a11yMinor ?? 0,
    brokenLinks: row.brokenLinks ?? 0,
    seoIssues: row.seoIssues ?? 0,
    launchIssues: row.launchIssues ?? 0,
    perfIssues: row.perfIssues ?? 0,
  }
}

/** Round report data: totals across every page plus the per-page checklist. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const database = await db() as Drizzle
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { round, site } = loaded

  const [org] = await database
    .select({ name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, site.orgId))
    .limit(1)

  const rows = await database
    .select()
    .from(schema.qaRoundPages)
    .where(eq(schema.qaRoundPages.roundId, round.id))
    .orderBy(asc(schema.qaRoundPages.sortOrder))

  const pages = rows.map(row => {
    const ticks: Record<QaViewportKey, boolean> = {
      xl: row.vpXl === 1,
      desktop: row.vpDesktop === 1,
      tablet: row.vpTablet === 1,
      mobile_l: row.vpMobileL === 1,
      mobile_p: row.vpMobileP === 1,
    }
    return {
      id: row.id,
      path: row.path,
      status: row.status as QaPageStatus,
      ticks,
      counts: countsFor(row),
      note: row.note,
      requestIds: parseRequestIds(row.requestIds),
    }
  })

  const sumCounts = (pick: (c: QaPageCounts) => number) =>
    pages.reduce((total, p) => total + (p.counts ? pick(p.counts) : 0), 0)
  const ticksDone = pages.reduce(
    (total, p) => total + QA_VIEWPORT_KEYS.filter(key => p.ticks[key]).length,
    0,
  )

  const totals = {
    pages: pages.length,
    ticksDone,
    ticksTotal: pages.length * QA_VIEWPORT_KEYS.length,
    pass: pages.filter(p => p.status === 'pass').length,
    fail: pages.filter(p => p.status === 'fail').length,
    untested: pages.filter(p => p.status === 'untested').length,
    a11yCritical: sumCounts(c => c.a11yCritical),
    a11ySerious: sumCounts(c => c.a11ySerious),
    brokenLinks: sumCounts(c => c.brokenLinks),
    seoIssues: sumCounts(c => c.seoIssues),
    launchIssues: sumCounts(c => c.launchIssues),
    perfIssues: sumCounts(c => c.perfIssues),
  }

  return NextResponse.json({
    round: {
      id: round.id,
      siteId: round.siteId,
      name: round.name,
      target: round.target,
      status: round.status,
      createdAt: round.createdAt,
      closedAt: round.closedAt,
      siteChecksAt: round.siteChecksAt,
      redirectMapAt: round.redirectMapAt,
    },
    site: {
      id: site.id,
      name: site.name,
      orgId: site.orgId,
      stagingUrl: site.stagingUrl,
      liveUrl: site.liveUrl,
    },
    orgName: org?.name ?? null,
    totals,
    pages,
    siteChecks: parseJson<unknown[]>(round.siteChecks),
    redirectMap: parseJson<unknown[]>(round.redirectMap),
  })
}
