/**
 * POST /api/admin/content/health/indexnow
 *
 * Submits URLs to IndexNow (Bing + Yandex's "tell us you updated this
 * URL" protocol). Cloudflare / Microsoft accept the submissions; Google
 * does NOT participate (their public Indexing API is restricted to Job
 * Postings + Broadcast Events — see ./gsc-submit-url/README.md).
 *
 * Setup (one-time, done by Liam):
 *   1. Generate a 32+ char hex key.
 *   2. Set INDEXNOW_KEY env in Webflow Cloud.
 *   3. Upload a file named "{key}.txt" containing the same key to
 *      https://www.tahi.studio/{key}.txt (Webflow allows static file
 *      uploads in Site Settings → SEO).
 *
 * Contract:
 *   POST body: { urls: string[] }
 *   200: { submitted: number, host: string, status: 'ok' | 'configured' | 'skipped', detail?: string }
 *   400: { error } when urls missing/empty
 *   503: { error } when IndexNow returns a non-2xx (we surface the upstream error)
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'
const HOST = 'www.tahi.studio'

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { urls?: string[] }
  const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u.length > 0) : []
  if (urls.length === 0) {
    return NextResponse.json({ error: 'urls array is required' }, { status: 400 })
  }

  const key = process.env.INDEXNOW_KEY ?? 'configure-indexnow-key'
  if (key === 'configure-indexnow-key') {
    console.warn('INDEXNOW_KEY env not set — IndexNow submission skipped. Set it in Webflow Cloud + upload the key file to https://www.tahi.studio/<key>.txt')
    return NextResponse.json({
      submitted: 0,
      host: HOST,
      status: 'skipped',
      detail: 'INDEXNOW_KEY env not configured. Generate a key, set the env, and upload the matching key file to the site root.',
    })
  }

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        host: HOST,
        key,
        keyLocation: `https://${HOST}/${key}.txt`,
        urlList: urls,
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error('IndexNow submission failed', res.status, text.slice(0, 200))
      return NextResponse.json({
        error: `IndexNow returned ${res.status}`,
        detail: text.slice(0, 300),
      }, { status: 503 })
    }
    return NextResponse.json({
      submitted: urls.length,
      host: HOST,
      status: 'ok',
    })
  } catch (err) {
    console.error('IndexNow submission threw', err)
    return NextResponse.json({
      error: 'IndexNow submission failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 503 })
  }
}
