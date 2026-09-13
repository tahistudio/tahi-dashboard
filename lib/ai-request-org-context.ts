/**
 * lib/ai-request-org-context.ts
 *
 * A compact "what we already know about this client" block for the request
 * wizard's system prompt. Without it the wizard asks a client to name their
 * own industry or restate a service they have already had built, because
 * nothing about the caller's organisation ever reached the model. With it,
 * the model is told to treat that ground as already covered and, when the
 * org carries more than one brand, to ask which one instead of guessing.
 *
 * GI.4 step one ("the wizard learns the client deeply") adds a second block,
 * CLIENT HISTORY: request volume and its date span, category and size counts
 * (all time and the last 12 months), the categories this client has never
 * asked for, the statuses currently open, the plan (type, tracks, whether a
 * negotiated rate is on file) and, when cheap, hours logged in the last 90
 * days. The wizard uses it to answer "what am I not doing" or "what next"
 * questions from the client's own coverage gaps rather than guessing, then
 * carries on drafting the request in front of it. A full advisor pass over
 * this data (step two) is a separate feature; this module only surfaces the
 * facts.
 *
 * Split into pure formatters (unit tested, no DB) and a thin loader that
 * runs the reads: the org row, its brands, its last few requests, and now
 * the full history aggregates. Every read is scoped to the caller's own org
 * by the caller.
 */

import { schema } from '@/db/d1'
import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { REQUEST_CATEGORIES } from '@/lib/request-vocabulary'
import { REQUEST_CLOSED_STATUSES } from '@/lib/status-config'
import { resolveTracksConfig, getTracksConfigSummary } from '@/lib/plan-utils'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** How many past requests to summarise. Enough to say "you have asked for
 *  X and Y before" without ballooning the prompt on a long-tenured client. */
const RECENT_REQUEST_LIMIT = 5

/** Longest a category/status/gap list gets before it is truncated with a
 *  "(+N more)" marker, so one long-tenured client cannot blow the prompt's
 *  character budget. */
const MAX_LIST_ITEMS = 6

export interface OrgContextOrg {
  name: string
  industry: string | null
  website: string | null
}

export interface OrgContextBrand {
  name: string
  website: string | null
}

export interface OrgContextRequest {
  title: string
  category: string | null
}

/**
 * The aggregates behind the CLIENT HISTORY block. Every count is computed
 * from the org's own rows only; nothing here is shared across clients.
 */
export interface ClientHistoryStats {
  totalRequests: number
  /** yyyy-mm-dd of the earliest and latest request on file. Null when there are none. */
  firstRequestDate: string | null
  lastRequestDate: string | null
  /** category -> count. "Recent" means created in the last 12 months. */
  categoryCountsAllTime: Record<string, number>
  categoryCountsRecent: Record<string, number>
  /** size -> count ('small' | 'large'). "Recent" means the last 12 months. */
  sizeCountsAllTime: Record<string, number>
  sizeCountsRecent: Record<string, number>
  /** The studio's full category vocabulary, so the formatter can name the
   *  ones this client has never touched. */
  allCategories: readonly string[]
  /** status -> count, for requests not yet in a closed status. */
  openStatusCounts: Record<string, number>
  /** organisations.planType, verbatim. Null when unset. */
  planType: string | null
  /** Human label for the resolved track counts, e.g. "1 small track + 2
   *  large tracks". Null only when the loader could not resolve one. */
  tracksLabel: string | null
  /** True when a negotiated custom_mrr is on file for this org. */
  hasCustomRate: boolean
  /** Hours logged against this org in the last 90 days. Null when not
   *  available (the read failed, or the columns predate the feature),
   *  never a false 0. */
  hoursLast90Days: number | null
}

export interface RequestOrgContextInput {
  org: OrgContextOrg | null
  brands: OrgContextBrand[]
  recentRequests: OrgContextRequest[]
  /** The CLIENT HISTORY aggregates. Omitted or null when there is nothing to
   *  add beyond the CLIENT ON FILE block above. */
  history?: ClientHistoryStats | null
}

/** Join a list of already-formatted entries, capping at `max` and marking
 *  what was cut so a prolific client cannot balloon the prompt. */
function truncateJoin(items: string[], max: number = MAX_LIST_ITEMS): string {
  if (items.length <= max) return items.join(', ')
  const hidden = items.length - max
  return `${items.slice(0, max).join(', ')} (+${hidden} more)`
}

/** Render a category/size -> count map as "design 10, development 8", sorted
 *  by count descending so the biggest lines are the ones that survive
 *  truncation. */
function formatCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  return truncateJoin(entries.map(([key, n]) => `${key} ${n}`))
}

/**
 * Pure formatter: turns already-loaded rows into the text block the system
 * prompt appends. Returns an empty string when there is nothing on file at
 * all, so a brand-new org costs the prompt nothing.
 */
export function formatRequestOrgContext(input: RequestOrgContextInput): string {
  const { org, brands, recentRequests, history } = input
  if (!org && brands.length === 0 && recentRequests.length === 0 && !history) return ''

  const lines: string[] = ['CLIENT ON FILE (do not ask for anything already listed here):']

  if (org) {
    lines.push(`- Name: ${org.name}`)
    if (org.industry) lines.push(`- Industry: ${org.industry}`)
    if (org.website) lines.push(`- Website: ${org.website}`)
  }

  if (brands.length > 0) {
    const named = brands.map(b => (b.website ? `${b.name} (${b.website})` : b.name))
    lines.push(`- Brands on file: ${named.join(', ')}`)
    if (brands.length > 1) {
      lines.push(
        '- This client has more than one brand or website on file. Ask which one this request is for before drafting. Never guess.',
      )
    }
  }

  if (recentRequests.length > 0) {
    const recent = recentRequests.map(r => (r.category ? `${r.title} (${r.category})` : r.title))
    lines.push(`- Recent requests: ${recent.join('; ')}`)
  }

  const blocks = [lines.join('\n')]
  if (history) blocks.push(formatClientHistory(history))
  return blocks.join('\n\n')
}

/**
 * Pure formatter for the CLIENT HISTORY block: request volume and its date
 * span, category and size counts (all time and the last 12 months), the
 * categories this client has never requested, the statuses currently open,
 * the plan, and hours logged in the last 90 days when available. Every list
 * is capped at MAX_LIST_ITEMS with a "(+N more)" marker so the block stays
 * well under the prompt's character budget regardless of tenure.
 */
export function formatClientHistory(stats: ClientHistoryStats): string {
  const lines: string[] = ['CLIENT HISTORY (from records; do not ask for anything already covered here):']

  if (stats.totalRequests === 0) {
    lines.push('- No requests on file yet.')
  } else {
    const span = stats.firstRequestDate && stats.lastRequestDate
      ? ` (${stats.firstRequestDate} to ${stats.lastRequestDate})`
      : ''
    lines.push(`- Total requests: ${stats.totalRequests}${span}`)

    const categoriesAllTime = formatCounts(stats.categoryCountsAllTime)
    if (categoriesAllTime) {
      const categoriesRecent = formatCounts(stats.categoryCountsRecent)
      lines.push(`- By category, all time: ${categoriesAllTime}${categoriesRecent ? `; last 12 months: ${categoriesRecent}` : ''}`)
    }

    const sizesAllTime = formatCounts(stats.sizeCountsAllTime)
    if (sizesAllTime) {
      const sizesRecent = formatCounts(stats.sizeCountsRecent)
      lines.push(`- By size, all time: ${sizesAllTime}${sizesRecent ? `; last 12 months: ${sizesRecent}` : ''}`)
    }
  }

  const requested = new Set(
    Object.keys(stats.categoryCountsAllTime).filter(c => (stats.categoryCountsAllTime[c] ?? 0) > 0),
  )
  const neverRequested = stats.allCategories.filter(c => !requested.has(c))
  if (neverRequested.length > 0) {
    lines.push(`- Never requested: ${truncateJoin(neverRequested)}`)
  }

  const open = Object.entries(stats.openStatusCounts).filter(([, n]) => n > 0)
  if (open.length > 0) {
    lines.push(`- Open now: ${truncateJoin(open.map(([status, n]) => `${status} ${n}`))}`)
  }

  const planBits = [stats.planType ?? 'none on file']
  if (stats.tracksLabel) planBits.push(stats.tracksLabel)
  planBits.push(stats.hasCustomRate ? 'negotiated rate on file' : 'list rate')
  lines.push(`- Plan: ${planBits.join(', ')}`)

  if (typeof stats.hoursLast90Days === 'number') {
    lines.push(`- Hours logged, last 90 days: ${stats.hoursLast90Days}`)
  }

  return lines.join('\n')
}

/**
 * The prompt rules both wizard routes append under their static "CLIENT
 * CONTEXT" heading. Lives here, not duplicated in each route's system
 * prompt string, so the two audiences (admin and portal) can never drift on
 * what "use the history" or "answer coverage gaps" means. Route modules may
 * only export HTTP methods and route config, so the wording lives in this
 * lib module and each route imports and interpolates it.
 */
export const CLIENT_HISTORY_PROMPT_RULES = `- If a CLIENT HISTORY section below states this client's request counts, categories, plan, or tracks, treat all of it as already known. Never ask what work this client has had done before, what plan or tracks they are on, or how many requests they have filed.
- If the client asks what they are not doing, what is missing, or what to try next, answer from the coverage gaps and the plan named in CLIENT HISTORY in two sentences, then continue scoping the request in front of you. A full account review is a separate feature; do not attempt one here.`

/**
 * Load and format the context block for one org. Every read is scoped to
 * `orgId`, which the caller has already resolved to the caller's own
 * organisation, never taken from anywhere else on the request body.
 */
export async function loadRequestOrgContext(drizzle: Drizzle, orgId: string): Promise<string> {
  const [orgRow] = await drizzle
    .select({
      name: schema.organisations.name,
      industry: schema.organisations.industry,
      website: schema.organisations.website,
      planType: schema.organisations.planType,
      tracksMode: schema.organisations.tracksMode,
      customSmallTracks: schema.organisations.customSmallTracks,
      customLargeTracks: schema.organisations.customLargeTracks,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)

  const brandRows = await drizzle
    .select({ name: schema.brands.name, website: schema.brands.website })
    .from(schema.brands)
    .where(eq(schema.brands.orgId, orgId))

  // The `brands` table is the current source (migration 0093); a client
  // onboarded before it exists may still only carry the legacy JSON array of
  // brand names on the org row. Used only when the table has nothing, so a
  // migrated client is never shown both.
  let brands: OrgContextBrand[] = brandRows.map(b => ({ name: b.name, website: b.website ?? null }))
  if (brands.length === 0 && orgRow) {
    const [legacy] = await drizzle
      .select({ brands: schema.organisations.brands })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgId))
      .limit(1)
    try {
      const names = legacy?.brands ? JSON.parse(legacy.brands) as unknown : []
      if (Array.isArray(names)) {
        brands = names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
          .map(name => ({ name, website: null }))
      }
    } catch {
      brands = []
    }
  }

  const recentRequests = await drizzle
    .select({ title: schema.requests.title, category: schema.requests.category })
    .from(schema.requests)
    .where(eq(schema.requests.orgId, orgId))
    .orderBy(desc(schema.requests.createdAt))
    .limit(RECENT_REQUEST_LIMIT)

  const history = orgRow ? await loadClientHistoryStats(drizzle, orgId, orgRow) : null

  return formatRequestOrgContext({
    org: orgRow ? { name: orgRow.name, industry: orgRow.industry ?? null, website: orgRow.website ?? null } : null,
    brands,
    recentRequests,
    history,
  })
}

interface OrgHistoryRow {
  planType: string | null
  tracksMode: string | null
  customSmallTracks: number | null
  customLargeTracks: number | null
}

/**
 * Everything CLIENT HISTORY needs beyond the org row already read above: the
 * full request history (own rows only), the active subscription's
 * priority-support flag, the negotiated-rate flag, and, best effort, hours
 * logged in the last 90 days. Never throws: a stat this cannot read is left
 * at its empty default rather than losing the rest of the block.
 */
async function loadClientHistoryStats(
  drizzle: Drizzle,
  orgId: string,
  orgRow: OrgHistoryRow,
): Promise<ClientHistoryStats> {
  const now = new Date()
  const twelveMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, now.getUTCDate())).toISOString()

  const requestRows = await drizzle
    .select({
      category: schema.requests.category,
      size: schema.requests.size,
      status: schema.requests.status,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .where(eq(schema.requests.orgId, orgId))

  const categoryCountsAllTime: Record<string, number> = {}
  const categoryCountsRecent: Record<string, number> = {}
  const sizeCountsAllTime: Record<string, number> = {}
  const sizeCountsRecent: Record<string, number> = {}
  const openStatusCounts: Record<string, number> = {}
  let firstRequestDate: string | null = null
  let lastRequestDate: string | null = null

  for (const row of requestRows) {
    const createdAt = row.createdAt
    const isRecent = createdAt >= twelveMonthsAgo
    if (row.category) {
      categoryCountsAllTime[row.category] = (categoryCountsAllTime[row.category] ?? 0) + 1
      if (isRecent) categoryCountsRecent[row.category] = (categoryCountsRecent[row.category] ?? 0) + 1
    }
    if (row.size) {
      sizeCountsAllTime[row.size] = (sizeCountsAllTime[row.size] ?? 0) + 1
      if (isRecent) sizeCountsRecent[row.size] = (sizeCountsRecent[row.size] ?? 0) + 1
    }
    if (!REQUEST_CLOSED_STATUSES.includes(row.status)) {
      openStatusCounts[row.status] = (openStatusCounts[row.status] ?? 0) + 1
    }
    if (!firstRequestDate || createdAt < firstRequestDate) firstRequestDate = createdAt
    if (!lastRequestDate || createdAt > lastRequestDate) lastRequestDate = createdAt
  }

  let hasPrioritySupport = false
  try {
    const [sub] = await drizzle
      .select({ hasPrioritySupport: schema.subscriptions.hasPrioritySupport })
      .from(schema.subscriptions)
      .where(and(eq(schema.subscriptions.orgId, orgId), eq(schema.subscriptions.status, 'active')))
      .limit(1)
    hasPrioritySupport = !!sub?.hasPrioritySupport
  } catch {
    hasPrioritySupport = false
  }

  const tracksConfig = resolveTracksConfig(
    {
      tracksMode: orgRow.tracksMode,
      customSmallTracks: orgRow.customSmallTracks,
      customLargeTracks: orgRow.customLargeTracks,
    },
    orgRow.planType,
    hasPrioritySupport,
  )
  const tracksLabel = getTracksConfigSummary(tracksConfig)

  // custom_mrr predates the Drizzle schema object (migration 0016) and is
  // read the same defensive way app/api/portal/subscription/route.ts reads
  // it: a plain SQL select, so a database where that migration never landed
  // degrades to "no negotiated rate" rather than losing the rest of the
  // block.
  let hasCustomRate = false
  try {
    const rows = await drizzle.all<{ custom_mrr: number | null }>(
      sql`SELECT custom_mrr FROM organisations WHERE id = ${orgId} LIMIT 1`,
    )
    hasCustomRate = typeof rows?.[0]?.custom_mrr === 'number' && rows[0].custom_mrr > 0
  } catch {
    hasCustomRate = false
  }

  // Hours logged is the one stat the brief calls out as "if cheap": its own
  // try/catch so a slow or failing time-entries read costs the prompt one
  // line, never the rest of the client's history.
  let hoursLast90Days: number | null = null
  try {
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const hourRows = await drizzle
      .select({ hours: schema.timeEntries.hours })
      .from(schema.timeEntries)
      .where(and(eq(schema.timeEntries.orgId, orgId), gte(schema.timeEntries.date, ninetyDaysAgo)))
    hoursLast90Days = Math.round(hourRows.reduce((sum, r) => sum + r.hours, 0) * 10) / 10
  } catch {
    hoursLast90Days = null
  }

  return {
    totalRequests: requestRows.length,
    firstRequestDate: firstRequestDate ? firstRequestDate.slice(0, 10) : null,
    lastRequestDate: lastRequestDate ? lastRequestDate.slice(0, 10) : null,
    categoryCountsAllTime,
    categoryCountsRecent,
    sizeCountsAllTime,
    sizeCountsRecent,
    allCategories: REQUEST_CATEGORIES,
    openStatusCounts,
    planType: orgRow.planType,
    tracksLabel,
    hasCustomRate,
    hoursLast90Days,
  }
}
