import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { appOrigin } from '@/lib/app-url'
import { isRecord, loadSite, parseTarget, targetOrigin } from '@/lib/qa/server'
import { isSafePublicUrl } from '@/lib/qa/ssrf'
import { QA_VIEW_TOKEN_TTL_SECONDS, signViewToken } from '@/lib/qa/token'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/qa/view-token  body { siteId, target }
 *
 * Signs a short-lived token for the qa-view proxy. The upstream origin always
 * comes from the stored site row, never from the request body.
 */
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'qa_tester')
  if (featureDenied) return featureDenied
  const adminDenied = await requireAdmin({ userId, orgId })
  if (adminDenied) return adminDenied

  const body = await req.json().catch(() => null)
  if (!isRecord(body)) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  const siteId = typeof body.siteId === 'string' ? body.siteId.trim() : ''
  if (!siteId) return NextResponse.json({ error: 'siteId is required' }, { status: 400 })
  const target = parseTarget(body.target)
  if (!target) return NextResponse.json({ error: "target must be 'staging' or 'live'" }, { status: 400 })

  const database = (await db()) as D1
  const site = await loadSite(database, siteId)
  if (!site || site.archivedAt) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const origin = targetOrigin(site, target)
  if (!origin || !isSafePublicUrl(origin)) {
    return NextResponse.json({ error: 'This site has no URL for that target' }, { status: 400 })
  }

  const secret = process.env.QA_VIEW_SECRET
  const viewOrigin = process.env.NEXT_PUBLIC_QA_VIEW_ORIGIN
  if (!secret || !viewOrigin) {
    return NextResponse.json({ error: 'QA viewer not configured' }, { status: 503 })
  }

  const exp = Math.floor(Date.now() / 1000) + QA_VIEW_TOKEN_TTL_SECONDS
  const token = await signViewToken({ o: origin, p: appOrigin(), exp }, secret)
  return NextResponse.json({
    token,
    baseUrl: `${viewOrigin.replace(/\/+$/, '')}/v/${token}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  })
}
