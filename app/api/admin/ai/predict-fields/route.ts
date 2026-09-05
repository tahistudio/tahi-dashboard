/**
 * POST /api/admin/ai/predict-fields
 *
 * Guesses the fields an operator has left empty on a request or a task that
 * does not exist yet, and says nothing when there is not enough to go on.
 *
 * Three things make this different from the triage route it sits beside.
 * First, it runs BEFORE the record exists, so there is no row to load and no
 * org to scope off one: the caller names the client and the access check runs
 * against that. Second, it is grounded: the prompt carries this client's own
 * median turnaround, their billed hours on comparable work, who usually takes
 * this category, and the human-authored SLA off their intake form, so a due
 * date is an observation rather than a round number. Third, and the whole
 * point, it abstains. Every field carries a confidence, anything under the
 * threshold is dropped server-side, and anything that fails validation is
 * dropped rather than coerced to a default.
 *
 * It answers 200 with an empty `suggestions` object for a thin brief, a
 * missing key, a timeout and a spend ceiling alike. An empty answer is the
 * normal case, not an error, and a dialog should never show a failure toast
 * because the studio had nothing useful to say about a four word title.
 *
 * Nothing is written. The dialog fills its own fields and a human presses
 * Create, exactly as with the wizards.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm'
import { HAIKU_MODEL } from '@/lib/ai-models'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { recordCost } from '@/lib/ai-cost'
import { requireAccessToOrg } from '@/lib/require-access'
import { REQUEST_CATEGORIES, REQUEST_PRIORITIES } from '@/lib/request-vocabulary'
import { TASK_PRIORITIES } from '@/lib/task-priorities'
import { hasEnoughContext } from '@/lib/predict/context'
import { heuristicPredictions, turnaroundFromCohorts } from '@/lib/predict/heuristics'
import { parsePredictions } from '@/lib/predict/parse'
import {
  isoDaysAgo,
  isoHoursAgo,
  median,
  modeOf,
  startOfTodayIso,
} from '@/lib/predict/stats'
import {
  MAX_EMPTY_FIELDS,
  emptyStudioFacts,
  fieldAppliesTo,
  isPredictableField,
  type PredictFieldsBody,
  type PredictFieldsResponse,
  type PredictSubject,
  type PredictSuggestions,
  type PredictableField,
  type RosterEntry,
  type StudioFacts,
} from '@/lib/predict/types'

export const dynamic = 'force-dynamic'

// ── Caps ──────────────────────────────────────────────────────────────────────

/** The answer is one small JSON object. More room buys nothing. */
const MAX_OUTPUT_TOKENS = 500

/**
 * A hard ceiling on how long a dialog waits. Every other AI call in the repo
 * runs on the SDK default because every other one is a button press; this one
 * fires off typing, so a hung call would leave a field pending with no floor
 * under it. On abort the keyword tables answer instead.
 */
const PREDICT_TIMEOUT_MS = 6000

/**
 * A soft daily ceiling on prediction spend, read against prediction rows only.
 * Summing the whole `wizard` scope would mean the task wizard's own $5 budget
 * closed this door permanently the first time it was used.
 */
const PREDICT_DAILY_CAP_CENTS = 200

/** Per operator, per hour. A debounce that breaks is exactly this shape. */
const PREDICT_HOURLY_CALLS_PER_USER = 60

/** How far back a cohort looks. Older than this is a different studio. */
const COHORT_LOOKBACK_DAYS = 180

/** Rows per grounding statement. Bounded because a Worker pays for every one. */
const COHORT_LIMIT = 200
const PARTICIPANT_LIMIT = 100
const ROSTER_LIMIT = 50

/** The brief, as much of it as a routing decision can possibly need. */
const MAX_DESCRIPTION_CHARS = 2000

const COST_STAGE = 'predict_fields'

// ── System prompt ─────────────────────────────────────────────────────────────
//
// One constant, byte-identical on every call, so the ephemeral cache block
// actually hits. Both vocabularies are named here rather than interpolated per
// subject: a prompt that changes shape between a request and a task would
// cache twice and hit half as often.

const SYSTEM_PROMPT = `You are a filing assistant for Tahi Studio, a Webflow design and development agency. Someone is part way through creating a work item and has left some fields empty. You suggest values for those fields only. You never take action, and a human sees every suggestion before it is saved.

You will be given the item (subject, title, brief, client, plan, chosen category), today's date, the list of fields to fill, the studio's own recent facts about this client, and the team roster.

CLOSED VOCABULARIES. A value outside these is discarded, so returning one wastes the field.
- category (requests only): ${REQUEST_CATEGORIES.join(' | ')}
- size (requests only): small | large. "small" is a day or less, "large" is multi-day.
- priority on a request: ${REQUEST_PRIORITIES.join(' | ')}
- priority on a task: ${TASK_PRIORITIES.join(' | ')}
- assigneeId: an id copied exactly from the roster you are given, and nothing else
- dueDate: a YYYY-MM-DD calendar date, today or later
- estimatedHours: a number of hours, greater than 0 and no more than 200

RULES.
1. Only fill a field you can justify from the text or the studio facts. Omit anything else. An empty answer is a good answer.
2. Never fill a field that is not in the list you were asked for.
3. Prefer the studio facts over your own sense of how long work takes. The medians you are given are what this studio actually does.
4. confidence is your own honesty, not a formality. A field you are guessing at scores low and will be dropped, which is the correct outcome.
5. reason is ONE short sentence a busy person reads at a glance, in NZ English. Say what the suggestion is based on. No em dashes or en dashes.

OUTPUT: a single JSON object and nothing else. Each key is a field name, each value is {"value": <the value>, "reason": "<one sentence>", "confidence": <0 to 1>}. Shape:
{"dueDate": {"value": "2026-09-19", "reason": "...", "confidence": 0.8}}`

// ── Types ─────────────────────────────────────────────────────────────────────

type Database = Awaited<ReturnType<typeof db>>

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>
  usage?: AnthropicUsage
}

interface CohortRow {
  category?: string | null
  priority: string | null
  assigneeId: string | null
  estimatedHours: number | null
  turnaroundDays: number | null
}

// ── Body reading ──────────────────────────────────────────────────────────────

function asSubject(value: unknown): PredictSubject | null {
  return value === 'request' || value === 'task' ? value : null
}

/** The fields asked for, deduplicated, capped, and filtered to this subject. */
function readEmptyFields(raw: unknown, subject: PredictSubject): PredictableField[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<PredictableField>()
  for (const entry of raw) {
    if (!isPredictableField(entry)) continue
    if (!fieldAppliesTo(entry, subject)) continue
    seen.add(entry)
    if (seen.size >= MAX_EMPTY_FIELDS) break
  }
  return [...seen]
}

/** Today, as the caller's own calendar knows it. */
function readTodayIso(raw: unknown): string {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? raw
    : new Date().toISOString().slice(0, 10)
}

/** The keys the operator has already settled. Never predicted over. */
function readFilledKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key]) => key)
}

// ── Grounding ─────────────────────────────────────────────────────────────────

/**
 * The intake form's SLA label for this client and category, following the same
 * four-step ladder the portal resolver walks: org plus category, org global,
 * category global, then the studio default. The portal route dropped this
 * string on the floor for a year; it is the only human-authored turnaround
 * signal in the schema, so it outranks every median below it.
 */
async function resolveSlaLabel(
  database: Database,
  orgId: string | null,
  category: string | null,
): Promise<string | null> {
  const pick = async (where: ReturnType<typeof and> | undefined) => {
    const rows = await database
      .select({ sla: schema.requestForms.sla })
      .from(schema.requestForms)
      .where(where)
      .limit(1)
    const sla = rows[0]?.sla
    return typeof sla === 'string' && sla.trim() ? sla.trim() : null
  }

  if (orgId && category) {
    const found = await pick(and(
      eq(schema.requestForms.orgId, orgId),
      eq(schema.requestForms.category, category),
    ))
    if (found) return found
  }
  if (orgId) {
    const found = await pick(and(
      eq(schema.requestForms.orgId, orgId),
      isNull(schema.requestForms.category),
    ))
    if (found) return found
  }
  if (category) {
    const found = await pick(and(
      isNull(schema.requestForms.orgId),
      eq(schema.requestForms.category, category),
    ))
    if (found) return found
  }
  return pick(and(
    isNull(schema.requestForms.orgId),
    isNull(schema.requestForms.category),
    eq(schema.requestForms.isDefault, 1),
  ))
}

interface GroundingInput {
  subject: PredictSubject
  orgId: string | null
  level: string | null
  category: string | null
}

/**
 * Everything the prompt and the fallback need, in one bounded pass.
 *
 * Every statement is capped and every one is optional: a database that cannot
 * answer must not stop a dialog, so the caller treats a throw as "no facts"
 * and the keyword tables take over.
 */
async function loadStudioFacts(
  database: Database,
  input: GroundingInput,
): Promise<StudioFacts> {
  const { subject, orgId, level, category } = input
  const since = isoDaysAgo(COHORT_LOOKBACK_DAYS)
  const facts = emptyStudioFacts()

  const requestCohort = (scopedToOrg: boolean) => database
    .select({
      category: schema.requests.category,
      priority: schema.requests.priority,
      assigneeId: schema.requests.assigneeId,
      estimatedHours: schema.requests.estimatedHours,
      turnaroundDays: sql<number | null>`julianday(${schema.requests.deliveredAt}) - julianday(${schema.requests.createdAt})`,
    })
    .from(schema.requests)
    .where(and(
      sql`${schema.requests.deliveredAt} IS NOT NULL`,
      gte(schema.requests.createdAt, since),
      sql`julianday(${schema.requests.deliveredAt}) - julianday(${schema.requests.createdAt}) >= 0`,
      scopedToOrg && orgId ? eq(schema.requests.orgId, orgId) : undefined,
    ))
    .orderBy(desc(schema.requests.deliveredAt))
    .limit(COHORT_LIMIT)

  const taskCohort = (scopedToOrg: boolean) => database
    .select({
      priority: schema.tasks.priority,
      assigneeId: schema.tasks.assigneeId,
      estimatedHours: schema.tasks.estimatedHours,
      turnaroundDays: sql<number | null>`julianday(${schema.tasks.completedAt}) - julianday(${schema.tasks.createdAt})`,
    })
    .from(schema.tasks)
    .where(and(
      sql`${schema.tasks.completedAt} IS NOT NULL`,
      gte(schema.tasks.createdAt, since),
      sql`julianday(${schema.tasks.completedAt}) - julianday(${schema.tasks.createdAt}) >= 0`,
      level ? eq(schema.tasks.type, level) : undefined,
      scopedToOrg && orgId ? eq(schema.tasks.orgId, orgId) : undefined,
    ))
    .orderBy(desc(schema.tasks.completedAt))
    .limit(COHORT_LIMIT)

  // Actual billed hours on comparable delivered work. The estimatedHours
  // column is nullable and nothing writes it unless a human typed it, so
  // grounding an estimate on it would eventually train on its own output.
  const billedHours = subject === 'request'
    ? database
      .select({ hours: sql<number>`SUM(${schema.timeEntries.hours})` })
      .from(schema.timeEntries)
      .innerJoin(schema.requests, eq(schema.timeEntries.requestId, schema.requests.id))
      .where(and(
        sql`${schema.requests.deliveredAt} IS NOT NULL`,
        gte(schema.requests.createdAt, since),
        category ? eq(schema.requests.category, category) : undefined,
        orgId ? eq(schema.requests.orgId, orgId) : undefined,
      ))
      .groupBy(schema.timeEntries.requestId)
      .limit(COHORT_LIMIT)
    : database
      .select({ hours: sql<number>`SUM(${schema.timeEntries.hours})` })
      .from(schema.timeEntries)
      .innerJoin(schema.tasks, eq(schema.timeEntries.taskId, schema.tasks.id))
      .where(and(
        sql`${schema.tasks.completedAt} IS NOT NULL`,
        gte(schema.tasks.createdAt, since),
        level ? eq(schema.tasks.type, level) : undefined,
        orgId ? eq(schema.tasks.orgId, orgId) : undefined,
      ))
      .groupBy(schema.timeEntries.taskId)
      .limit(COHORT_LIMIT)

  // Who usually owns this category for this client. The junction rather than
  // requests.assigneeId: 'assignee' is the role that means ownership, and the
  // soft delete means a removed person stops counting.
  const assignees = subject === 'request'
    ? database
      .select({ participantId: schema.requestParticipants.participantId })
      .from(schema.requestParticipants)
      .innerJoin(schema.requests, eq(schema.requestParticipants.requestId, schema.requests.id))
      .where(and(
        eq(schema.requestParticipants.role, 'assignee'),
        eq(schema.requestParticipants.participantType, 'team_member'),
        isNull(schema.requestParticipants.removedAt),
        gte(schema.requests.createdAt, since),
        category ? eq(schema.requests.category, category) : undefined,
        orgId ? eq(schema.requests.orgId, orgId) : undefined,
      ))
      .limit(PARTICIPANT_LIMIT)
    : Promise.resolve([] as Array<{ participantId: string }>)

  const [orgRows, orgCohort, studioCohort, hoursRows, assigneeRows, roster, sla] = await Promise.all([
    orgId
      ? database
        .select({ name: schema.organisations.name, planType: schema.organisations.planType })
        .from(schema.organisations)
        .where(eq(schema.organisations.id, orgId))
        .limit(1)
      : Promise.resolve([] as Array<{ name: string; planType: string | null }>),
    subject === 'request' ? requestCohort(true) : taskCohort(true),
    subject === 'request' ? requestCohort(false) : taskCohort(false),
    billedHours,
    assignees,
    database
      .select({
        id: schema.teamMembers.id,
        name: schema.teamMembers.name,
        title: schema.teamMembers.title,
        role: schema.teamMembers.role,
      })
      .from(schema.teamMembers)
      .limit(ROSTER_LIMIT),
    resolveSlaLabel(database, orgId, category),
  ])

  const org = orgRows[0]
  facts.orgName = org?.name ?? null
  facts.planType = org?.planType ?? null
  // The dialog's own rule (new-request-dialog.tsx largeAllowed), restated so a
  // suggested size and the control it lands in can never disagree.
  facts.canUseLargeTrack = org?.planType !== 'maintain'

  const orgRowsTyped = orgCohort as CohortRow[]
  const studioRowsTyped = studioCohort as CohortRow[]

  const turnaround = turnaroundFromCohorts(
    orgRowsTyped.map(r => r.turnaroundDays),
    studioRowsTyped.map(r => r.turnaroundDays),
  )
  if (turnaround) {
    facts.cohortCount = turnaround.cohortCount
    if (turnaround.scope === 'client') facts.orgTurnaroundDays = turnaround.days
    else facts.studioTurnaroundDays = turnaround.days
  }

  const hours = (hoursRows as Array<{ hours: number | null }>)
    .map(r => (typeof r.hours === 'number' ? r.hours : Number(r.hours)))
    .filter(h => Number.isFinite(h) && h > 0)
  facts.categoryMedianHours = hours.length > 0 ? median(hours) : null

  const assigneeIds = (assigneeRows as Array<{ participantId: string }>).map(r => r.participantId)
  const fromCohort = orgRowsTyped.map(r => r.assigneeId)
  facts.usualAssigneeId = modeOf(assigneeIds.length > 0 ? assigneeIds : fromCohort)

  facts.roster = (roster as Array<{ id: string; name: string; title: string | null; role: string }>)
    .map<RosterEntry>(m => ({ id: m.id, name: m.name, role: m.title ?? m.role }))
  facts.usualAssigneeName = facts.usualAssigneeId
    ? facts.roster.find(r => r.id === facts.usualAssigneeId)?.name ?? null
    : null

  facts.slaLabel = sla
  return facts
}

// ── Spend ─────────────────────────────────────────────────────────────────────

/**
 * Today's prediction spend and this operator's calls in the last hour, or null
 * for either when the ledger could not be read.
 *
 * Null is deliberately not zero, the way the task wizard reads it: a database
 * that cannot be reached must not read as "nothing spent" and must not close
 * the door either.
 */
async function readLedger(
  database: Database,
  userId: string | null,
): Promise<{ spentCents: number | null; recentCalls: number | null }> {
  const rows = await database
    .select({
      cents: schema.aiCostLog.estimatedUsdCents,
      scopeId: schema.aiCostLog.scopeId,
      createdAt: schema.aiCostLog.createdAt,
    })
    .from(schema.aiCostLog)
    .where(and(
      eq(schema.aiCostLog.scope, 'wizard'),
      eq(schema.aiCostLog.stage, COST_STAGE),
      gte(schema.aiCostLog.createdAt, startOfTodayIso()),
    ))
    .limit(2000)

  const hourAgo = isoHoursAgo(1)
  let spentCents = 0
  let recentCalls = 0
  for (const row of rows) {
    spentCents += row.cents ?? 0
    if (userId && row.scopeId === userId && (row.createdAt ?? '') >= hourAgo) recentCalls += 1
  }
  return { spentCents, recentCalls }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

const FIELD_BRIEFS: Record<PredictableField, string> = {
  dueDate: 'dueDate: the date the client should expect this by',
  priority: 'priority: how this sits against the rest of the queue',
  estimatedHours: 'estimatedHours: how long the work itself takes',
  category: 'category: what kind of work this is',
  size: 'size: whether this runs a day or spans several',
  assigneeId: 'assigneeId: who should own it',
}

function buildUserMessage(args: {
  subject: PredictSubject
  title: string
  description: string
  category: string | null
  level: string | null
  empty: readonly PredictableField[]
  todayIso: string
  facts: StudioFacts
}): string {
  const { subject, title, description, category, level, empty, todayIso, facts } = args
  const lines: string[] = []

  lines.push(`SUBJECT: ${subject}`)
  lines.push(`Today: ${todayIso}`)
  lines.push(`Title: ${title}`)
  if (description) {
    lines.push('Brief:')
    lines.push(description)
  }
  if (category) lines.push(`Category already chosen: ${category}`)
  if (level) lines.push(`Level: ${level}`)
  lines.push(`Client: ${facts.orgName ?? 'not named'}`)
  if (facts.planType) lines.push(`Plan: ${facts.planType}`)
  if (!facts.canUseLargeTrack) {
    lines.push('This plan has no multi-day track, so size can only be small.')
  }

  lines.push('')
  lines.push('STUDIO FACTS')
  if (facts.slaLabel) {
    lines.push(`Agreed turnaround on this client's intake form: ${facts.slaLabel}. This outranks the medians below.`)
  }
  if (facts.orgTurnaroundDays !== null) {
    lines.push(`Median days from filing to delivery for this client, last ${COHORT_LOOKBACK_DAYS} days: ${facts.orgTurnaroundDays.toFixed(1)} over ${facts.cohortCount} items.`)
  } else if (facts.studioTurnaroundDays !== null) {
    lines.push(`This client has too little delivered work to measure. Across the whole studio the median is ${facts.studioTurnaroundDays.toFixed(1)} days over ${facts.cohortCount} items.`)
  } else {
    lines.push('There is no delivered work to measure a turnaround from. Do not invent a due date.')
  }
  if (facts.categoryMedianHours !== null) {
    lines.push(`Median billed hours on comparable work: ${facts.categoryMedianHours.toFixed(2)}.`)
  } else {
    lines.push('There are no billed hours behind comparable work.')
  }
  if (facts.usualAssigneeName && facts.usualAssigneeId) {
    lines.push(`Usually owned by ${facts.usualAssigneeName} (${facts.usualAssigneeId}).`)
  }

  lines.push('')
  lines.push('TEAM ROSTER (id - name - role):')
  if (facts.roster.length === 0) {
    lines.push('(nobody on file, so do not suggest an assignee)')
  } else {
    for (const m of facts.roster) lines.push(`${m.id} - ${m.name} - ${m.role ?? 'team'}`)
  }

  lines.push('')
  lines.push('FILL ONLY THESE FIELDS:')
  for (const field of empty) lines.push(`- ${FIELD_BRIEFS[field]}`)

  lines.push('')
  lines.push('Return the JSON object now.')
  return lines.join('\n')
}

// ── Handler ───────────────────────────────────────────────────────────────────

function answer(body: PredictFieldsResponse): NextResponse {
  return NextResponse.json(body)
}

export async function POST(req: NextRequest) {
  const { orgId: callerOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(callerOrgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: PredictFieldsBody
  try {
    body = (await req.json()) as PredictFieldsBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const subject = asSubject(body.subject)
  if (!subject) {
    return NextResponse.json({ error: 'subject must be "request" or "task"' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title : ''
  const orgId = typeof body.orgId === 'string' && body.orgId ? body.orgId : null
  const level = typeof body.level === 'string' && body.level ? body.level : null
  const category = typeof body.category === 'string' && body.category ? body.category : null
  const todayIso = readTodayIso(body.todayIso)
  const filledKeys = readFilledKeys(body.filled)
  const empty = readEmptyFields(body.empty, subject).filter(f => !filledKeys.includes(f))
  const description = typeof body.description === 'string'
    ? body.description.trim().slice(0, MAX_DESCRIPTION_CHARS)
    : ''

  // The gate, before anything is spent: no model call, no D1 read, no cost
  // row. A four word title with no client is the overwhelmingly common state
  // of a dialog someone just opened, and answering it is not free.
  if (empty.length === 0 || !hasEnoughContext({ subject, title, orgId, level })) {
    return answer({ suggestions: {}, reason: 'thin_context' })
  }

  let database: Database | null = null
  try {
    database = await db()
  } catch {
    database = null
  }

  if (database && orgId) {
    const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>
    const denied = await requireAccessToOrg(drizzle, userId, orgId)
    if (denied) return denied
  }

  // The facts feed both paths, so they are loaded before the key is checked:
  // the keyword fallback is only worth anything with a median behind it.
  let facts: StudioFacts = emptyStudioFacts()
  if (database) {
    try {
      facts = await loadStudioFacts(database, { subject, orgId, level, category })
    } catch {
      facts = emptyStudioFacts()
    }
  }

  const fallback = (reason: PredictFieldsResponse['reason']): NextResponse => answer({
    suggestions: heuristicPredictions({ subject, title, description, category, empty, todayIso, facts }),
    degraded: true,
    reason,
  })

  if (!process.env.ANTHROPIC_API_KEY) {
    return fallback('ai_unavailable')
  }

  if (database) {
    let spentCents: number | null = null
    let recentCalls: number | null = null
    try {
      const ledger = await readLedger(database, userId)
      spentCents = ledger.spentCents
      recentCalls = ledger.recentCalls
    } catch {
      // An unreadable ledger is unknown spend, not zero spend, and it must not
      // close the door either. Same reading the task wizard takes.
    }
    if (
      (spentCents !== null && spentCents >= PREDICT_DAILY_CAP_CENTS) ||
      (recentCalls !== null && recentCalls >= PREDICT_HOURLY_CALLS_PER_USER)
    ) {
      return answer({ suggestions: {}, reason: 'ai_rate_limited' })
    }
  }

  const userMessage = buildUserMessage({
    subject, title, description, category, level, empty, todayIso, facts,
  })

  let text = ''
  let usage: AnthropicUsage | undefined
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    const response = await client.messages.create(
      {
        model: HAIKU_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        // Stable and byte-identical on every call, so repeat passes inside the
        // TTL pay the discounted rate on the whole instruction block.
        system: [{
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        }],
        messages: [{ role: 'user', content: userMessage }],
      },
      { signal: AbortSignal.timeout(PREDICT_TIMEOUT_MS) },
    ) as AnthropicResponse
    text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { text: string }).text)
      .join('\n')
    usage = response.usage
  } catch (err: unknown) {
    // Every failure lands on the keyword tables rather than on an error the
    // dialog has to explain. The reason says which one it was.
    const aborted = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    if (aborted) return fallback('timeout')
    if (err instanceof Error && 'status' in err && (err as Error & { status: number }).status === 429) {
      return fallback('ai_rate_limited')
    }
    return fallback('ai_unavailable')
  }

  // Awaited so the row lands before the Worker is torn down, and swallowed so
  // a ledger problem can never cost the caller their answer.
  if (database) {
    try {
      await recordCost(database, {
        scope: 'wizard',
        scopeId: userId ?? null,
        stage: COST_STAGE,
        provider: 'anthropic',
        model: HAIKU_MODEL,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        note: subject,
      })
    } catch {
      // The suggestions are what the caller asked for. The ledger is ours.
    }
  }

  if (!text) return fallback('ai_unavailable')

  const suggestions: PredictSuggestions = parsePredictions(text, {
    subject,
    todayIso,
    requested: empty,
    rosterIds: facts.roster.map(r => r.id),
    filledKeys,
  })

  return answer({ suggestions })
}
