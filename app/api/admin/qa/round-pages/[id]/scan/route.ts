/**
 * POST /api/admin/qa/round-pages/[id]/scan
 *      Body: { viewport: QaViewportKey, browser?: QaBrowserKey (default: the round's first browser), result: QaScanResult }.
 *      Stores one viewport's normalised scan for one browser (replacing any earlier scan for that
 *      viewport and browser), stamps scannedAt on the round page and recomputes its issue counts.
 *      The viewport must be a registry key (400 before any database work). After the round loads:
 *      404, 409 when it is closed, 400 when the browser is not part of the round, then 400 when
 *      the viewport is not in the round's viewport set (a legacy round uses the five legacy keys).
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
import { normaliseScanResult } from '@/lib/qa/normalise-scan'
import { parseRoundBrowsers } from '@/lib/qa/browsers'
import { isQaBrowserKey, isQaViewportKey, parseRoundViewports, type QaBrowserKey } from '@/lib/qa/types'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const MAX_RESULT_CHARS = 512_000

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
  const viewport = body.viewport
  if (!isQaViewportKey(viewport)) {
    return NextResponse.json({ error: 'viewport must be a viewport key such as laptop_m' }, { status: 400 })
  }
  let requestedBrowser: QaBrowserKey | null = null
  if (body.browser !== undefined && body.browser !== null) {
    if (!isQaBrowserKey(body.browser)) {
      return NextResponse.json({ error: 'browser must be chromium, firefox or webkit' }, { status: 400 })
    }
    requestedBrowser = body.browser
  }
  if (!isRecord(body.result)) {
    return NextResponse.json({ error: 'result is not a scan result' }, { status: 400 })
  }
  if (JSON.stringify(body.result).length > MAX_RESULT_CHARS) {
    return NextResponse.json({ error: 'Scan result is too large' }, { status: 413 })
  }
  // The scanner shares a realm with the client site, so every scan is hostile input.
  const serialised = JSON.stringify(normaliseScanResult(body.result))

  const { id } = await params
  const database = (await db()) as D1
  const loaded = await loadRoundPage(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (loaded.round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })
  // No browser named: the round's first one.
  const roundBrowsers = parseRoundBrowsers(loaded.round.browsers)
  const browser = requestedBrowser ?? roundBrowsers[0]
  if (!roundBrowsers.includes(browser)) {
    return NextResponse.json({ error: 'That browser is not part of this round' }, { status: 400 })
  }
  const viewportSet = parseRoundViewports(loaded.round.viewports)
  if (!viewportSet.includes(viewport)) {
    return NextResponse.json({ error: `viewport ${viewport} is not part of this round (it uses: ${viewportSet.join(', ')})` }, { status: 400 })
  }

  const now = new Date().toISOString()
  await database.insert(schema.qaScanResults)
    .values({ roundPageId: id, viewport, browser, result: serialised, createdAt: now })
    .onConflictDoUpdate({
      target: [schema.qaScanResults.roundPageId, schema.qaScanResults.viewport, schema.qaScanResults.browser],
      set: { result: serialised, createdAt: now },
    })
  await database.update(schema.qaRoundPages)
    .set({ scannedAt: now, updatedAt: now })
    .where(eq(schema.qaRoundPages.id, id))
  try {
    await recomputeCounts(database, id)
  } catch {
    return NextResponse.json({ ok: true, counts: null })
  }

  const [row] = await database.select().from(schema.qaRoundPages).where(eq(schema.qaRoundPages.id, id)).limit(1)
  const counts = row
    ? {
        a11yCritical: row.a11yCritical, a11ySerious: row.a11ySerious, a11yModerate: row.a11yModerate, a11yMinor: row.a11yMinor,
        brokenLinks: row.brokenLinks, seoIssues: row.seoIssues, launchIssues: row.launchIssues, perfIssues: row.perfIssues,
      }
    : null
  return NextResponse.json({ ok: true, counts })
}
