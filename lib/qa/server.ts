import { and, eq, inArray } from 'drizzle-orm'
import { schema } from '@/db/d1'
import type { QaLinkResult, QaScanResult, QaTarget, QaViewportKey } from '@/lib/qa/types'
import { countIssues, pageIssues } from '@/lib/qa/issue-rules'
import { parseStoredScan } from '@/lib/qa/normalise-scan'
import { isSafePublicUrl } from '@/lib/qa/ssrf'
import { discardBody, MAX_BODY_BYTES, QA_USER_AGENT, readCappedText, type FetchLike } from '@/lib/qa/link-check'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export function normaliseOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return u.origin
  } catch {
    return null
  }
}

export function targetOrigin(site: { stagingUrl: string | null; liveUrl: string | null }, target: QaTarget): string | null {
  return target === 'live' ? site.liveUrl : site.stagingUrl
}

export async function loadSite(database: D1, id: string) {
  const [site] = await database.select().from(schema.qaSites).where(eq(schema.qaSites.id, id)).limit(1)
  return site ?? null
}

export async function loadRound(database: D1, id: string) {
  const [round] = await database.select().from(schema.qaRounds).where(eq(schema.qaRounds.id, id)).limit(1)
  if (!round) return null
  const site = await loadSite(database, round.siteId)
  return site ? { round, site } : null
}

export async function loadRoundPage(database: D1, id: string) {
  const [rp] = await database.select().from(schema.qaRoundPages).where(eq(schema.qaRoundPages.id, id)).limit(1)
  if (!rp) return null
  const loaded = await loadRound(database, rp.roundId)
  return loaded ? { roundPage: rp, ...loaded } : null
}

export function rowToLinkResult(r: typeof schema.qaLinkResults.$inferSelect): QaLinkResult {
  return {
    url: r.url, finalUrl: r.finalUrl, status: r.status,
    hops: r.hops ? (JSON.parse(r.hops) as QaLinkResult['hops']) : [],
    broken: r.broken === 1, redirectChain: r.redirectChain === 1, stagingOnLive: r.stagingOnLive === 1, error: r.error,
  }
}

/** D1 caps bound parameters per statement at 100. Keep each IN list well under that. */
const LINK_QUERY_CHUNK = 90

export type LoadedRound = NonNullable<Awaited<ReturnType<typeof loadRound>>>

/**
 * Reads the stored scans and link results for one round page and rewrites its
 * count columns. Pass the already-loaded round and site to skip three queries
 * per page when recomputing many pages of the same round.
 */
export async function recomputeCounts(database: D1, roundPageId: string, preloaded?: LoadedRound): Promise<void> {
  const loaded = preloaded ?? await loadRoundPage(database, roundPageId)
  if (!loaded) return
  const { round, site } = loaded
  const scanRows = await database.select().from(schema.qaScanResults).where(eq(schema.qaScanResults.roundPageId, roundPageId))
  if (scanRows.length === 0) return
  const scans: Partial<Record<QaViewportKey, QaScanResult>> = {}
  for (const row of scanRows) scans[row.viewport as QaViewportKey] = parseStoredScan(row.result)
  const urls = [...new Set(Object.values(scans).flatMap(s => s.links.map(l => l.url)))]
  const linkRows: (typeof schema.qaLinkResults.$inferSelect)[] = []
  for (let i = 0; i < urls.length; i += LINK_QUERY_CHUNK) {
    const chunk = urls.slice(i, i + LINK_QUERY_CHUNK)
    const rows = await database.select().from(schema.qaLinkResults)
      .where(and(eq(schema.qaLinkResults.roundId, round.id), inArray(schema.qaLinkResults.url, chunk)))
    linkRows.push(...rows)
  }
  const linkMap = new Map(linkRows.map(r => [r.url, rowToLinkResult(r)]))
  const origin = targetOrigin(site, round.target as QaTarget) ?? ''
  const host = origin ? new URL(origin).hostname : ''
  const c = countIssues(pageIssues(scans, round.target as QaTarget, host, linkMap))
  await database.update(schema.qaRoundPages).set({
    a11yCritical: c.a11yCritical, a11ySerious: c.a11ySerious, a11yModerate: c.a11yModerate, a11yMinor: c.a11yMinor,
    brokenLinks: c.brokenLinks, seoIssues: c.seoIssues, launchIssues: c.launchIssues, perfIssues: c.perfIssues,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.qaRoundPages.id, roundPageId))
}

const FETCH_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 5

/**
 * fetch for server-side checks: global fetch with the QA user agent and an 8s
 * timeout unless the caller supplies a signal. The SSRF guard is applied by
 * the caller's helpers; redirect handling is the caller's choice.
 */
export const serverFetch: FetchLike = (url, init) => {
  const headers = new Headers(init.headers)
  if (!headers.has('user-agent')) headers.set('user-agent', QA_USER_AGENT)
  return fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS) })
}

export interface FetchedText { status: number; text: string; truncated: boolean }

/**
 * Hardened GET for reading small remote documents (sitemaps). Follows up to 5
 * redirects itself and re-checks isSafePublicUrl on every hop, uses one 8s
 * deadline across the whole exchange, and stops reading at 5 MB. Returns null
 * for an unsafe URL, a non-2xx answer, too many redirects, a timeout or any
 * network error.
 */
export async function fetchText(url: string, fetchImpl: FetchLike = serverFetch): Promise<FetchedText | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    let current = url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isSafePublicUrl(current)) return null
      const res = await fetchImpl(current, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': QA_USER_AGENT } })
      const location = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && location) {
        await discardBody(res)
        current = new URL(location, current).toString()
        continue
      }
      if (res.status < 200 || res.status >= 300) {
        await discardBody(res)
        return null
      }
      const { text, truncated } = await readCappedText(res, MAX_BODY_BYTES)
      return { status: res.status, text, truncated }
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseTarget(v: unknown): QaTarget | null {
  return v === 'staging' || v === 'live' ? v : null
}

export const SITE_NAME_MAX = 120
export const SITE_NOTES_MAX = 4000

export type SiteFieldPatch = Partial<{ name: string; stagingUrl: string | null; liveUrl: string | null; notes: string | null }>

function cleanSiteUrl(label: string, value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value !== 'string') return { ok: false, error: `${label} must be a text address` }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  const origin = normaliseOrigin(trimmed)
  if (!origin) return { ok: false, error: `${label} must be an http or https address` }
  if (!isSafePublicUrl(origin)) return { ok: false, error: `${label} must be a public address` }
  return { ok: true, value: origin }
}

/**
 * Validates the site fields present in a request body. Only keys that are
 * present end up in the patch, so the same parser serves POST and PATCH.
 * URLs are stored as origins only (no path).
 */
export function parseSiteFieldPatch(
  body: Record<string, unknown>,
): { ok: true; patch: SiteFieldPatch } | { ok: false; error: string } {
  const patch: SiteFieldPatch = {}
  if ('name' in body) {
    if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > SITE_NAME_MAX) {
      return { ok: false, error: `Name must be 1 to ${SITE_NAME_MAX} characters` }
    }
    patch.name = body.name.trim()
  }
  if ('stagingUrl' in body) {
    const r = cleanSiteUrl('Staging URL', body.stagingUrl)
    if (!r.ok) return r
    patch.stagingUrl = r.value
  }
  if ('liveUrl' in body) {
    const r = cleanSiteUrl('Live URL', body.liveUrl)
    if (!r.ok) return r
    patch.liveUrl = r.value
  }
  if ('notes' in body) {
    if (body.notes !== null && body.notes !== undefined && typeof body.notes !== 'string') {
      return { ok: false, error: 'Notes must be text' }
    }
    const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
    if (notes.length > SITE_NOTES_MAX) return { ok: false, error: `Notes must be ${SITE_NOTES_MAX} characters or fewer` }
    patch.notes = notes || null
  }
  return { ok: true, patch }
}

/** Client names for a set of org ids, read in chunks under the D1 parameter cap. */
export async function loadOrgNames(database: D1, orgIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const ids = [...new Set(orgIds)]
  for (let i = 0; i < ids.length; i += LINK_QUERY_CHUNK) {
    const rows = await database.select({ id: schema.organisations.id, name: schema.organisations.name })
      .from(schema.organisations).where(inArray(schema.organisations.id, ids.slice(i, i + LINK_QUERY_CHUNK)))
    for (const r of rows) out.set(r.id, r.name)
  }
  return out
}
