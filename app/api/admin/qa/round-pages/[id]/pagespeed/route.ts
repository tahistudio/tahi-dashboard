import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { runPageSpeed, type PsiSummary } from '@/lib/qa/pagespeed'
import { loadRoundPage, targetOrigin } from '@/lib/qa/server'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

type StoredPagespeed = Partial<Record<'mobile' | 'desktop', PsiSummary>>

function parseStoredPagespeed(raw: string | null): StoredPagespeed {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as StoredPagespeed) : {}
  } catch {
    return {}
  }
}

// POST /api/admin/qa/round-pages/[id]/pagespeed
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
  if (body.strategy !== 'mobile' && body.strategy !== 'desktop') {
    return NextResponse.json({ error: "strategy must be 'mobile' or 'desktop'" }, { status: 400 })
  }
  const strategy = body.strategy

  const database = (await db()) as D1
  const loaded = await loadRoundPage(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })
  const { roundPage, round, site } = loaded
  if (round.target !== 'live') {
    return NextResponse.json({ error: 'PageSpeed runs against the live site' }, { status: 400 })
  }
  const liveOrigin = targetOrigin(site, 'live')
  if (!liveOrigin) return NextResponse.json({ error: 'The site has no live URL' }, { status: 400 })

  let summary: PsiSummary
  try {
    summary = await runPageSpeed(`${liveOrigin}${roundPage.path}`, strategy, process.env.GOOGLE_PSI_API_KEY)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'PageSpeed failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }

  const merged: StoredPagespeed = { ...parseStoredPagespeed(roundPage.pagespeed), [strategy]: summary }
  await database.update(schema.qaRoundPages)
    .set({ pagespeed: JSON.stringify(merged), pagespeedAt: summary.fetchedAt, updatedAt: summary.fetchedAt })
    .where(eq(schema.qaRoundPages.id, roundPage.id))
  return NextResponse.json({ strategy, summary, pagespeed: merged })
}
