import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, inArray, sql } from 'drizzle-orm'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { convertToNzd } from '@/lib/currency'
import { logActivity, formatMoney } from '@/lib/deal-activity'
import { readForecastHorizonMonths } from '@/lib/pipeline-settings'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/deals
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const filterOrgId = url.searchParams.get('orgId')
  const stageId = url.searchParams.get('stageId')
  const ownerId = url.searchParams.get('ownerId')
  const source = url.searchParams.get('source')
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50')))
  const offset = (page - 1) * limit

  const database = await db() as unknown as D1

  // Access scoping
  const scopedOrgIds = await resolveAccessScoping(database, userId)

  const conditions = []

  if (scopedOrgIds !== null) {
    if (scopedOrgIds.length === 0) {
      return NextResponse.json({ items: [], page, limit })
    }
    conditions.push(inArray(schema.deals.orgId, scopedOrgIds))
  }
  // Exclude archived (soft-deleted) deals
  conditions.push(sql`(${schema.deals.closeReason} IS NULL OR ${schema.deals.closeReason} != 'archived')`)

  if (filterOrgId) conditions.push(eq(schema.deals.orgId, filterOrgId))
  if (stageId) conditions.push(eq(schema.deals.stageId, stageId))
  if (ownerId) conditions.push(eq(schema.deals.ownerId, ownerId))
  if (source) conditions.push(eq(schema.deals.source, source))

  const items = await database
    .select({
      id: schema.deals.id,
      title: schema.deals.title,
      orgId: schema.deals.orgId,
      stageId: schema.deals.stageId,
      ownerId: schema.deals.ownerId,
      value: schema.deals.value,
      currency: schema.deals.currency,
      valueNzd: schema.deals.valueNzd,
      // Split-value model (migration 0023)
      upfrontValue: schema.deals.upfrontValue,
      upfrontValueNzd: schema.deals.upfrontValueNzd,
      monthlyValue: schema.deals.monthlyValue,
      monthlyValueNzd: schema.deals.monthlyValueNzd,
      recurringStartDate: schema.deals.recurringStartDate,
      source: schema.deals.source,
      estimatedHoursPerWeek: schema.deals.estimatedHoursPerWeek,
      autoNudgesDisabled: schema.deals.autoNudgesDisabled,
      engagementEndDate: schema.deals.engagementEndDate,
      expectedCloseDate: schema.deals.expectedCloseDate,
      closedAt: schema.deals.closedAt,
      closeReason: schema.deals.closeReason,
      notes: schema.deals.notes,
      createdAt: schema.deals.createdAt,
      updatedAt: schema.deals.updatedAt,
      orgName: schema.organisations.name,
      stageName: schema.pipelineStages.name,
      stageColour: schema.pipelineStages.colour,
      stageProbability: schema.pipelineStages.probability,
      stageIsClosedWon: schema.pipelineStages.isClosedWon,
      stageIsClosedLost: schema.pipelineStages.isClosedLost,
      ownerName: schema.teamMembers.name,
      ownerAvatarUrl: schema.teamMembers.avatarUrl,
    })
    .from(schema.deals)
    .leftJoin(schema.organisations, eq(schema.deals.orgId, schema.organisations.id))
    .leftJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .leftJoin(schema.teamMembers, eq(schema.deals.ownerId, schema.teamMembers.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(schema.deals.updatedAt))
    .limit(limit)
    .offset(offset)

  // Fetch value_min/value_max via raw SQL. These columns were added in
  // migration 0017 and are not declared in the Drizzle schema until the
  // migration has run everywhere (Decision #039 lesson #1).
  type RangeRow = { id: string; value_min: number | null; value_max: number | null; value_min_nzd: number | null; value_max_nzd: number | null }
  let rangeMap: Record<string, { valueMin: number | null; valueMax: number | null; valueMinNzd: number | null; valueMaxNzd: number | null }> = {}
  const allDealIds = items.map(d => d.id)
  if (allDealIds.length > 0) {
    try {
      // UUIDs from our own DB — safe to interpolate. Still validate format.
      const safeIds = allDealIds.filter(id => /^[a-f0-9-]{36}$/i.test(id))
      if (safeIds.length > 0) {
        const list = safeIds.map(id => `'${id}'`).join(',')
        const res = await database.all(sql.raw(
          `SELECT id, value_min, value_max, value_min_nzd, value_max_nzd FROM deals WHERE id IN (${list})`,
        )) as unknown as RangeRow[] | { results?: RangeRow[] }
        const rows: RangeRow[] = Array.isArray(res) ? res : (res?.results ?? [])
        rangeMap = Object.fromEntries(rows.map(r => [r.id, {
          valueMin: r.value_min,
          valueMax: r.value_max,
          valueMinNzd: r.value_min_nzd,
          valueMaxNzd: r.value_max_nzd,
        }]))
      }
    } catch {
      // Migration 0017 not yet applied — skip range data.
      rangeMap = {}
    }
  }

  // Get contact counts per deal
  let contactCounts: Record<string, number> = {}
  if (allDealIds.length > 0) {
    const counts = await database
      .select({
        dealId: schema.dealContacts.dealId,
        count: sql<number>`count(*)`.as('count'),
      })
      .from(schema.dealContacts)
      .where(inArray(schema.dealContacts.dealId, allDealIds))
      .groupBy(schema.dealContacts.dealId)

    contactCounts = Object.fromEntries(counts.map(c => [c.dealId, c.count]))
  }

  const enriched = items.map(item => {
    const range = rangeMap[item.id]
    return {
      ...item,
      valueMin: range?.valueMin ?? null,
      valueMax: range?.valueMax ?? null,
      valueMinNzd: range?.valueMinNzd ?? null,
      valueMaxNzd: range?.valueMaxNzd ?? null,
      contactCount: contactCounts[item.id] ?? 0,
    }
  })

  return NextResponse.json({ items: enriched, page, limit })
}

// POST /api/admin/deals
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as {
    title?: string
    orgId?: string
    stageId?: string
    ownerId?: string
    /** Single-value upfront (project portion). Used when no range is set. */
    upfrontValue?: number
    /** Recurring monthly retainer portion. Optional. */
    monthlyValue?: number
    /** Optional explicit start date for the recurring portion. */
    recurringStartDate?: string
    /** Range on the upfront portion (kept names for backward compat). */
    valueMin?: number | null
    valueMax?: number | null
    /** Legacy single value field — accepted for backward compat. Treated
     *  as `upfrontValue` when no upfrontValue/monthlyValue is supplied. */
    value?: number
    currency?: string
    source?: string
    estimatedHoursPerWeek?: number
    expectedCloseDate?: string
    notes?: string
  }

  if (!body.title?.trim()) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!body.stageId) {
    return NextResponse.json({ error: 'stageId is required' }, { status: 400 })
  }

  const database = await db() as unknown as D1
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  // If no ownerId was supplied, fall back to the configured default deal owner.
  // Validate the setting still points at an existing team member; if not, leave
  // owner null rather than misroute the deal.
  let resolvedOwnerId: string | null = body.ownerId ?? null
  if (!resolvedOwnerId) {
    const [setting] = await database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, 'pipeline.defaultDealOwnerId'))
      .limit(1)
    const candidate = setting?.value ?? null
    if (candidate) {
      const [member] = await database
        .select({ id: schema.teamMembers.id })
        .from(schema.teamMembers)
        .where(eq(schema.teamMembers.id, candidate))
        .limit(1)
      if (member) resolvedOwnerId = member.id
    }
  }

  // Resolve forecast horizon (default 12) for the legacy `value` rollup.
  const horizonMonths = await readForecastHorizonMonths(database)

  // Upfront range handling: ranges live on the upfront portion only.
  // Midpoint feeds upfrontValue; valueMin/valueMax preserved alongside.
  const hasRange = body.valueMin != null && body.valueMax != null && body.valueMin !== body.valueMax
  const valueMin = hasRange ? Math.min(body.valueMin!, body.valueMax!) : null
  const valueMax = hasRange ? Math.max(body.valueMin!, body.valueMax!) : null
  const upfrontMidpoint = hasRange ? Math.round((valueMin! + valueMax!) / 2) : null

  // Resolve the split values. Falls back through: explicit upfrontValue →
  // upfront range midpoint → legacy single `value` (for old API callers).
  const upfrontValue = Math.max(0, Math.round(
    body.upfrontValue ?? upfrontMidpoint ?? body.value ?? 0,
  ))
  const monthlyValue = Math.max(0, Math.round(body.monthlyValue ?? 0))

  // Legacy `value` field stays populated as upfront + monthly × 12 so any
  // pre-split-aware code (sorts, filters, charts) keeps producing a sensible
  // headline number per deal.
  const legacyValue = upfrontValue + monthlyValue * 12

  // Workspace defaults (settings K/V, managed in Settings > Pipeline
  // defaults). Only consulted when the request omits the field, so explicit
  // values always win.
  let settingsCurrency: string | null = null
  let settingsCloseWindowDays: number | null = null
  if (!body.currency || !body.expectedCloseDate) {
    const defaultRows = await database
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)
      .where(inArray(schema.settings.key, ['pipeline.defaultCurrency', 'pipeline.defaultCloseWindowDays']))
    for (const row of defaultRows) {
      if (row.key === 'pipeline.defaultCurrency' && row.value?.trim()) {
        settingsCurrency = row.value.trim()
      }
      if (row.key === 'pipeline.defaultCloseWindowDays') {
        const parsed = parseInt(row.value ?? '', 10)
        if (Number.isFinite(parsed) && parsed > 0) settingsCloseWindowDays = parsed
      }
    }
  }

  const dealCurrency = body.currency ?? settingsCurrency ?? 'NZD'

  // Default close window: when no expectedCloseDate is supplied, project one
  // out from today using the configured window (date-only ISO string).
  const resolvedExpectedCloseDate = body.expectedCloseDate
    ?? (settingsCloseWindowDays != null
      ? new Date(Date.now() + settingsCloseWindowDays * 86_400_000).toISOString().slice(0, 10)
      : null)

  // Convert to NZD using exchange rates
  async function toNzd(amount: number): Promise<number> {
    if (amount === 0 || dealCurrency === 'NZD') return amount
    const rates = await database
      .select({ currency: schema.exchangeRates.currency, rateToUsd: schema.exchangeRates.rateToUsd })
      .from(schema.exchangeRates)
    if (rates.length === 0) return amount
    return Math.round(convertToNzd(amount, dealCurrency, rates))
  }

  const valueNzd = await toNzd(legacyValue)
  const upfrontValueNzd = await toNzd(upfrontValue)
  const monthlyValueNzd = await toNzd(monthlyValue)
  const valueMinNzd = valueMin != null ? await toNzd(valueMin) : null
  const valueMaxNzd = valueMax != null ? await toNzd(valueMax) : null

  await database.insert(schema.deals).values({
    id,
    title: body.title.trim(),
    orgId: body.orgId ?? null,
    stageId: body.stageId,
    ownerId: resolvedOwnerId,
    value: legacyValue,
    currency: dealCurrency,
    valueNzd,
    upfrontValue,
    upfrontValueNzd,
    monthlyValue,
    monthlyValueNzd,
    recurringStartDate: body.recurringStartDate ?? null,
    source: body.source ?? null,
    estimatedHoursPerWeek: body.estimatedHoursPerWeek ?? 0,
    expectedCloseDate: resolvedExpectedCloseDate,
    notes: body.notes ?? null,
    createdAt: now,
    updatedAt: now,
  })

  // Write the range columns via raw SQL (not in Drizzle schema yet)
  if (hasRange) {
    try {
      await database.run(sql`
        UPDATE deals
        SET value_min = ${valueMin},
            value_max = ${valueMax},
            value_min_nzd = ${valueMinNzd},
            value_max_nzd = ${valueMaxNzd}
        WHERE id = ${id}
      `)
    } catch (err) {
      // Migration 0017 not applied — log and continue.
      console.warn('[deals POST] range columns not yet available:', err instanceof Error ? err.message : err)
    }
  }
  // Avoid unused-var warnings while we keep horizon available for potential
  // activity-log rollup calculations later in this handler.
  void horizonMonths

  // Fetch stage name for activity log
  const [stage] = await database
    .select({ name: schema.pipelineStages.name })
    .from(schema.pipelineStages)
    .where(eq(schema.pipelineStages.id, body.stageId))
    .limit(1)

  // Build the headline label: prefer the split-model "upfront + monthly/mo"
  // form when either side is set, fall back to the legacy single number.
  const upfrontLabel = hasRange
    ? `${formatMoney(valueMin!, dealCurrency)}\u2013${formatMoney(valueMax!, dealCurrency)}`
    : upfrontValue > 0
      ? formatMoney(upfrontValue, dealCurrency)
      : null
  const monthlyLabel = monthlyValue > 0
    ? `${formatMoney(monthlyValue, dealCurrency)}/mo`
    : null
  const valueLabel =
    upfrontLabel && monthlyLabel
      ? `${upfrontLabel} + ${monthlyLabel}`
      : upfrontLabel ?? monthlyLabel ?? null

  await logActivity(database, {
    dealId: id,
    orgId: body.orgId ?? null,
    type: 'deal_created',
    title: `Deal created in ${stage?.name ?? 'pipeline'}${valueLabel ? ` \u00b7 ${valueLabel}` : ''}`,
    description: body.source ? `Source: ${body.source}` : null,
    createdById: userId,
    metadata: {
      initial: {
        stageId: body.stageId,
        value: legacyValue,
        upfrontValue,
        monthlyValue,
        recurringStartDate: body.recurringStartDate ?? null,
        valueMin,
        valueMax,
        currency: dealCurrency,
        source: body.source ?? null,
        ownerId: resolvedOwnerId,
        orgId: body.orgId ?? null,
        expectedCloseDate: resolvedExpectedCloseDate,
      },
    },
  })

  return NextResponse.json({ id }, { status: 201 })
}
