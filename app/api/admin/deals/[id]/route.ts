import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, sql, and } from 'drizzle-orm'
import { convertToNzd } from '@/lib/currency'
import { logActivity, valueChanged, valueChangeTitle, valueChangeMetadata, formatMoney } from '@/lib/deal-activity'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET /api/admin/deals/[id]
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  // Get deal with joins
  const [deal] = await database
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
      engagementType: schema.deals.engagementType,
      totalHours: schema.deals.totalHours,
      hoursPerMonth: schema.deals.hoursPerMonth,
      engagementStartDate: schema.deals.engagementStartDate,
      engagementEndDate: schema.deals.engagementEndDate,
      autoNudgesDisabled: schema.deals.autoNudgesDisabled,
      expectedCloseDate: schema.deals.expectedCloseDate,
      closedAt: schema.deals.closedAt,
      closeReason: schema.deals.closeReason,
      lostReason: schema.deals.lostReason,
      nextActionLabel: schema.deals.nextActionLabel,
      nextActionDueAt: schema.deals.nextActionDueAt,
      notes: schema.deals.notes,
      createdAt: schema.deals.createdAt,
      updatedAt: schema.deals.updatedAt,
      orgName: schema.organisations.name,
      stageName: schema.pipelineStages.name,
      stageColour: schema.pipelineStages.colour,
      stageProbability: schema.pipelineStages.probability,
      stagePosition: schema.pipelineStages.position,
      stageIsClosedWon: schema.pipelineStages.isClosedWon,
      stageIsClosedLost: schema.pipelineStages.isClosedLost,
      ownerName: schema.teamMembers.name,
      ownerAvatarUrl: schema.teamMembers.avatarUrl,
    })
    .from(schema.deals)
    .leftJoin(schema.organisations, eq(schema.deals.orgId, schema.organisations.id))
    .leftJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
    .leftJoin(schema.teamMembers, eq(schema.deals.ownerId, schema.teamMembers.id))
    .where(eq(schema.deals.id, id))
    .limit(1)

  if (!deal) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  // Fetch value_min/value_max via raw SQL (migration 0017).
  let valueRange: { valueMin: number | null; valueMax: number | null; valueMinNzd: number | null; valueMaxNzd: number | null } = {
    valueMin: null, valueMax: null, valueMinNzd: null, valueMaxNzd: null,
  }
  if (/^[a-f0-9-]{36}$/i.test(id)) {
    try {
      const res = await database.all(sql.raw(
        `SELECT value_min, value_max, value_min_nzd, value_max_nzd FROM deals WHERE id = '${id}' LIMIT 1`,
      )) as unknown as Array<{ value_min: number | null; value_max: number | null; value_min_nzd: number | null; value_max_nzd: number | null }> | { results?: Array<{ value_min: number | null; value_max: number | null; value_min_nzd: number | null; value_max_nzd: number | null }> }
      const rows = Array.isArray(res) ? res : (res?.results ?? [])
      if (rows[0]) {
        valueRange = {
          valueMin: rows[0].value_min,
          valueMax: rows[0].value_max,
          valueMinNzd: rows[0].value_min_nzd,
          valueMaxNzd: rows[0].value_max_nzd,
        }
      }
    } catch {
      // Migration not applied yet.
    }
  }

  // Get contacts for this deal
  const contacts = await database
    .select({
      id: schema.dealContacts.id,
      contactId: schema.dealContacts.contactId,
      role: schema.dealContacts.role,
      contactName: schema.contacts.name,
      contactEmail: schema.contacts.email,
      contactRole: schema.contacts.role,
    })
    .from(schema.dealContacts)
    .leftJoin(schema.contacts, eq(schema.dealContacts.contactId, schema.contacts.id))
    .where(eq(schema.dealContacts.dealId, id))

  // Get activities for this deal. Fetch metadata via a second query using
  // raw SQL so we don't need the column declared in Drizzle yet.
  const dealActivities = await database
    .select({
      id: schema.activities.id,
      type: schema.activities.type,
      title: schema.activities.title,
      description: schema.activities.description,
      createdById: schema.activities.createdById,
      scheduledAt: schema.activities.scheduledAt,
      completedAt: schema.activities.completedAt,
      durationMinutes: schema.activities.durationMinutes,
      outcome: schema.activities.outcome,
      createdAt: schema.activities.createdAt,
      createdByName: schema.teamMembers.name,
    })
    .from(schema.activities)
    .leftJoin(schema.teamMembers, eq(schema.activities.createdById, schema.teamMembers.id))
    .where(eq(schema.activities.dealId, id))
    .orderBy(desc(schema.activities.createdAt))

  // Attach metadata JSON strings via raw SQL.
  let metadataMap: Record<string, string | null> = {}
  try {
    const activityIds = dealActivities.map(a => a.id).filter(aid => /^[a-f0-9-]{36}$/i.test(aid))
    if (activityIds.length > 0) {
      const list = activityIds.map(aid => `'${aid}'`).join(',')
      const res = await database.all(sql.raw(
        `SELECT id, metadata FROM activities WHERE id IN (${list})`,
      )) as unknown as Array<{ id: string; metadata: string | null }> | { results?: Array<{ id: string; metadata: string | null }> }
      const rows = Array.isArray(res) ? res : (res?.results ?? [])
      metadataMap = Object.fromEntries(rows.map(r => [r.id, r.metadata]))
    }
  } catch {
    metadataMap = {}
  }
  const activitiesWithMeta = dealActivities.map(a => ({
    ...a,
    metadata: metadataMap[a.id] ?? null,
  }))

  // Get all pipeline stages for progress indicator
  const stages = await database
    .select({
      id: schema.pipelineStages.id,
      name: schema.pipelineStages.name,
      position: schema.pipelineStages.position,
      colour: schema.pipelineStages.colour,
      isClosedWon: schema.pipelineStages.isClosedWon,
      isClosedLost: schema.pipelineStages.isClosedLost,
    })
    .from(schema.pipelineStages)
    .orderBy(schema.pipelineStages.position)

  // Compute LTV when deal is linked to an org
  let ltv = null
  if (deal.orgId) {
    const [invoiceTotal] = await database
      .select({ total: sql<number>`COALESCE(SUM(${schema.invoices.totalUsd}), 0)` })
      .from(schema.invoices)
      .where(and(
        eq(schema.invoices.orgId, deal.orgId),
        eq(schema.invoices.status, 'paid'),
      ))

    const [wonDealTotal] = await database
      .select({
        total: sql<number>`COALESCE(SUM(${schema.deals.valueNzd}), 0)`,
        count: sql<number>`COUNT(*)`,
      })
      .from(schema.deals)
      .innerJoin(schema.pipelineStages, eq(schema.deals.stageId, schema.pipelineStages.id))
      .where(and(
        eq(schema.deals.orgId, deal.orgId),
        eq(schema.pipelineStages.isClosedWon, 1),
      ))

    const [invoiceCount] = await database
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.invoices)
      .where(and(
        eq(schema.invoices.orgId, deal.orgId),
        eq(schema.invoices.status, 'paid'),
      ))

    ltv = {
      totalPaidInvoices: invoiceTotal?.total ?? 0,
      totalWonDeals: wonDealTotal?.total ?? 0,
      wonDealCount: wonDealTotal?.count ?? 0,
      paidInvoiceCount: invoiceCount?.count ?? 0,
      total: (invoiceTotal?.total ?? 0) + (wonDealTotal?.total ?? 0),
    }
  }

  return NextResponse.json({
    deal: { ...deal, ...valueRange },
    contacts,
    activities: activitiesWithMeta,
    stages,
    ltv,
  })
}

// PATCH /api/admin/deals/[id]
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const body = await req.json() as {
    title?: string
    stageId?: string
    value?: number
    /** Split-value model (migration 0023). Either or both can be set. */
    upfrontValue?: number | null
    monthlyValue?: number | null
    recurringStartDate?: string | null
    valueMin?: number | null
    valueMax?: number | null
    currency?: string
    ownerId?: string | null
    orgId?: string | null
    notes?: string | null
    closedAt?: string | null
    closeReason?: string | null
    source?: string | null
    estimatedHoursPerWeek?: number
    engagementType?: string | null
    totalHours?: number | null
    hoursPerMonth?: number | null
    engagementStartDate?: string | null
    engagementEndDate?: string | null
    expectedCloseDate?: string | null
    wonSource?: string | null
    lostReason?: string | null
    nextActionLabel?: string | null
    nextActionDueAt?: string | null
    autoNudgesDisabled?: boolean
    status?: 'won' | 'lost'
    /** Optional note explaining a value change (shown in activity timeline). */
    valueChangeNote?: string | null
  }

  const database = await db() as unknown as D1
  const now = new Date().toISOString()
  const actor = userId ?? 'system'

  // ── Fetch current deal state so we can diff for activity logging ────────
  const [existing] = await database
    .select({
      title: schema.deals.title,
      stageId: schema.deals.stageId,
      value: schema.deals.value,
      currency: schema.deals.currency,
      valueNzd: schema.deals.valueNzd,
      upfrontValue: schema.deals.upfrontValue,
      upfrontValueNzd: schema.deals.upfrontValueNzd,
      monthlyValue: schema.deals.monthlyValue,
      monthlyValueNzd: schema.deals.monthlyValueNzd,
      recurringStartDate: schema.deals.recurringStartDate,
      ownerId: schema.deals.ownerId,
      orgId: schema.deals.orgId,
      notes: schema.deals.notes,
      source: schema.deals.source,
      engagementType: schema.deals.engagementType,
      totalHours: schema.deals.totalHours,
      hoursPerMonth: schema.deals.hoursPerMonth,
      engagementStartDate: schema.deals.engagementStartDate,
      engagementEndDate: schema.deals.engagementEndDate,
      expectedCloseDate: schema.deals.expectedCloseDate,
      closedAt: schema.deals.closedAt,
      closeReason: schema.deals.closeReason,
      autoNudgesDisabled: schema.deals.autoNudgesDisabled,
    })
    .from(schema.deals)
    .where(eq(schema.deals.id, id))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  // Fetch current range via raw SQL.
  let existingRange: { valueMin: number | null; valueMax: number | null } = { valueMin: null, valueMax: null }
  if (/^[a-f0-9-]{36}$/i.test(id)) {
    try {
      const res = await database.all(sql.raw(
        `SELECT value_min, value_max FROM deals WHERE id = '${id}' LIMIT 1`,
      )) as unknown as Array<{ value_min: number | null; value_max: number | null }> | { results?: Array<{ value_min: number | null; value_max: number | null }> }
      const rows = Array.isArray(res) ? res : (res?.results ?? [])
      if (rows[0]) {
        existingRange = { valueMin: rows[0].value_min, valueMax: rows[0].value_max }
      }
    } catch {
      existingRange = { valueMin: null, valueMax: null }
    }
  }

  // ── Build updates ───────────────────────────────────────────────────────
  const updates: Record<string, unknown> = { updatedAt: now }

  if (body.title !== undefined) updates.title = body.title.trim()
  if (body.stageId !== undefined) updates.stageId = body.stageId
  if (body.currency !== undefined) updates.currency = body.currency

  // Upfront range handling — range now applies only to the upfront portion.
  let nextValueMin: number | null = existingRange.valueMin
  let nextValueMax: number | null = existingRange.valueMax
  let rangeTouched = false

  if (body.valueMin !== undefined || body.valueMax !== undefined) {
    rangeTouched = true
    if (body.valueMin != null && body.valueMax != null && body.valueMin !== body.valueMax) {
      nextValueMin = Math.min(body.valueMin, body.valueMax)
      nextValueMax = Math.max(body.valueMin, body.valueMax)
    } else {
      nextValueMin = null
      nextValueMax = null
    }
  }

  // Resolve the next upfront/monthly values. Caller can send either or both.
  // When a range is supplied without an explicit upfrontValue, midpoint wins.
  const upfrontMidpoint =
    nextValueMin != null && nextValueMax != null && nextValueMin !== nextValueMax
      ? Math.round((nextValueMin + nextValueMax) / 2)
      : null

  let nextUpfront = existing.upfrontValue ?? null
  if (body.upfrontValue !== undefined) {
    nextUpfront = body.upfrontValue == null ? 0 : Math.max(0, Math.round(body.upfrontValue))
  } else if (rangeTouched && upfrontMidpoint != null) {
    nextUpfront = upfrontMidpoint
  } else if (body.value !== undefined) {
    // Legacy single-value clients update upfront via `value`.
    nextUpfront = Math.max(0, Math.round(body.value))
  }

  let nextMonthly = existing.monthlyValue ?? null
  if (body.monthlyValue !== undefined) {
    nextMonthly = body.monthlyValue == null ? 0 : Math.max(0, Math.round(body.monthlyValue))
  }

  let nextRecurringStartDate = existing.recurringStartDate ?? null
  if (body.recurringStartDate !== undefined) {
    nextRecurringStartDate = body.recurringStartDate || null
  }

  // Decide whether the monetary position has been touched at all.
  const monetaryTouched =
    body.value !== undefined ||
    body.upfrontValue !== undefined ||
    body.monthlyValue !== undefined ||
    body.recurringStartDate !== undefined ||
    body.currency !== undefined ||
    rangeTouched

  if (monetaryTouched) {
    updates.upfrontValue = nextUpfront ?? 0
    updates.monthlyValue = nextMonthly ?? 0
    updates.recurringStartDate = nextRecurringStartDate
    // Legacy `value` field stays as a 12-month rollup so downstream code
    // that reads `value` directly keeps working.
    updates.value = (nextUpfront ?? 0) + (nextMonthly ?? 0) * 12
  }

  // Re-compute *Nzd columns when the monetary position changes.
  let nextValueNzd = existing.valueNzd
  let nextValueMinNzd: number | null = null
  let nextValueMaxNzd: number | null = null
  if (monetaryTouched) {
    const finalCurrency = body.currency ?? existing.currency
    const rates = finalCurrency !== 'NZD' ? await database
      .select({ currency: schema.exchangeRates.currency, rateToUsd: schema.exchangeRates.rateToUsd })
      .from(schema.exchangeRates) : []
    const toNzd = (amount: number | null): number | null => {
      if (amount == null) return null
      if (finalCurrency === 'NZD' || amount === 0 || rates.length === 0) return amount
      return Math.round(convertToNzd(amount, finalCurrency, rates))
    }
    nextValueNzd = toNzd(updates.value as number) ?? 0
    updates.valueNzd = nextValueNzd
    updates.upfrontValueNzd = toNzd(nextUpfront ?? 0) ?? 0
    updates.monthlyValueNzd = toNzd(nextMonthly ?? 0) ?? 0
    nextValueMinNzd = toNzd(nextValueMin)
    nextValueMaxNzd = toNzd(nextValueMax)
  }

  if (body.ownerId !== undefined) updates.ownerId = body.ownerId
  if (body.orgId !== undefined) updates.orgId = body.orgId
  if (body.notes !== undefined) updates.notes = body.notes
  if (body.closedAt !== undefined) updates.closedAt = body.closedAt
  if (body.closeReason !== undefined) updates.closeReason = body.closeReason
  if (body.source !== undefined) updates.source = body.source
  if (body.estimatedHoursPerWeek !== undefined) updates.estimatedHoursPerWeek = body.estimatedHoursPerWeek
  if (body.engagementType !== undefined) updates.engagementType = body.engagementType
  if (body.totalHours !== undefined) updates.totalHours = body.totalHours
  if (body.hoursPerMonth !== undefined) updates.hoursPerMonth = body.hoursPerMonth
  if (body.engagementStartDate !== undefined) updates.engagementStartDate = body.engagementStartDate
  if (body.engagementEndDate !== undefined) updates.engagementEndDate = body.engagementEndDate
  if (body.expectedCloseDate !== undefined) updates.expectedCloseDate = body.expectedCloseDate
  if (body.wonSource !== undefined) updates.wonSource = body.wonSource
  if (body.lostReason !== undefined) updates.lostReason = body.lostReason
  if (body.nextActionLabel !== undefined) updates.nextActionLabel = body.nextActionLabel
  if (body.nextActionDueAt !== undefined) updates.nextActionDueAt = body.nextActionDueAt
  if (body.autoNudgesDisabled !== undefined) updates.autoNudgesDisabled = body.autoNudgesDisabled ? 1 : 0

  // When status is explicitly set to won or lost, auto-set closedAt
  if (body.status === 'won' || body.status === 'lost') {
    updates.closedAt = now
  }

  // ── Apply the update ───────────────────────────────────────────────────
  await database
    .update(schema.deals)
    .set(updates)
    .where(eq(schema.deals.id, id))

  // Write range columns via raw SQL (migration 0017).
  if (rangeTouched) {
    try {
      await database.run(sql`
        UPDATE deals
        SET value_min = ${nextValueMin},
            value_max = ${nextValueMax},
            value_min_nzd = ${nextValueMinNzd},
            value_max_nzd = ${nextValueMaxNzd}
        WHERE id = ${id}
      `)
    } catch (err) {
      console.warn('[deals PATCH] range write failed:', err instanceof Error ? err.message : err)
    }
  }

  // ── Activity logging ───────────────────────────────────────────────────
  // Value change (includes range, upfront, monthly, recurring start, and
  // currency changes when they affect the monetary position).
  const before = {
    value: existing.value,
    valueMin: existingRange.valueMin,
    valueMax: existingRange.valueMax,
    currency: existing.currency,
    upfrontValue: existing.upfrontValue,
    monthlyValue: existing.monthlyValue,
    recurringStartDate: existing.recurringStartDate,
  }
  const after = {
    value: (updates.value as number | undefined) ?? existing.value,
    valueMin: rangeTouched ? nextValueMin : existingRange.valueMin,
    valueMax: rangeTouched ? nextValueMax : existingRange.valueMax,
    currency: body.currency ?? existing.currency,
    upfrontValue: monetaryTouched ? nextUpfront : existing.upfrontValue,
    monthlyValue: monetaryTouched ? nextMonthly : existing.monthlyValue,
    recurringStartDate: monetaryTouched ? nextRecurringStartDate : existing.recurringStartDate,
  }
  if (valueChanged(before, after)) {
    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: body.currency !== undefined && body.currency !== existing.currency ? 'currency_change' : 'value_change',
      title: valueChangeTitle(before, after),
      description: body.valueChangeNote ?? null,
      metadata: valueChangeMetadata(before, after, body.valueChangeNote),
      createdById: actor,
    })
  }

  // Stage change
  if (body.stageId !== undefined && body.stageId !== existing.stageId) {
    const [[oldStage], [newStage]] = await Promise.all([
      database.select({ name: schema.pipelineStages.name }).from(schema.pipelineStages).where(eq(schema.pipelineStages.id, existing.stageId)).limit(1),
      database.select({ name: schema.pipelineStages.name, isClosedWon: schema.pipelineStages.isClosedWon, isClosedLost: schema.pipelineStages.isClosedLost }).from(schema.pipelineStages).where(eq(schema.pipelineStages.id, body.stageId)).limit(1),
    ])

    // Auto-set closed_at when the new stage is a closed stage and the
    // deal doesn't already have a close timestamp. Without this, sales
    // velocity ("deals signed in last 30/60/90 days") under-counts
    // because moving a deal to "Closed Won" via the kanban only wrote
    // the stage_id, leaving closed_at NULL.
    if ((newStage?.isClosedWon || newStage?.isClosedLost) && !existing.closedAt) {
      await database
        .update(schema.deals)
        .set({ closedAt: now })
        .where(eq(schema.deals.id, id))
    }
    // How long was the deal in the previous stage? Look at the last
    // stage_change activity (or deal creation) to compute dwell time.
    let daysInPrevStage: number | null = null
    try {
      const res = await database.all(sql.raw(
        `SELECT created_at FROM activities WHERE deal_id = '${id}' AND type IN ('stage_change','deal_created') ORDER BY created_at DESC LIMIT 1`,
      )) as unknown as Array<{ created_at: string }> | { results?: Array<{ created_at: string }> }
      const rows = Array.isArray(res) ? res : (res?.results ?? [])
      if (rows[0]?.created_at) {
        const ms = new Date(now).getTime() - new Date(rows[0].created_at).getTime()
        daysInPrevStage = Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)))
      }
    } catch { /* ignore */ }

    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: 'stage_change',
      title: `Stage changed from ${oldStage?.name ?? 'Unknown'} to ${newStage?.name ?? 'Unknown'}`,
      description: daysInPrevStage != null ? `Spent ${daysInPrevStage} day${daysInPrevStage === 1 ? '' : 's'} in ${oldStage?.name ?? 'previous stage'}` : null,
      metadata: {
        before: { stageId: existing.stageId, name: oldStage?.name ?? null },
        after: { stageId: body.stageId, name: newStage?.name ?? null },
        daysInPrevStage,
      },
      createdById: actor,
    })

    // Auto-MRR on deal close. When the new stage is closed-won AND the
    // deal sits on an org, recompute organisations.custom_mrr by summing
    // monthly_value_nzd across ALL won deals on that org. Additive
    // because multiple retainers on a single client should stack.
    // Triggered any time a deal moves into a won stage so re-promotions
    // and corrections stay accurate.
    try {
      const [stageInfo] = await database
        .select({ isClosedWon: schema.pipelineStages.isClosedWon })
        .from(schema.pipelineStages)
        .where(eq(schema.pipelineStages.id, body.stageId))
        .limit(1)
      if (stageInfo?.isClosedWon && existing.orgId) {
        const sumRows = await database.all<{ total: number | null }>(sql`
          SELECT COALESCE(SUM(d.monthly_value_nzd), 0) AS total
          FROM deals d
          INNER JOIN pipeline_stages s ON d.stage_id = s.id
          WHERE s.is_closed_won = 1
            AND d.org_id = ${existing.orgId}
            AND d.monthly_value_nzd > 0
            AND (d.engagement_end_date IS NULL OR d.engagement_end_date > datetime('now'))
        `)
        const newCustomMrr = Number(sumRows[0]?.total ?? 0)
        if (newCustomMrr > 0) {
          await database.run(sql`
            UPDATE organisations
            SET custom_mrr = ${newCustomMrr}, updated_at = ${now}
            WHERE id = ${existing.orgId}
          `)
        }
      }
    } catch { /* never block the stage update on an MRR recalc */ }
  }

  // Owner change
  if (body.ownerId !== undefined && body.ownerId !== existing.ownerId) {
    const [newOwner] = body.ownerId
      ? await database.select({ name: schema.teamMembers.name }).from(schema.teamMembers).where(eq(schema.teamMembers.id, body.ownerId)).limit(1)
      : [null]
    const [oldOwner] = existing.ownerId
      ? await database.select({ name: schema.teamMembers.name }).from(schema.teamMembers).where(eq(schema.teamMembers.id, existing.ownerId)).limit(1)
      : [null]
    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: 'owner_change',
      title: newOwner
        ? `Owner set to ${newOwner.name}${oldOwner ? ` (was ${oldOwner.name})` : ''}`
        : `Owner unassigned${oldOwner ? ` (was ${oldOwner.name})` : ''}`,
      metadata: { before: { ownerId: existing.ownerId, name: oldOwner?.name ?? null }, after: { ownerId: body.ownerId, name: newOwner?.name ?? null } },
      createdById: actor,
    })
  }

  // Org change
  if (body.orgId !== undefined && body.orgId !== existing.orgId) {
    const [newOrg] = body.orgId
      ? await database.select({ name: schema.organisations.name }).from(schema.organisations).where(eq(schema.organisations.id, body.orgId)).limit(1)
      : [null]
    const [oldOrg] = existing.orgId
      ? await database.select({ name: schema.organisations.name }).from(schema.organisations).where(eq(schema.organisations.id, existing.orgId)).limit(1)
      : [null]
    await logActivity(database, {
      dealId: id,
      orgId: body.orgId ?? existing.orgId,
      type: 'org_change',
      title: newOrg
        ? `Company set to ${newOrg.name}${oldOrg ? ` (was ${oldOrg.name})` : ''}`
        : `Company unassigned${oldOrg ? ` (was ${oldOrg.name})` : ''}`,
      metadata: { before: { orgId: existing.orgId, name: oldOrg?.name ?? null }, after: { orgId: body.orgId, name: newOrg?.name ?? null } },
      createdById: actor,
    })
  }

  // Source change
  if (body.source !== undefined && body.source !== existing.source) {
    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: 'source_change',
      title: `Source ${existing.source ? `changed from ${existing.source} to ${body.source ?? 'unset'}` : `set to ${body.source ?? 'unset'}`}`,
      metadata: { before: existing.source ?? null, after: body.source ?? null },
      createdById: actor,
    })
  }

  // Engagement change (type, totalHours, hoursPerMonth, start/end dates)
  const engagementFieldsChanged =
    (body.engagementType !== undefined && body.engagementType !== existing.engagementType) ||
    (body.totalHours !== undefined && body.totalHours !== existing.totalHours) ||
    (body.hoursPerMonth !== undefined && body.hoursPerMonth !== existing.hoursPerMonth) ||
    (body.engagementStartDate !== undefined && body.engagementStartDate !== existing.engagementStartDate) ||
    (body.engagementEndDate !== undefined && body.engagementEndDate !== existing.engagementEndDate)
  if (engagementFieldsChanged) {
    const nextType = body.engagementType ?? existing.engagementType
    const nextHours = nextType === 'retainer'
      ? (body.hoursPerMonth ?? existing.hoursPerMonth)
      : (body.totalHours ?? existing.totalHours)
    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: 'engagement_change',
      title: `Engagement updated: ${nextType ?? 'not set'}${nextHours != null ? ` \u00b7 ${nextHours}h` : ''}`,
      metadata: {
        before: {
          engagementType: existing.engagementType,
          totalHours: existing.totalHours,
          hoursPerMonth: existing.hoursPerMonth,
          startDate: existing.engagementStartDate,
          endDate: existing.engagementEndDate,
        },
        after: {
          engagementType: body.engagementType ?? existing.engagementType,
          totalHours: body.totalHours ?? existing.totalHours,
          hoursPerMonth: body.hoursPerMonth ?? existing.hoursPerMonth,
          startDate: body.engagementStartDate ?? existing.engagementStartDate,
          endDate: body.engagementEndDate ?? existing.engagementEndDate,
        },
      },
      createdById: actor,
    })
  }

  // Close date change
  if (body.expectedCloseDate !== undefined && body.expectedCloseDate !== existing.expectedCloseDate) {
    const oldDate = existing.expectedCloseDate
    const newDate = body.expectedCloseDate
    let shiftDescription: string | null = null
    if (oldDate && newDate) {
      const diffDays = Math.round((new Date(newDate).getTime() - new Date(oldDate).getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays > 0) shiftDescription = `Pushed out by ${diffDays} day${diffDays === 1 ? '' : 's'}`
      else if (diffDays < 0) shiftDescription = `Pulled forward by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`
    }
    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: 'close_date_change',
      title: oldDate
        ? `Expected close moved from ${oldDate.slice(0, 10)} to ${newDate?.slice(0, 10) ?? 'unset'}`
        : `Expected close set to ${newDate?.slice(0, 10) ?? 'unset'}`,
      description: shiftDescription,
      metadata: { before: oldDate, after: newDate },
      createdById: actor,
    })
  }

  // Notes change (only log when it's a meaningful change, skip whitespace-only)
  if (body.notes !== undefined && (body.notes ?? '').trim() !== (existing.notes ?? '').trim()) {
    const preview = (body.notes ?? '').trim().slice(0, 140)
    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: 'notes_change',
      title: existing.notes ? 'Notes updated' : 'Notes added',
      description: preview.length < (body.notes ?? '').trim().length ? `${preview}\u2026` : preview,
      metadata: { before: existing.notes, after: body.notes },
      createdById: actor,
    })
  }

  // Auto nudges toggled
  const prevNudges = (existing.autoNudgesDisabled ?? 0) === 1
  const nextNudges = body.autoNudgesDisabled !== undefined ? !!body.autoNudgesDisabled : prevNudges
  if (body.autoNudgesDisabled !== undefined && prevNudges !== nextNudges) {
    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: 'auto_nudges_toggled',
      title: nextNudges ? 'Auto-nudges disabled' : 'Auto-nudges enabled',
      metadata: { before: prevNudges, after: nextNudges },
      createdById: actor,
    })
  }

  // Won / Lost
  if (body.status === 'won') {
    const valueStr = formatMoney((updates.value as number | undefined) ?? existing.value, body.currency ?? existing.currency ?? 'NZD')
    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: 'won',
      title: `Deal won \u00b7 ${valueStr}`,
      description: body.wonSource ? `Closed via ${body.wonSource}` : null,
      metadata: { value: (updates.value as number | undefined) ?? existing.value, wonSource: body.wonSource ?? null },
      createdById: actor,
    })
  } else if (body.status === 'lost') {
    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: 'lost',
      title: `Deal lost${body.lostReason ? ` \u00b7 ${body.lostReason}` : ''}`,
      metadata: { lostReason: body.lostReason ?? null },
      createdById: actor,
    })
  }

  // Unarchive (closeReason was 'archived' and now it isn't)
  if (body.closeReason !== undefined && existing.closeReason === 'archived' && body.closeReason !== 'archived') {
    await logActivity(database, {
      dealId: id,
      orgId: existing.orgId,
      type: 'unarchived',
      title: 'Deal unarchived',
      createdById: actor,
    })
  }

  return NextResponse.json({ ok: true })
}

// DELETE /api/admin/deals/[id] -- Soft delete (archives the deal)
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  const database = await db() as unknown as D1
  const now = new Date().toISOString()

  // Verify deal exists
  const [deal] = await database
    .select({ id: schema.deals.id, orgId: schema.deals.orgId, title: schema.deals.title })
    .from(schema.deals)
    .where(eq(schema.deals.id, id))
    .limit(1)

  if (!deal) {
    return NextResponse.json({ error: 'Deal not found' }, { status: 404 })
  }

  // Soft delete: set closedAt and closeReason to 'archived'
  await database
    .update(schema.deals)
    .set({
      closedAt: now,
      closeReason: 'archived',
      updatedAt: now,
    })
    .where(eq(schema.deals.id, id))

  await logActivity(database, {
    dealId: id,
    orgId: deal.orgId,
    type: 'archived',
    title: 'Deal archived',
    createdById: userId ?? 'system',
  })

  return NextResponse.json({ success: true })
}
