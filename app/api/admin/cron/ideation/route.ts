/**
 * POST /api/admin/cron/ideation
 *
 * The Phase I Slice 1 Monday ideation cron. Reads the available signal
 * sources (GA4 + GSC + SE Ranking + Matomo + sitemap + clusters),
 * compiles a research brief, asks Claude Sonnet for 6-8 content ideas
 * with structured output, and inserts them into `content_ideas` with
 * `status='proposed'` so Liam can triage them in /content-studio.
 *
 * Auth: TAHI_CRON_SECRET (matching the affiliate-reactivation pattern)
 * OR admin session.
 *
 * Settings consulted:
 *   content.ideationEnabled  — master toggle. 'true' to run the
 *                              scheduled cron. The manual "Run now"
 *                              button passes ?force=1 to bypass.
 *   content.ga4PropertyId    — required for GA4 signal. Skipped if blank.
 *   content.matomoUrl + .matomoToken — optional Matomo signal.
 *   content.seRankingApiKey  — optional SE Ranking signal.
 *   content.weeklyIdeaTarget — number of ideas to generate (default 7).
 *
 * Body / query:
 *   { dryRun?: boolean }   — when true, runs everything but does NOT
 *                            insert into content_ideas. Returns the
 *                            generated ideas in the response.
 *   ?force=1               — ignore content.ideationEnabled (manual
 *                            run from the UI).
 *
 * Returns the cron summary: ideas inserted, signals pulled, week label.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, inArray } from 'drizzle-orm'
import { assertCronAuth, logCronRun } from '@/lib/cron-runs'
import {
  getGoogleAccessToken, GoogleNotConnectedError,
  runGa4Report, searchAnalytics,
} from '@/lib/google'
import { DEFAULT_CLUSTERS } from '@/lib/content-clusters'
import { isoWeekLabel } from '@/lib/iso-week'

export const dynamic = 'force-dynamic'

const SITE_URL = 'https://www.tahi.studio/'
const SITEMAP_URL = 'https://www.tahi.studio/sitemap.xml'
const MODEL = 'claude-sonnet-5'

// ── Signal types ──────────────────────────────────────────────────────────

interface Ga4PageRow { path: string; pageviews: number }
interface GscGapRow { query: string; page: string; impressions: number; clicks: number; position: number }
interface SeRankingGap { keyword: string; competitor: string; position: number }
interface MatomoPageRow { path: string; pageviews: number }

interface SignalBundle {
  ga4: { property: string | null; rows: Ga4PageRow[]; skipped: string | null }
  gsc: { rows: GscGapRow[]; skipped: string | null }
  seRanking: { rows: SeRankingGap[]; skipped: string | null }
  matomo: { rows: MatomoPageRow[]; skipped: string | null }
  sitemapCount: number
  clusters: Array<{ id: string; name: string; slug: string; description: string | null }>
}

// ── Signal pulls (each one swallows errors so a missing signal doesn't
// block the run) ───────────────────────────────────────────────────────────

async function pullGa4(database: Awaited<ReturnType<typeof db>>, propertyId: string): Promise<{ rows: Ga4PageRow[]; skipped: string | null }> {
  try {
    const tokens = await getGoogleAccessToken(database)
    const rows = await runGa4Report(tokens.accessToken, propertyId, {
      startDate: '30daysAgo',
      endDate: 'today',
      dimensions: ['pagePath'],
      metrics: ['screenPageViews'],
      limit: 50,
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
    })
    return {
      rows: rows.map(r => ({
        path: r.dimensionValues[0]?.value ?? '',
        pageviews: parseInt(r.metricValues[0]?.value ?? '0', 10) || 0,
      })).filter(r => r.path),
      skipped: null,
    }
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return { rows: [], skipped: 'Google Workspace not connected' }
    }
    return { rows: [], skipped: err instanceof Error ? err.message : String(err) }
  }
}

async function pullGsc(database: Awaited<ReturnType<typeof db>>): Promise<{ rows: GscGapRow[]; skipped: string | null }> {
  try {
    const tokens = await getGoogleAccessToken(database)
    // Last 90d, query + page dims. Filter to positions 11-30 with
    // impressions > 50 — page-2 query gaps.
    const today = new Date()
    const start = new Date(today.getTime() - 90 * 86400_000)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const raw = await searchAnalytics(tokens.accessToken, SITE_URL, {
      startDate: fmt(start),
      endDate: fmt(today),
      dimensions: ['query', 'page'],
      rowLimit: 1000,
    })
    const filtered: GscGapRow[] = raw
      .filter(r => r.position >= 11 && r.position <= 30 && r.impressions >= 50)
      .map(r => ({
        query: r.keys[0] ?? '',
        page: r.keys[1] ?? '',
        impressions: r.impressions,
        clicks: r.clicks,
        position: r.position,
      }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 60)
    return { rows: filtered, skipped: null }
  } catch (err) {
    if (err instanceof GoogleNotConnectedError) {
      return { rows: [], skipped: 'Google Workspace not connected' }
    }
    return { rows: [], skipped: err instanceof Error ? err.message : String(err) }
  }
}

async function pullSeRanking(apiKey: string | null): Promise<{ rows: SeRankingGap[]; skipped: string | null }> {
  if (!apiKey) return { rows: [], skipped: 'no SE Ranking key configured' }
  // SE Ranking's API shape varies across their products. The endpoint
  // for keyword competitor gaps is gated behind project IDs we don't
  // store yet. For Slice 1 we treat SE Ranking as a "future expansion"
  // signal and skip it cleanly. The setting still gets persisted so
  // Slice 7 can wire it in without UI changes.
  return { rows: [], skipped: 'SE Ranking integration deferred to Slice 7' }
}

async function pullMatomo(url: string | null, token: string | null): Promise<{ rows: MatomoPageRow[]; skipped: string | null }> {
  if (!url || !token) return { rows: [], skipped: 'no Matomo url + token configured' }
  try {
    // Matomo Reporting API: VisitsSummary + Actions.getPageUrls last 30d.
    // We deliberately keep this best-effort and skip silently on shape
    // mismatch — Matomo here is a sanity check vs GA4, not the source.
    const trimmed = url.replace(/\/+$/, '')
    const params = new URLSearchParams({
      module: 'API',
      method: 'Actions.getPageUrls',
      format: 'json',
      idSite: '1',
      period: 'range',
      date: `previous30`,
      token_auth: token,
      filter_limit: '30',
    })
    const res = await fetch(`${trimmed}/?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      return { rows: [], skipped: `Matomo ${res.status}` }
    }
    const json = await res.json() as Array<{ label?: string; nb_hits?: number; url?: string }>
    const rows: MatomoPageRow[] = Array.isArray(json)
      ? json
          .map(r => ({
            path: r.url ?? r.label ?? '',
            pageviews: Number(r.nb_hits ?? 0),
          }))
          .filter(r => r.path)
          .slice(0, 30)
      : []
    return { rows, skipped: null }
  } catch (err) {
    return { rows: [], skipped: err instanceof Error ? err.message : String(err) }
  }
}

async function pullSitemapCount(): Promise<number> {
  try {
    const res = await fetch(SITEMAP_URL, { headers: { Accept: 'application/xml' } })
    if (!res.ok) return 0
    const xml = await res.text()
    return Array.from(xml.matchAll(/<loc>/g)).length
  } catch {
    return 0
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function readSetting(database: Awaited<ReturnType<typeof db>>, key: string): Promise<string | null> {
  const [row] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1)
  return row?.value ?? null
}

function compileResearchBrief(signals: SignalBundle, weekLabel: string, target: number): string {
  const parts: string[] = []
  parts.push(`Week: ${weekLabel}. Target: ${target} ideas.`)
  parts.push(`Site URL inventory: ${signals.sitemapCount} live URLs.`)

  parts.push('\nACTIVE CLUSTERS (each idea MUST map to a clusterSlug from this list):')
  for (const c of signals.clusters) {
    parts.push(`- ${c.slug} — ${c.name}: ${c.description ?? ''}`)
  }

  parts.push('\nGA4 — TOP PAGES (last 30d, pagePath / pageviews):')
  if (signals.ga4.skipped) {
    parts.push(`(skipped: ${signals.ga4.skipped})`)
  } else if (signals.ga4.rows.length === 0) {
    parts.push('(no rows)')
  } else {
    for (const r of signals.ga4.rows.slice(0, 25)) {
      parts.push(`- ${r.path} — ${r.pageviews} views`)
    }
  }

  parts.push('\nGSC — PAGE-2 QUERY GAPS (positions 11-30, impressions ≥ 50, last 90d). These are opportunities where Tahi nearly ranks but is just below the fold.')
  if (signals.gsc.skipped) {
    parts.push(`(skipped: ${signals.gsc.skipped})`)
  } else if (signals.gsc.rows.length === 0) {
    parts.push('(no rows)')
  } else {
    for (const r of signals.gsc.rows.slice(0, 40)) {
      parts.push(`- "${r.query}" @ pos ${r.position.toFixed(1)} · ${r.impressions} impr · ${r.clicks} clicks · ${r.page}`)
    }
  }

  parts.push('\nSE RANKING — KEYWORD GAPS:')
  if (signals.seRanking.skipped) {
    parts.push(`(skipped: ${signals.seRanking.skipped})`)
  } else {
    for (const r of signals.seRanking.rows.slice(0, 25)) {
      parts.push(`- "${r.keyword}" · competitor ${r.competitor} @ ${r.position}`)
    }
  }

  parts.push('\nMATOMO — TOP PAGES (sanity check vs GA4):')
  if (signals.matomo.skipped) {
    parts.push(`(skipped: ${signals.matomo.skipped})`)
  } else if (signals.matomo.rows.length === 0) {
    parts.push('(no rows)')
  } else {
    for (const r of signals.matomo.rows.slice(0, 15)) {
      parts.push(`- ${r.path} — ${r.pageviews} hits`)
    }
  }

  return parts.join('\n')
}

const SYSTEM_PROMPT = `You are the content ideation strategist for Tahi Studio, a New Zealand Webflow design + development agency.

Your job: read the weekly research brief and propose 6-8 high-quality blog post ideas for the next week. The brief contains the live cluster list, GA4 top pages, GSC page-2 query gaps, optional SE Ranking gaps, optional Matomo, and the live sitemap count.

QUALITY BARS

1. Each idea MUST map to one of the cluster slugs listed in the brief. No invented slugs.
2. Bias HEAVILY toward the "number + opinion + personal milestone" pattern — e.g. "After 3 years running a Webflow agency, here are the 7 lies I stopped telling clients." This pattern is what we know works for Tahi's voice. Apply it to at least half the ideas.
3. Mix intents across the slate: definition (1,100-1,300 words), how-to (1,800-2,200), opinion (900-1,400), comparison (2,400-3,000). Avoid filling the slate with only opinion posts.
4. Each idea MUST reference a concrete signal from the brief in sourceSignal. Examples: "GSC near-miss: 'webflow vs framer' @ pos 14, 1.2k impr/90d", "GA4 decay: /blog/webflow-seo dropped 60% MoM", "fresh cluster — sustainable-web has 0 recent posts". Do not invent signals.
5. Author classification: design-topic ideas → "Staci". Everything else → "Liam".
6. NZ English (colour, organise, centre). No em or en dashes — use commas or full stops.

OUTPUT FORMAT (strict JSON only — your entire response must be a single JSON object, no markdown, no commentary):

{
  "ideas": [
    {
      "title": "string — 52-58 chars where possible",
      "brand": "Liam" | "Staci",
      "clusterSlug": "string — must be one of the cluster slugs in the brief",
      "angle": "string — one sentence stating the unique angle / argument",
      "targetKeyword": "string — primary target keyword or query",
      "sourceSignal": "string — concrete signal from the brief that drove this idea",
      "recommendedWordCount": 1100 | 1300 | 1800 | 2000 | 2200 | 900 | 1200 | 1400 | 2400 | 2700 | 3000,
      "rationale": "string — 2-3 sentences. Why this idea now, what gap it fills, how it ladders to a business outcome (lead, AEO citation, topical authority)."
    }
  ]
}`

interface ProposedIdea {
  title: string
  brand: 'Liam' | 'Staci'
  clusterSlug: string
  angle: string
  targetKeyword: string
  sourceSignal: string
  recommendedWordCount: number
  rationale: string
}

function safeParseIdeas(raw: string): ProposedIdea[] {
  // Strip ```json fences if any.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // Sometimes the model wraps with prose. Find the first { … last }
    // pair as a fallback.
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return []
    try {
      parsed = JSON.parse(match[0])
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  const arr = (parsed as { ideas?: unknown }).ideas
  if (!Array.isArray(arr)) return []
  return arr
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i): ProposedIdea => ({
      title: String(i.title ?? '').trim(),
      brand: i.brand === 'Staci' ? 'Staci' : 'Liam',
      clusterSlug: String(i.clusterSlug ?? '').trim(),
      angle: String(i.angle ?? '').trim(),
      targetKeyword: String(i.targetKeyword ?? '').trim(),
      sourceSignal: String(i.sourceSignal ?? '').trim(),
      recommendedWordCount: Number.isFinite(Number(i.recommendedWordCount))
        ? Number(i.recommendedWordCount)
        : 1500,
      rationale: String(i.rationale ?? '').trim(),
    }))
    .filter(i => i.title.length > 0 && i.clusterSlug.length > 0)
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const auth = await assertCronAuth(req)
  if (!auth.ok) return auth.response!

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'
  const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean; force?: boolean }
  const dryRun = body.dryRun === true
  const bypassEnabled = force || body.force === true

  const database = await db() as unknown as Parameters<typeof logCronRun>[0]

  // Master toggle. Manual UI run bypasses.
  if (!bypassEnabled) {
    const enabled = await readSetting(database as unknown as Awaited<ReturnType<typeof db>>, 'content.ideationEnabled')
    if (enabled !== 'true') {
      const summary = { skipped: 'content.ideationEnabled is not true' }
      await logCronRun(database, 'ideation', 'skipped', Date.now() - t0, summary, null)
      return NextResponse.json(summary)
    }
  }

  const realDb = database as unknown as Awaited<ReturnType<typeof db>>

  // Ensure clusters exist. If empty, seed defaults inline so the first
  // cron run isn't blocked on a missing setup step.
  let clusters = await realDb
    .select()
    .from(schema.contentClusters)
    .where(eq(schema.contentClusters.status, 'active'))
  if (clusters.length === 0) {
    const now = new Date().toISOString()
    for (const c of DEFAULT_CLUSTERS) {
      await realDb.insert(schema.contentClusters).values({
        id: crypto.randomUUID(),
        name: c.name,
        slug: c.slug,
        description: c.description,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
    }
    clusters = await realDb
      .select()
      .from(schema.contentClusters)
      .where(eq(schema.contentClusters.status, 'active'))
  }
  const clusterBySlug = new Map(clusters.map(c => [c.slug, c]))

  // Settings
  const [ga4PropId, matomoUrl, matomoToken, seRankingKey, targetSetting] = await Promise.all([
    readSetting(realDb, 'content.ga4PropertyId'),
    readSetting(realDb, 'content.matomoUrl'),
    readSetting(realDb, 'content.matomoToken'),
    readSetting(realDb, 'content.seRankingApiKey'),
    readSetting(realDb, 'content.weeklyIdeaTarget'),
  ])
  const targetCount = (() => {
    const n = parseInt(targetSetting ?? '', 10)
    if (!Number.isFinite(n) || n < 3 || n > 12) return 7
    return n
  })()

  // Pull signals in parallel
  const [ga4, gsc, seRanking, matomo, sitemapCount] = await Promise.all([
    ga4PropId
      ? pullGa4(realDb, ga4PropId)
      : Promise.resolve({ rows: [] as Ga4PageRow[], skipped: 'no content.ga4PropertyId set' }),
    pullGsc(realDb),
    pullSeRanking(seRankingKey),
    pullMatomo(matomoUrl, matomoToken),
    pullSitemapCount(),
  ])

  const signals: SignalBundle = {
    ga4: { property: ga4PropId, rows: ga4.rows, skipped: ga4.skipped },
    gsc: { rows: gsc.rows, skipped: gsc.skipped },
    seRanking: { rows: seRanking.rows, skipped: seRanking.skipped },
    matomo: { rows: matomo.rows, skipped: matomo.skipped },
    sitemapCount,
    clusters: clusters.map(c => ({ id: c.id, name: c.name, slug: c.slug, description: c.description })),
  }

  const weekLabel = isoWeekLabel()
  const brief = compileResearchBrief(signals, weekLabel, targetCount)

  // Anthropic call
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    const error = 'ANTHROPIC_API_KEY not configured'
    await logCronRun(database, 'ideation', 'error', Date.now() - t0, null, error)
    return NextResponse.json({ error }, { status: 500 })
  }
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  let ideas: ProposedIdea[] = []
  let tokensUsed = 0
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: brief }],
    })
    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
    ideas = safeParseIdeas(text)
    const usage = response.usage as { input_tokens: number; output_tokens: number }
    tokensUsed = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logCronRun(database, 'ideation', 'error', Date.now() - t0, null, message)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  // Filter to ideas with a valid cluster slug — otherwise the FK is null
  // and the UI's cluster grouping breaks.
  const validIdeas = ideas.filter(i => clusterBySlug.has(i.clusterSlug))

  let inserted = 0
  const insertedRows: Array<{ id: string; title: string }> = []
  const now = new Date().toISOString()

  if (!dryRun) {
    for (const idea of validIdeas) {
      const cluster = clusterBySlug.get(idea.clusterSlug)
      if (!cluster) continue
      const id = crypto.randomUUID()
      await realDb.insert(schema.contentIdeas).values({
        id,
        clusterId: cluster.id,
        title: idea.title,
        angle: idea.angle,
        targetKeyword: idea.targetKeyword,
        sourceSignal: idea.sourceSignal,
        signalSources: JSON.stringify({
          ga4PageCount: signals.ga4.rows.length,
          gscGapCount: signals.gsc.rows.length,
          seRankingCount: signals.seRanking.rows.length,
          matomoCount: signals.matomo.rows.length,
        }),
        recommendedWordCount: idea.recommendedWordCount,
        rationale: idea.rationale,
        brand: idea.brand,
        score: null,
        status: 'proposed',
        weekLabel,
        liamOpinion: null,
        liamAnswers: null,
        createdAt: now,
        updatedAt: now,
      })
      insertedRows.push({ id, title: idea.title })
      inserted++
    }

    // Notify the default lead owner (Liam) that fresh ideas are ready
    // for triage. Single notification per cron run.
    if (inserted > 0) {
      try {
        const [ownerRow] = await realDb
          .select({ value: schema.settings.value })
          .from(schema.settings)
          .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
          .limit(1)
        const recipient = ownerRow?.value?.trim()
        if (recipient) {
          await realDb.insert(schema.notifications).values({
            id: crypto.randomUUID(),
            userId: recipient,
            userType: 'team_member',
            eventType: 'content_ideation',
            title: `${inserted} new content ideas ready for triage`,
            body: `Week ${weekLabel}. Open /content-studio?tab=ideas to approve or reject.`,
            entityType: 'content_week',
            entityId: `week:${weekLabel}`,
            read: false,
            createdAt: now,
          })
        }
      } catch {
        // Notification plumbing must never break a cron.
      }
    }
  }

  const summary = {
    week: weekLabel,
    target: targetCount,
    generated: ideas.length,
    inserted,
    dryRun,
    tokensUsed,
    signals: {
      ga4: { property: ga4PropId, count: signals.ga4.rows.length, skipped: signals.ga4.skipped },
      gsc: { count: signals.gsc.rows.length, skipped: signals.gsc.skipped },
      seRanking: { count: signals.seRanking.rows.length, skipped: signals.seRanking.skipped },
      matomo: { count: signals.matomo.rows.length, skipped: signals.matomo.skipped },
      sitemapCount,
      clusterCount: clusters.length,
    },
    insertedRows: dryRun ? validIdeas : insertedRows,
  }

  await logCronRun(database, 'ideation', 'success', Date.now() - t0, summary, null)
  return NextResponse.json(summary)
  void inArray
  void and
}
