import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolvePermissions, can } from '@/lib/permissions'
import { requireFeature } from '@/lib/require-feature'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { BRIEF_FEATURES, briefCacheKeyForFingerprint, briefScopeFingerprint } from '@/lib/brief-cache-key'
import { BRIEF_CACHE_KEY, computeBrief, readBriefCache, writeBriefCache, isBriefFresh, sweepStaleBriefCache, type D1 } from '@/lib/overview-brief'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const denied = await requireFeature(auth, 'overview')
  if (denied) return denied

  const database = await db()
  const drizzle = database as D1
  const now = new Date()

  // One resolve of the caller's permissions and org scope, used for both the
  // cache key and (on a miss) computeBrief itself. Resolving twice put a
  // handful of D1 queries on the previously pure cache-read path.
  const access = await resolvePermissions(drizzle, auth)
  const allowedOrgs = await resolveAccessScoping(drizzle, auth.userId)
  const features = BRIEF_FEATURES.filter((feature) => can(access, feature))
  const cacheKey = briefCacheKeyForFingerprint(
    BRIEF_CACHE_KEY,
    briefScopeFingerprint(allowedOrgs, features),
  )

  const cached = await readBriefCache(drizzle, cacheKey)
  if (cached && isBriefFresh(cached.generatedAt, now)) {
    return NextResponse.json({
      urgent: cached.urgent,
      week: cached.week,
      slept: cached.slept,
      generatedAt: cached.generatedAt,
    })
  }

  const result = await computeBrief(drizzle, auth, { access, allowedOrgs })
  const generatedAt = now.toISOString()
  await writeBriefCache(drizzle, result, generatedAt, cacheKey)
  // A scope that stops being used (a rule edited, a member offboarded) would
  // otherwise leave its brief row in `settings` forever. Swept on the miss
  // path only, so a cache hit stays a single read.
  await sweepStaleBriefCache(drizzle, now)
  return NextResponse.json({ ...result, generatedAt })
}
