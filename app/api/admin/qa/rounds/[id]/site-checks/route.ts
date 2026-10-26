import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { runSiteChecks } from '@/lib/qa/site-checks'
import { loadRound, serverFetch, targetOrigin } from '@/lib/qa/server'
import { isSafePublicUrl } from '@/lib/qa/ssrf'
import type { QaTarget } from '@/lib/qa/types'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

// POST /api/admin/qa/rounds/[id]/site-checks
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const { id } = await ctx.params
  const database = (await db()) as D1
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { round, site } = loaded
  if (round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })
  const target = round.target as QaTarget

  const origin = targetOrigin(site, target)
  if (!origin || !isSafePublicUrl(origin)) {
    return NextResponse.json({ error: 'The site has no safe public URL for this target' }, { status: 400 })
  }

  const checks = await runSiteChecks(origin, target, serverFetch)
  const now = new Date().toISOString()
  await database.update(schema.qaRounds)
    .set({ siteChecks: JSON.stringify(checks), siteChecksAt: now })
    .where(eq(schema.qaRounds.id, round.id))
  return NextResponse.json({ checks })
}
