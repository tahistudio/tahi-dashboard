/**
 * POST /api/admin/cron/indexing-reverser
 *
 * Weekly. For every live blog + glossary URL: check GSC URL Inspection
 * for current indexing state, collect the un-indexed ones, fire
 * IndexNow + GSC "request indexing" equivalents so Google + Bing
 * re-crawl them.
 *
 * Does NOT auto-rewrite — that's the boost-underperformers workflow.
 * This is purely the "tell search engines we still exist" pass.
 *
 * Schedule: Sunday 20:00 UTC. Auth: TAHI_CRON_SECRET.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import {
  getGoogleAccessToken, listGscSites, resolveGscPropertyForUrl, inspectUrl,
} from '@/lib/google'
import { logCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'

const BUDGET_MS = 25_000
const TAHI_BASE = 'https://www.tahi.studio'

interface ItemStatus {
  url: string
  indexStatus: string | null
  lastCrawlTime: string | null
  action: 'already-indexed' | 'indexnow-fired' | 'fetch-failed'
  detail?: string
}

export async function POST(req: NextRequest) {
  const cronHeader = req.headers.get('x-cron-secret') ?? ''
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
  if (!hasCronAuth) {
    const { orgId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const t0 = Date.now()
  const database = await db()

  // 1) Pull every live URL Tahi knows about from the site_index table.
  const rows = await database
    .select({
      url: schema.siteIndex.url,
      type: schema.siteIndex.type,
      isActive: schema.siteIndex.isActive,
    })
    .from(schema.siteIndex)
    .limit(500)
  const urls = rows
    .filter(r => r.isActive === 1 && r.url.startsWith(TAHI_BASE))
    .map(r => r.url)

  // 2) GSC URL Inspection — figure out which are unindexed.
  let accessToken: string | null = null
  let siteUrl: string | null = null
  try {
    const tokens = await getGoogleAccessToken(database)
    accessToken = tokens.accessToken
    const sites = await listGscSites(accessToken)
    const site = resolveGscPropertyForUrl(`${TAHI_BASE}/`, sites)
    siteUrl = site?.siteUrl ?? null
  } catch (err) {
    const summary = { error: 'GSC unavailable', detail: err instanceof Error ? err.message : 'auth' }
    await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'indexing-reverser', 'error', Date.now() - t0, summary, null)
    return NextResponse.json(summary, { status: 503 })
  }

  const unindexedUrls: string[] = []
  const statuses: ItemStatus[] = []

  // Parallel inspection in batches of 6 to respect GSC quota.
  const BATCH = 6
  for (let i = 0; i < urls.length; i += BATCH) {
    if (Date.now() - t0 > BUDGET_MS) break
    const slice = urls.slice(i, i + BATCH)
    type Probe = { url: string; indexStatus: string | null; lastCrawlTime: string | null; error?: string }
    const results = await Promise.allSettled(slice.map(async (url): Promise<Probe> => {
      try {
        const ins = await inspectUrl(accessToken!, url, siteUrl!)
        return { url, indexStatus: ins.indexStatus ?? null, lastCrawlTime: ins.lastCrawlTime ?? null }
      } catch (err) {
        return { url, indexStatus: null, lastCrawlTime: null, error: err instanceof Error ? err.message : 'fail' }
      }
    }))
    for (const r of results) {
      if (r.status !== 'fulfilled') continue
      const v: Probe = r.value
      // GSC indexStatus is normalised to PASS / PARTIAL / FAIL / NEUTRAL
      // / UNKNOWN by our google.ts wrapper. PASS = indexed; everything
      // else is either failing or unknown — both warrant an IndexNow
      // ping.
      const isUnindexed = !v.indexStatus || v.indexStatus !== 'PASS'
      if (v.error) {
        statuses.push({ url: v.url, indexStatus: null, lastCrawlTime: null, action: 'fetch-failed', detail: v.error })
      } else if (isUnindexed) {
        unindexedUrls.push(v.url)
        statuses.push({ url: v.url, indexStatus: v.indexStatus, lastCrawlTime: v.lastCrawlTime, action: 'indexnow-fired' })
      } else {
        statuses.push({ url: v.url, indexStatus: v.indexStatus, lastCrawlTime: v.lastCrawlTime, action: 'already-indexed' })
      }
    }
  }

  // 3) IndexNow ping for the unindexed batch. Two pre-flight checks
  //    so a misconfigured keyLocation doesn't surface as a scary
  //    "error" — it surfaces as "skipped: setup incomplete" with a
  //    direct fix-up note.
  let indexNowSubmitted = 0
  let indexNowStatus: 'ok' | 'skipped' | 'error' = 'ok'
  let indexNowDetail = ''
  if (unindexedUrls.length === 0) {
    indexNowStatus = 'skipped'
    indexNowDetail = 'No unindexed URLs to submit'
  } else {
    const indexnowKey = process.env.INDEXNOW_KEY ?? ''
    if (!indexnowKey || indexnowKey === 'configure-indexnow-key') {
      indexNowStatus = 'skipped'
      indexNowDetail = 'INDEXNOW_KEY env not set'
    } else {
      // Pre-flight: verify keyLocation file is fetchable. If it's not,
      // IndexNow will reject the submission with HTTP 422 / Forbidden.
      // Catch it here with a clear message rather than surfacing as
      // a scary "error" downstream.
      const keyLocationUrl = `${TAHI_BASE}/${indexnowKey}.txt`
      let keyServed = false
      try {
        const probe = await fetch(keyLocationUrl, { signal: AbortSignal.timeout(5000) })
        if (probe.ok) {
          const probeText = await probe.text()
          keyServed = probeText.trim() === indexnowKey
        }
      } catch { /* keyServed stays false */ }
      if (!keyServed) {
        indexNowStatus = 'skipped'
        indexNowDetail = `keyLocation ${keyLocationUrl} not serving the key (Webflow doesn't allow .txt uploads at root; Cloudflare Worker route needs tahi.studio to be in your CF account). Submission skipped to avoid IndexNow rejection.`
      } else {
        try {
          const payload = {
            host: 'www.tahi.studio',
            key: indexnowKey,
            keyLocation: keyLocationUrl,
            urlList: unindexedUrls,
          }
          const res = await fetch('https://api.indexnow.org/indexnow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8000),
          })
          if (res.ok || res.status === 202) {
            indexNowSubmitted = unindexedUrls.length
            indexNowDetail = `HTTP ${res.status} (${unindexedUrls.length} URLs submitted)`
          } else {
            indexNowStatus = 'error'
            indexNowDetail = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`
          }
        } catch (err) {
          indexNowStatus = 'error'
          indexNowDetail = err instanceof Error ? err.message.slice(0, 200) : 'fetch failed'
        }
      }
    }
  }

  const summary = {
    scanned: statuses.length,
    alreadyIndexed: statuses.filter(s => s.action === 'already-indexed').length,
    unindexed: unindexedUrls.length,
    indexNowSubmitted,
    indexNowStatus,
    indexNowDetail,
    fetchFailed: statuses.filter(s => s.action === 'fetch-failed').length,
    durationMs: Date.now() - t0,
    statuses: statuses.slice(0, 100),  // cap response size
  }
  // 'skipped' is a healthy outcome (setup incomplete by design), not error.
  const cronStatus = indexNowStatus === 'error' ? 'error' : 'success'
  await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'indexing-reverser', cronStatus, summary.durationMs, summary, null)
  return NextResponse.json(summary)
}
