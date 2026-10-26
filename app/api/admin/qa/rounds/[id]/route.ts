/**
 * GET   /api/admin/qa/rounds/[id]
 *       { round, site, pages, groups }. Pages in sortOrder. Each group lists the
 *       site's non-removed page total and how many of them this round samples.
 *
 * PATCH /api/admin/qa/rounds/[id]
 *       Body: { name?: string (1 to 120), status?: 'open' | 'closed' }.
 *       Closing stamps closedAt; reopening clears it.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { loadRound } from '@/lib/qa/server'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await params
  const database = (await db()) as D1
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { round, site } = loaded

  const pages = (await database.select().from(schema.qaRoundPages).where(eq(schema.qaRoundPages.roundId, round.id)))
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const sitePages = await database.select().from(schema.qaPages)
    .where(and(eq(schema.qaPages.siteId, site.id), isNull(schema.qaPages.removedAt)))
  const totals = new Map<string, number>()
  for (const p of sitePages) {
    if (p.groupKey) totals.set(p.groupKey, (totals.get(p.groupKey) ?? 0) + 1)
  }
  const sampled = new Map<string, number>()
  for (const p of pages) {
    if (p.groupKey) sampled.set(p.groupKey, (sampled.get(p.groupKey) ?? 0) + 1)
  }
  const groups = [...sampled.keys()].sort().map(groupKey => ({
    groupKey,
    totalPages: totals.get(groupKey) ?? 0,
    sampled: sampled.get(groupKey) ?? 0,
  }))

  return NextResponse.json({
    round: {
      ...round,
      siteChecks: parseJson(round.siteChecks),
      redirectMap: parseJson(round.redirectMap),
    },
    site,
    pages,
    groups,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const body: unknown = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const update: { name?: string; status?: 'open' | 'closed'; closedAt?: string | null } = {}
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length < 1 || name.length > 120) {
      return NextResponse.json({ error: 'name must be 1 to 120 characters' }, { status: 400 })
    }
    update.name = name
  }
  if (body.status !== undefined) {
    if (body.status !== 'open' && body.status !== 'closed') {
      return NextResponse.json({ error: 'status must be open or closed' }, { status: 400 })
    }
    update.status = body.status
    update.closedAt = body.status === 'closed' ? new Date().toISOString() : null
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { id } = await params
  const database = (await db()) as D1
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await database.update(schema.qaRounds).set(update).where(eq(schema.qaRounds.id, id))
  return NextResponse.json({ item: { ...loaded.round, ...update } })
}
