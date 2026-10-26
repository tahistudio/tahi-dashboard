/**
 * POST /api/admin/qa/round-pages/[id]/scan
 *      Body: { viewport: QaViewportKey, result: QaScanResult }. Stores one
 *      viewport's scan (replacing any earlier scan for that viewport), stamps
 *      scannedAt on the round page and recomputes its issue counts.
 *      413 when the serialised result is over 512 KB.
 */
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { loadRoundPage, recomputeCounts } from '@/lib/qa/server'
import { QA_VIEWPORT_KEYS, type QaViewportKey } from '@/lib/qa/types'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const MAX_RESULT_CHARS = 512_000

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Minimal shape check: the scanner's top-level fields must be present with the right types. */
function isScanResultShape(v: unknown): boolean {
  return isRecord(v)
    && Array.isArray(v.a11y)
    && Array.isArray(v.links)
    && Array.isArray(v.missingAnchors)
    && isRecord(v.seo)
    && isRecord(v.content)
    && isRecord(v.layout)
    && isRecord(v.perf)
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
  const viewport = body.viewport
  if (typeof viewport !== 'string' || !(QA_VIEWPORT_KEYS as readonly string[]).includes(viewport)) {
    return NextResponse.json({ error: `viewport must be one of ${QA_VIEWPORT_KEYS.join(', ')}` }, { status: 400 })
  }
  if (!isScanResultShape(body.result)) {
    return NextResponse.json({ error: 'result is not a scan result' }, { status: 400 })
  }
  const serialised = JSON.stringify(body.result)
  if (serialised.length > MAX_RESULT_CHARS) {
    return NextResponse.json({ error: 'Scan result is too large' }, { status: 413 })
  }

  const { id } = await params
  const database = (await db()) as D1
  const loaded = await loadRoundPage(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })

  const now = new Date().toISOString()
  const vp: QaViewportKey = viewport as QaViewportKey
  await database.insert(schema.qaScanResults)
    .values({ roundPageId: id, viewport: vp, result: serialised, createdAt: now })
    .onConflictDoUpdate({
      target: [schema.qaScanResults.roundPageId, schema.qaScanResults.viewport],
      set: { result: serialised, createdAt: now },
    })
  await database.update(schema.qaRoundPages)
    .set({ scannedAt: now, updatedAt: now })
    .where(eq(schema.qaRoundPages.id, id))
  await recomputeCounts(database, id)

  const [row] = await database.select().from(schema.qaRoundPages).where(eq(schema.qaRoundPages.id, id)).limit(1)
  const counts = row
    ? {
        a11yCritical: row.a11yCritical, a11ySerious: row.a11ySerious, a11yModerate: row.a11yModerate, a11yMinor: row.a11yMinor,
        brokenLinks: row.brokenLinks, seoIssues: row.seoIssues, launchIssues: row.launchIssues, perfIssues: row.perfIssues,
      }
    : null
  return NextResponse.json({ ok: true, counts })
}
