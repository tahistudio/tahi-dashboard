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
 * CN.3 adds a third block, FROM RECENT CALLS: what was agreed on a call with
 * this client and has already been filed, read from APPLIED task suggestions
 * (a pending one is not agreed yet, a rejected one is the suggester's lesson,
 * not the wizard's). It lets the wizard name the existing request by its
 * number instead of drafting a duplicate. The block has two audiences
 * because the portal wizard talks to the client: the client sees only the
 * request kinds read off a call, by number and CURRENT title, never a quote,
 * a task, an internal thread note or a request filed from a Slack DM; the
 * studio sees every applied kind with its quote, a Slack note marked as one.
 *
 * Split into pure formatters (unit tested, no DB) and a thin loader that
 * runs the reads: the org row, its brands, its last few requests, the full
 * history aggregates and the applied call suggestions. Every read is scoped
 * to the caller's own org by the caller.
 */

import { schema } from '@/db/d1'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
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

/**
 * Who the context block is written for. 'client' is the portal wizard, which
 * talks to the client, and is the default everywhere because it is the safe
 * one: it never carries a quote, a task or an internal thread note. 'studio'
 * is the admin wizard.
 */
export type OrgContextAudience = 'client' | 'studio'

/**
 * One thing agreed on a call and already filed, as the FROM RECENT CALLS
 * block names it. Built by selectCallAgreements from an applied suggestion
 * joined to the request or task it touched.
 */
export interface CallAgreement {
  /** The suggestion kind ('create_request', 'update_task', ...). */
  kind: string
  /** The request's number, for the request kinds. Null for a task. */
  requestNumber: number | null
  /** The request's or task's CURRENT title, never the model's proposal on the
   *  client audience. */
  title: string
  /** yyyy-mm-dd the call transcript arrived. Null when the row has none. */
  callDate: string | null
  /** yyyy-mm-dd the suggestion was applied. */
  appliedOn: string
  /** The transcript lines the row rests on, clipped. Always null for the
   *  client audience. */
  quote: string | null
  /** Set only on the studio audience, for a row filed from a Slack note
   *  rather than read off a call, so its line does not claim a call. The
   *  client audience never carries a note row at all. */
  fromNote?: true
}

export interface RequestOrgContextInput {
  org: OrgContextOrg | null
  brands: OrgContextBrand[]
  recentRequests: OrgContextRequest[]
  /** The CLIENT HISTORY aggregates. Omitted or null when there is nothing to
   *  add beyond the CLIENT ON FILE block above. */
  history?: ClientHistoryStats | null
  /** Applied call suggestions for the FROM RECENT CALLS block, newest first. */
  callAgreements?: CallAgreement[]
  /** Who the block is for. Defaults to 'client', the safe audience. */
  audience?: OrgContextAudience
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
 * all, so a brand-new org costs the prompt nothing. FROM RECENT CALLS comes
 * last, after CLIENT HISTORY, and is rendered even when nothing else is on
 * file.
 */
export function formatRequestOrgContext(input: RequestOrgContextInput): string {
  const { org, brands, recentRequests, history } = input
  const callBlock = formatCallAgreements(input.callAgreements ?? [], input.audience ?? 'client')
  const hasOnFile = !!org || brands.length > 0 || recentRequests.length > 0 || !!history
  if (!hasOnFile) return callBlock

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
  if (callBlock) blocks.push(callBlock)
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

// ── FROM RECENT CALLS (CN.3) ─────────────────────────────────────────────────

/** Most agreements the block names. */
export const CALL_AGREEMENT_LIMIT = 8

/** How far back an applied suggestion still counts as a recent agreement. */
export const CALL_AGREEMENT_WINDOW_DAYS = 180

/** The block's ceiling, about 350 tokens. Oldest lines go first. */
export const CALL_BLOCK_MAX_CHARS = 1400

/** Rows the loader reads before the rules below pick from them. */
const CALL_AGREEMENT_SCAN_LIMIT = 30

/** Longest a quote gets on the studio audience, ellipsis included. */
const CALL_QUOTE_MAX_CHARS = 120

/** Longest a title gets on either audience, so one runaway title cannot eat
 *  the block's budget on its own. */
const CALL_TITLE_MAX_CHARS = 120

/**
 * The request kinds a client may see. request_note is left out on purpose: it
 * is a line on the request's internal thread, not something the client filed.
 * The task kinds are left out because tasks are the studio's own.
 */
const CLIENT_CALL_KINDS: readonly string[] = ['create_request', 'update_request', 'hand_off_request']

/** task_suggestions.source_kind for a row read off a call transcript. The
 *  other value today is 'note', a Slack DM (lib/slack/notes.ts). */
const CALL_SOURCE_KIND = 'call'

/** Every request kind, for deciding whether a row names a request or a task. */
const REQUEST_CALL_KINDS: readonly string[] = [...CLIENT_CALL_KINDS, 'request_note']

/** The task kinds, the studio's own follow ups. */
const TASK_CALL_KINDS: readonly string[] = ['create_task', 'update_task', 'complete_task', 'add_subtasks', 'note']

/** A kind in words, for the studio lines and the last resort title. */
const CALL_KIND_WORDS: Record<string, string> = {
  create_request: 'new request',
  update_request: 'request update',
  hand_off_request: 'handed to the client',
  request_note: 'note on the request',
  create_task: 'new task',
  update_task: 'task update',
  complete_task: 'marked done',
  add_subtasks: 'checklist added',
  note: 'note on the task',
}

/**
 * One applied suggestion joined to what it touched, the shape the loader
 * reads. Every column from a joined table is nullable because the joins are
 * left joins: a deleted task or a transcript that was never linked still
 * leaves the suggestion row standing.
 */
export interface CallAgreementRow {
  orgId: string | null
  /** task_suggestions.source_kind: 'call' for a transcript, 'note' for a
   *  Slack DM. */
  sourceKind: string | null
  kind: string
  status: string
  appliedAt: string | null
  appliedTaskId: string | null
  appliedRequestId: string | null
  quote: string | null
  proposal: string | null
  requestId: string | null
  requestOrgId: string | null
  requestNumber: number | null
  requestTitle: string | null
  requestIsInternal: boolean | null
  requestStatus: string | null
  taskId: string | null
  taskOrgId: string | null
  taskTitle: string | null
  callReceivedAt: string | null
}

function kindWords(kind: string): string {
  return CALL_KIND_WORDS[kind] ?? kind.replace(/_/g, ' ')
}

/** The en and em dash, built from their code points so this source file
 *  never carries either character itself. */
const DASH_CLASS = `[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`

/** A dash with a space on at least one side reads as a clause break. */
const SPACED_DASH = new RegExp(`\\s*${DASH_CLASS}\\s+|\\s+${DASH_CLASS}\\s*`, 'g')

/** A dash between two characters reads as a range or a compound. */
const BARE_DASH = new RegExp(DASH_CLASS, 'g')

/**
 * One line of prompt text from a stored string: whitespace collapsed so an
 * item can never spill onto a second line, and em or en dashes (a verbatim
 * transcript line carries them) swapped for a comma or a hyphen so the
 * block never shows the model the punctuation the brand voice bans.
 */
function flatten(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(SPACED_DASH, ', ')
    .replace(BARE_DASH, '-')
    .replace(/^,\s*|,\s*$/g, '')
    .trim()
}

/** Flatten, then clip to `max` characters, the ellipsis included. */
function clipLine(value: string, max: number): string {
  const flat = flatten(value)
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 3)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}...`
}

/** The yyyy-mm-dd at the front of an ISO stamp, or null when there is none. */
function datePart(value: string | null): string | null {
  if (!value) return null
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value)
  return match ? match[0] : null
}

/** The title a stored proposal carries, or '' when it has none or will not parse. */
function proposalTitle(raw: string | null): string {
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && typeof (parsed as { title?: unknown }).title === 'string') {
      return (parsed as { title: string }).title
    }
  } catch {
    return ''
  }
  return ''
}

/**
 * Pure: picks what the FROM RECENT CALLS block names, from rows the loader
 * read. Every rule is applied here in JavaScript even where the query already
 * applied it, so the privacy rules hold whatever the rows came from.
 *
 * Both audiences: the row must be applied and belong to `orgId`; newest first
 * by applied date; one line per request or task (the newest row wins); at
 * most CALL_AGREEMENT_LIMIT.
 *
 * Client: only rows read off a call (source_kind 'call'), because every line
 * says "from the call" and a request filed from somebody's Slack DM was not
 * agreed on one; only create_request, update_request and hand_off_request;
 * and only when the request they touched still exists, belongs to `orgId`,
 * is not internal and is not archived, which is exactly what the portal
 * request list shows. The title is the request's current title, never the
 * proposal's, and there is never a quote.
 *
 * Studio: every kind, from a call or a Slack note (a note row is marked
 * fromNote so its line says so), titled from the request or task it touched
 * (then the proposal's title, then the kind itself), with the quote clipped.
 * A row whose request or task has since moved to another client is dropped
 * rather than naming that client's work here.
 */
export function selectCallAgreements(
  rows: readonly CallAgreementRow[],
  orgId: string,
  audience: OrgContextAudience,
): CallAgreement[] {
  const ordered = rows
    .filter(row => row.status === 'applied' && row.orgId === orgId && !!datePart(row.appliedAt))
    .sort((a, b) => (b.appliedAt ?? '').localeCompare(a.appliedAt ?? ''))

  const seen = new Set<string>()
  const picked: CallAgreement[] = []

  for (const row of ordered) {
    if (picked.length >= CALL_AGREEMENT_LIMIT) break
    const isRequestKind = REQUEST_CALL_KINDS.includes(row.kind)
    const isTaskKind = TASK_CALL_KINDS.includes(row.kind)

    let title: string
    let quote: string | null = null
    if (audience === 'client') {
      if (row.sourceKind !== CALL_SOURCE_KIND) continue
      if (!CLIENT_CALL_KINDS.includes(row.kind)) continue
      if (!row.requestId || row.requestOrgId !== orgId) continue
      if (row.requestIsInternal !== false || row.requestStatus === 'archived') continue
      title = row.requestTitle ?? ''
    } else {
      if (row.requestId && row.requestOrgId !== orgId) continue
      if (row.taskId && row.taskOrgId && row.taskOrgId !== orgId) continue
      const joined = isRequestKind ? row.requestTitle : isTaskKind ? row.taskTitle : (row.requestTitle ?? row.taskTitle)
      title = joined || proposalTitle(row.proposal)
      quote = row.quote && flatten(row.quote) ? clipLine(row.quote, CALL_QUOTE_MAX_CHARS) : null
    }

    title = clipLine(title, CALL_TITLE_MAX_CHARS)
    if (!title) {
      if (audience === 'client') continue
      const words = kindWords(row.kind)
      title = `${words.charAt(0).toUpperCase()}${words.slice(1)}`
    }

    const itemId = isRequestKind ? row.appliedRequestId ?? row.requestId : isTaskKind ? row.appliedTaskId ?? row.taskId : null
    if (itemId) {
      const key = `${isRequestKind ? 'request' : 'task'}:${itemId}`
      if (seen.has(key)) continue
      seen.add(key)
    }

    picked.push({
      kind: row.kind,
      requestNumber: isRequestKind ? row.requestNumber ?? null : null,
      title,
      callDate: datePart(row.callReceivedAt),
      appliedOn: datePart(row.appliedAt) ?? '',
      quote,
      ...(audience === 'studio' && row.sourceKind !== CALL_SOURCE_KIND ? { fromNote: true as const } : {}),
    })
  }

  return picked
}

/** The client line's tail, in the client's own terms. */
function clientCallPhrase(kind: string, callDate: string | null): string | null {
  switch (kind) {
    case 'create_request':
      return callDate ? `filed from the call on ${callDate}` : 'filed from a call'
    case 'update_request':
      return callDate ? `updated after the call on ${callDate}` : 'updated after a call'
    case 'hand_off_request':
      return callDate ? `waiting on you since the call on ${callDate}` : 'waiting on you since a call'
    default:
      return null
  }
}

/**
 * Pure formatter for the FROM RECENT CALLS block. Returns '' when there is
 * nothing to name. Items arrive newest first; when the block would pass
 * CALL_BLOCK_MAX_CHARS the oldest lines are dropped until it fits.
 *
 * The client audience re-checks the kind and never prints a quote even if an
 * item carries one, so a caller that built items by hand cannot leak a
 * transcript line into the portal.
 */
export function formatCallAgreements(items: readonly CallAgreement[], audience: OrgContextAudience): string {
  const lines: string[] = []
  for (const item of items) {
    const title = clipLine(item.title, CALL_TITLE_MAX_CHARS)
    if (!title) continue
    if (audience === 'client') {
      const phrase = clientCallPhrase(item.kind, item.callDate)
      if (!phrase) continue
      const name = item.requestNumber != null ? `#${item.requestNumber} ${title}` : title
      lines.push(`- ${name}, ${phrase}`)
    } else {
      const name = item.requestNumber != null
        ? `#${item.requestNumber} ${title}`
        : TASK_CALL_KINDS.includes(item.kind) ? `Task: ${title}` : `Request: ${title}`
      const when = item.fromNote ? ', Slack note' : item.callDate ? `, call ${item.callDate}` : ''
      const quote = item.quote ? clipLine(item.quote, CALL_QUOTE_MAX_CHARS) : ''
      lines.push(`- ${name} (${kindWords(item.kind)}${when})${quote ? `: "${quote}"` : ''}`)
    }
  }
  if (lines.length === 0) return ''

  const header = audience === 'client'
    ? 'FROM RECENT CALLS (agreed on a call with the studio and already filed; never draft these again):'
    : 'FROM RECENT CALLS (applied from call notes; already filed):'
  const render = () => [header, ...lines].join('\n')
  let text = render()
  while (text.length > CALL_BLOCK_MAX_CHARS && lines.length > 0) {
    lines.pop()
    text = render()
  }
  return lines.length > 0 ? text : ''
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
- If the client asks what they are not doing, what is missing, or what to try next, answer from the coverage gaps and the plan named in CLIENT HISTORY in two sentences, then continue scoping the request in front of you. A full account review is a separate feature; do not attempt one here.
- If FROM RECENT CALLS lists something that matches what is being asked, it was already agreed on a call and filed: name it by its number and do not draft it again. If the ask adds to it, draft only the addition.`

/**
 * Read the applied call suggestions for one org and pick what FROM RECENT
 * CALLS names. Applied in the last CALL_AGREEMENT_WINDOW_DAYS before `at`,
 * newest first, a scan of CALL_AGREEMENT_SCAN_LIMIT rows, each joined to the
 * request and task it touched and the transcript it came from. The client
 * audience narrows the scan to the kinds it may see, so a busy run of studio
 * tasks cannot crowd its requests out of the scan. selectCallAgreements then
 * applies every rule again.
 *
 * Never throws: a failed read (a database where a column never landed, a
 * slow D1) returns [] and the rest of the context still loads.
 */
export async function loadCallAgreements(
  drizzle: Drizzle,
  orgId: string,
  audience: OrgContextAudience,
  at: Date = new Date(),
): Promise<CallAgreement[]> {
  try {
    const since = new Date(at.getTime() - CALL_AGREEMENT_WINDOW_DAYS * 86_400_000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z')
    const conditions = [
      eq(schema.taskSuggestions.status, 'applied'),
      eq(schema.taskSuggestions.orgId, orgId),
      gte(schema.taskSuggestions.appliedAt, since),
    ]
    if (audience === 'client') {
      conditions.push(eq(schema.taskSuggestions.sourceKind, CALL_SOURCE_KIND))
      conditions.push(inArray(schema.taskSuggestions.kind, [...CLIENT_CALL_KINDS]))
    }

    const rows: CallAgreementRow[] = await drizzle
      .select({
        orgId: schema.taskSuggestions.orgId,
        sourceKind: schema.taskSuggestions.sourceKind,
        kind: schema.taskSuggestions.kind,
        status: schema.taskSuggestions.status,
        appliedAt: schema.taskSuggestions.appliedAt,
        appliedTaskId: schema.taskSuggestions.appliedTaskId,
        appliedRequestId: schema.taskSuggestions.appliedRequestId,
        quote: schema.taskSuggestions.quote,
        proposal: schema.taskSuggestions.proposal,
        requestId: schema.requests.id,
        requestOrgId: schema.requests.orgId,
        requestNumber: schema.requests.requestNumber,
        requestTitle: schema.requests.title,
        requestIsInternal: schema.requests.isInternal,
        requestStatus: schema.requests.status,
        taskId: schema.tasks.id,
        taskOrgId: schema.tasks.orgId,
        taskTitle: schema.tasks.title,
        callReceivedAt: schema.callTranscripts.receivedAt,
      })
      .from(schema.taskSuggestions)
      .leftJoin(schema.requests, eq(schema.requests.id, schema.taskSuggestions.appliedRequestId))
      .leftJoin(schema.tasks, eq(schema.tasks.id, schema.taskSuggestions.appliedTaskId))
      .leftJoin(schema.callTranscripts, eq(schema.callTranscripts.id, schema.taskSuggestions.transcriptId))
      .where(and(...conditions))
      .orderBy(desc(schema.taskSuggestions.appliedAt))
      .limit(CALL_AGREEMENT_SCAN_LIMIT)

    return selectCallAgreements(rows, orgId, audience)
  } catch {
    return []
  }
}

/**
 * Load and format the context block for one org. Every read is scoped to
 * `orgId`, which the caller has already resolved to the caller's own
 * organisation, never taken from anywhere else on the request body.
 *
 * `audience` decides what FROM RECENT CALLS may carry. It defaults to
 * 'client', the safe audience, so a caller that forgets to say gets the
 * portal's rules rather than the studio's quotes and task titles.
 */
export async function loadRequestOrgContext(
  drizzle: Drizzle,
  orgId: string,
  options: { audience?: OrgContextAudience } = {},
): Promise<string> {
  const audience: OrgContextAudience = options.audience ?? 'client'
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
  const callAgreements = await loadCallAgreements(drizzle, orgId, audience)

  return formatRequestOrgContext({
    org: orgRow ? { name: orgRow.name, industry: orgRow.industry ?? null, website: orgRow.website ?? null } : null,
    brands,
    recentRequests,
    history,
    callAgreements,
    audience,
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
