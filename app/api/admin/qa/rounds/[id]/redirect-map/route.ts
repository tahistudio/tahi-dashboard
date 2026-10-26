import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { requireAdmin } from '@/lib/require-admin'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { checkLinks } from '@/lib/qa/link-check'
import { loadRound, serverFetch, targetOrigin } from '@/lib/qa/server'
import { normalisePath } from '@/lib/qa/sitemap'
import type { QaLinkResult } from '@/lib/qa/types'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

interface RedirectMapEntry extends QaLinkResult {
  oldUrl: string
  mappedUrl: string | null
}

const MAX_URLS = 150

function parseUrls(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_URLS) return null
  const out: string[] = []
  for (const v of value) {
    if (typeof v !== 'string' || !v.trim()) return null
    out.push(v.trim())
  }
  return out
}

function parseStoredMap(value: string | null): RedirectMapEntry[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as RedirectMapEntry[]) : []
  } catch {
    return []
  }
}

// POST /api/admin/qa/rounds/[id]/redirect-map
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
  const oldUrls = parseUrls(body.urls)
  if (!oldUrls) return NextResponse.json({ error: 'urls must be 1 to 150 non-empty strings' }, { status: 400 })

  const database = (await db()) as D1
  const loaded = await loadRound(database, id)
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { round, site } = loaded
  if (round.status === 'closed') return NextResponse.json({ error: 'This round is closed' }, { status: 409 })
  if (round.target !== 'live') {
    return NextResponse.json({ error: 'Redirect maps run against the live site' }, { status: 400 })
  }
  const liveOrigin = targetOrigin(site, 'live')
  if (!liveOrigin) return NextResponse.json({ error: 'The site has no live URL' }, { status: 400 })

  const planned = oldUrls.map(oldUrl => {
    const path = normalisePath(oldUrl)
    return { oldUrl, mappedUrl: path === null ? null : `${liveOrigin}${path}` }
  })
  const mappedUrls = [...new Set(planned.flatMap(p => (p.mappedUrl ? [p.mappedUrl] : [])))]
  const { results: checked, unchecked: uncheckedMapped } = mappedUrls.length > 0
    ? await checkLinks(mappedUrls, { fetch: serverFetch, target: 'live' })
    : { results: [] as QaLinkResult[], unchecked: [] as string[] }
  const uncheckedSet = new Set(uncheckedMapped)
  const checkedByUrl = new Map(checked.map(r => [r.url, r]))

  const results: RedirectMapEntry[] = planned.map(p => {
    if (p.mappedUrl === null) {
      return {
        oldUrl: p.oldUrl, mappedUrl: null, url: p.oldUrl, finalUrl: null, status: null, hops: [],
        broken: true, redirectChain: false, stagingOnLive: false, error: 'invalid_url',
      }
    }
    const r = checkedByUrl.get(p.mappedUrl) ?? {
      url: p.mappedUrl, finalUrl: null, status: null, hops: [], broken: false,
      redirectChain: false, stagingOnLive: false, error: 'not_checked',
    }
    return { oldUrl: p.oldUrl, mappedUrl: p.mappedUrl, ...r }
  })

  // Old URLs the fetch budget did not reach, so the caller can send them again.
  const unchecked = planned.filter(p => p.mappedUrl !== null && uncheckedSet.has(p.mappedUrl)).map(p => p.oldUrl)

  // append: true keeps entries stored by earlier calls (matched on oldUrl), so a
  // long list can be sent in batches without each batch replacing the last.
  let stored: RedirectMapEntry[] = results
  if (body.append === true) {
    const previous = parseStoredMap(round.redirectMap)
    const thisCall = new Map(results.map(r => [r.oldUrl, r]))
    const merged = previous.map(r => {
      const next = thisCall.get(r.oldUrl)
      return next && next.error !== 'not_checked' ? next : r
    })
    const known = new Set(previous.map(r => r.oldUrl))
    stored = [...merged, ...results.filter(r => !known.has(r.oldUrl))]
  }
  await database.update(schema.qaRounds)
    .set({ redirectMap: JSON.stringify(stored), redirectMapAt: new Date().toISOString() })
    .where(eq(schema.qaRounds.id, round.id))
  return NextResponse.json({ results, unchecked })
}
