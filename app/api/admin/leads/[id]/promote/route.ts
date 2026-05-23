import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, asc, sql } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// ── POST /api/admin/leads/[id]/promote ─────────────────────────────────────
// Turn a qualified lead into a deal.
//
// Body (all optional):
//   orgId         — attach the deal to an existing organisation. If
//                   omitted and `createOrg` is true, a new org is
//                   spun up from the lead's company name.
//   createOrg     — boolean. Default true when no orgId supplied.
//   dealTitle     — override; defaults to "<lead.company> · <lead.name>"
//                   or "<lead.name>" when no company is set
//   stageId       — landing stage. Defaults to the first non-closed
//                   pipeline stage by position.
//   upfrontValue
//   monthlyValue
//   currency      — defaults to the lead's currency
//
// Side effects:
//   - Optional org create (when createOrg + no orgId)
//   - Optional contact create at the org (skipped if a contact with
//     the same personId already exists at that org)
//   - Deal created with engagement defaults, value from the lead
//   - deal_contacts junction wired
//   - Lead status flips to 'promoted', promoted_deal_id set,
//     promoted_at stamped
//   - Activity stamped on both lead + deal
//
// Returns: { dealId, orgId, contactId }
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId: tenantOrgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(tenantOrgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: leadId } = await params
  const database = await db()

  const leadRows = await database
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .limit(1)
  if (leadRows.length === 0) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }
  const lead = leadRows[0]
  if (lead.status === 'promoted' && lead.promotedDealId) {
    return NextResponse.json({ error: 'Lead already promoted', dealId: lead.promotedDealId }, { status: 409 })
  }

  let body: {
    orgId?: string | null
    createOrg?: boolean
    dealTitle?: string
    stageId?: string
    upfrontValue?: number | null
    monthlyValue?: number | null
    currency?: string
  }
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  // ── Resolve org ──
  let orgId = body.orgId ?? null
  if (!orgId && body.createOrg !== false) {
    const orgName = lead.company?.trim() || lead.name.trim()
    const orgIdNew = crypto.randomUUID()
    const now = new Date().toISOString()
    await database.insert(schema.organisations).values({
      id: orgIdNew,
      name: orgName,
      status: 'prospect',
      website: lead.website ?? null,
      createdAt: now,
      updatedAt: now,
    })
    orgId = orgIdNew
  }
  if (!orgId) {
    return NextResponse.json({ error: 'orgId required (or pass createOrg: true)' }, { status: 400 })
  }

  // ── Resolve landing stage ──
  let stageId = body.stageId ?? null
  if (!stageId) {
    const stages = await database
      .select({ id: schema.pipelineStages.id })
      .from(schema.pipelineStages)
      .where(sql`${schema.pipelineStages.isClosedWon} = 0 AND ${schema.pipelineStages.isClosedLost} = 0`)
      .orderBy(asc(schema.pipelineStages.position))
      .limit(1)
    if (stages.length === 0) {
      return NextResponse.json({ error: 'No open pipeline stages found' }, { status: 500 })
    }
    stageId = stages[0].id
  }

  // ── Resolve contact (lookup by personId at this org, or create) ──
  let contactId: string | null = null
  if (lead.personId) {
    const existing = await database
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(sql`${schema.contacts.orgId} = ${orgId} AND ${schema.contacts.personId} = ${lead.personId}`)
      .limit(1)
    if (existing.length > 0) contactId = existing[0].id
  }
  if (!contactId) {
    contactId = crypto.randomUUID()
    const now = new Date().toISOString()
    await database.insert(schema.contacts).values({
      id: contactId,
      orgId,
      personId: lead.personId,
      name: lead.name,
      email: lead.email ?? '',
      role: lead.jobTitle ?? null,
      isPrimary: false,
      createdAt: now,
      updatedAt: now,
    })
  }

  // ── Create deal ──
  const dealId = crypto.randomUUID()
  const now = new Date().toISOString()
  const dealTitle = body.dealTitle?.trim()
    || (lead.company ? `${lead.company} · ${lead.name}` : lead.name)
  const upfrontValue = body.upfrontValue ?? lead.estimatedValue ?? 0
  const monthlyValue = body.monthlyValue ?? 0
  const currency = body.currency || lead.currency || 'NZD'
  // valueNzd / value backfill: keep legacy fields populated so charts
  // that haven't switched to upfront+monthly keep working.
  const legacyValue = upfrontValue + monthlyValue
  // Resolve owner: prefer lead.ownerId, else caller's team member.
  let ownerId = lead.ownerId ?? null
  if (!ownerId) {
    const tm = await database
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.clerkUserId, userId))
      .limit(1)
    if (tm.length > 0) ownerId = tm[0].id
  }

  await database.insert(schema.deals).values({
    id: dealId,
    title: dealTitle,
    orgId,
    stageId,
    ownerId,
    value: legacyValue,
    currency,
    valueNzd: legacyValue,
    upfrontValue,
    upfrontValueNzd: upfrontValue,
    monthlyValue,
    monthlyValueNzd: monthlyValue,
    source: lead.source ?? 'lead',
    notes: lead.brief ?? null,
    createdAt: now,
    updatedAt: now,
  })

  // ── deal_contacts junction ──
  await database.insert(schema.dealContacts).values({
    id: crypto.randomUUID(),
    dealId,
    contactId,
    role: 'primary',
  })

  // ── Flip the lead ──
  await database
    .update(schema.leads)
    .set({
      status: 'promoted',
      promotedDealId: dealId,
      promotedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.leads.id, leadId))

  // ── Activity stamps ──
  await database.insert(schema.activities).values({
    id: crypto.randomUUID(),
    type: 'lead_promoted',
    title: `Promoted to deal: ${dealTitle}`,
    description: null,
    leadId,
    dealId,
    orgId,
    contactId,
    createdById: userId,
    createdAt: now,
    updatedAt: now,
  })

  return NextResponse.json({ dealId, orgId, contactId }, { status: 201 })
}
