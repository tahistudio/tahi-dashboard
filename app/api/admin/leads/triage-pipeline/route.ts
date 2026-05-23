import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, or, isNull, sql } from 'drizzle-orm'
import { lookupOrCreatePerson } from '@/lib/people'

/**
 * Pipeline triage: find deals that should have been leads.
 *
 * Criteria for "should've been a lead":
 *   - Currently in stage 'Lead' (any deal there is leadlike by definition)
 *   - OR in stage 'Stalled' AND has no proposals attached AND no
 *     contract_documents attached
 *
 * For each candidate:
 *   - Create a lead row carrying the deal's title/value/notes
 *   - Resolve a person via lookup-or-create from the first primary
 *     deal contact (or fall back to the deal title parsed as a name)
 *   - Insert an activity stamped "Demoted from pipeline" on the lead
 *   - Delete the deal (cascades dealContacts + activities tied to
 *     the dealId — note: activities can be lead OR deal scoped, so
 *     deleting a deal only nukes activities that weren't also lead
 *     activities by definition)
 *
 * Org rows are preserved (a lead can re-attach on promote later).
 *
 * Modes:
 *   ?dryRun=true   (default) returns the candidate list with reasons
 *   ?dryRun=false  actually executes the move
 */
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const dryRun = url.searchParams.get('dryRun') !== 'false'

  const database = await db()

  // ── Pull the stages we care about ──
  const stages = await database
    .select({
      id: schema.pipelineStages.id,
      name: schema.pipelineStages.name,
    })
    .from(schema.pipelineStages)
    .where(
      or(
        sql`lower(${schema.pipelineStages.name}) = 'lead'`,
        sql`lower(${schema.pipelineStages.name}) = 'stalled'`,
      ),
    )

  const leadStageIds = stages.filter(s => s.name.toLowerCase() === 'lead').map(s => s.id)
  const stalledStageIds = stages.filter(s => s.name.toLowerCase() === 'stalled').map(s => s.id)
  const targetStageIds = [...leadStageIds, ...stalledStageIds]

  if (targetStageIds.length === 0) {
    return NextResponse.json({
      candidates: [],
      moved: 0,
      message: 'No Lead/Stalled stages found.',
    })
  }

  // ── Fetch all deals in those stages ──
  const allDeals = await database
    .select()
    .from(schema.deals)
    .where(sql`${schema.deals.stageId} IN (${sql.join(targetStageIds.map(id => sql`${id}`), sql`, `)})`)

  // ── For each, evaluate "no engagement" ──
  type Candidate = {
    dealId: string
    title: string
    orgId: string | null
    orgName: string | null
    stageName: string
    stageId: string
    reason: 'lead_stage' | 'stalled_no_engagement'
    upfrontValue: number | null
    monthlyValue: number | null
    currency: string
    notes: string | null
    source: string | null
    proposalCount: number
    contractCount: number
    contactsCount: number
  }
  const candidates: Candidate[] = []

  for (const d of allDeals) {
    const inLeadStage = leadStageIds.includes(d.stageId)
    const inStalledStage = stalledStageIds.includes(d.stageId)

    // Check proposals attached to this deal.
    const proposalCount = await database
      .select({ count: sql<number>`count(*)` })
      .from(schema.proposals)
      .where(eq(schema.proposals.dealId, d.id))
      .then(r => r[0]?.count ?? 0)

    // Check contracts attached to this deal.
    const contractCount = await database
      .select({ count: sql<number>`count(*)` })
      .from(schema.contractDocuments)
      .where(eq(schema.contractDocuments.dealId, d.id))
      .then(r => r[0]?.count ?? 0)

    const contactsCount = await database
      .select({ count: sql<number>`count(*)` })
      .from(schema.dealContacts)
      .where(eq(schema.dealContacts.dealId, d.id))
      .then(r => r[0]?.count ?? 0)

    let reason: Candidate['reason'] | null = null
    if (inLeadStage) {
      reason = 'lead_stage'
    } else if (inStalledStage && proposalCount === 0 && contractCount === 0) {
      reason = 'stalled_no_engagement'
    }

    if (!reason) continue

    // Look up org name for the dry-run report.
    let orgName: string | null = null
    if (d.orgId) {
      const o = await database
        .select({ name: schema.organisations.name })
        .from(schema.organisations)
        .where(eq(schema.organisations.id, d.orgId))
        .limit(1)
      orgName = o[0]?.name ?? null
    }
    const stageName = stages.find(s => s.id === d.stageId)?.name ?? '?'

    candidates.push({
      dealId: d.id,
      title: d.title,
      orgId: d.orgId,
      orgName,
      stageName,
      stageId: d.stageId,
      reason,
      upfrontValue: d.upfrontValue ?? d.value ?? null,
      monthlyValue: d.monthlyValue ?? null,
      currency: d.currency,
      notes: d.notes,
      source: d.source,
      proposalCount,
      contractCount,
      contactsCount,
    })
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      candidates,
      summary: {
        total: candidates.length,
        byReason: {
          lead_stage: candidates.filter(c => c.reason === 'lead_stage').length,
          stalled_no_engagement: candidates.filter(c => c.reason === 'stalled_no_engagement').length,
        },
      },
    })
  }

  // ── Live mode: actually move them ──
  const now = new Date().toISOString()
  const moved: Array<{ dealId: string; leadId: string; title: string }> = []
  const failures: Array<{ dealId: string; title: string; error: string }> = []

  // Resolve the calling team member for activity attribution.
  const tm = await database
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.clerkUserId, userId))
    .limit(1)
  const callerTeamMemberId = tm[0]?.id ?? null

  for (const c of candidates) {
    try {
      // Best-effort: pull the deal's primary contact for person info.
      let leadName = parseFirstPersonOutOfTitle(c.title) || c.orgName || c.title
      let leadEmail: string | null = null
      const leadPhone: string | null = null

      const dealContactRows = await database
        .select({
          contactId: schema.dealContacts.contactId,
          name: schema.contacts.name,
          email: schema.contacts.email,
          personId: schema.contacts.personId,
        })
        .from(schema.dealContacts)
        .leftJoin(schema.contacts, eq(schema.dealContacts.contactId, schema.contacts.id))
        .where(eq(schema.dealContacts.dealId, c.dealId))
        .limit(1)

      if (dealContactRows.length > 0 && dealContactRows[0].name) {
        leadName = dealContactRows[0].name
        leadEmail = dealContactRows[0].email ?? null
      }

      // Canonical person identity. Use the existing person from the
      // contact if we have one; otherwise lookup-or-create on email.
      let personId: string | null = dealContactRows[0]?.personId ?? null
      if (!personId) {
        personId = await lookupOrCreatePerson(database, {
          fullName: leadName,
          email: leadEmail,
          phone: leadPhone,
        })
      }

      const leadId = crypto.randomUUID()
      await database.insert(schema.leads).values({
        id: leadId,
        personId,
        name: leadName,
        email: leadEmail,
        phone: leadPhone,
        company: c.orgName,
        source: c.source || 'manual',
        sourceDetail: `Demoted from pipeline (${c.reason === 'lead_stage' ? 'Lead stage' : 'Stalled, no engagement'})`,
        brief: c.notes,
        estimatedValue: c.upfrontValue ?? c.monthlyValue ?? null,
        currency: c.currency,
        status: c.reason === 'lead_stage' ? 'new' : 'nurturing',
        createdAt: now,
        updatedAt: now,
      })

      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: 'lead_demoted',
        title: `Demoted from pipeline (was in ${c.stageName} stage)`,
        description: c.reason === 'stalled_no_engagement'
          ? 'No proposal, no contract, no real engagement — moved to leads for nurture.'
          : 'Was sitting at the top of the funnel — moved to leads where it belongs.',
        leadId,
        orgId: c.orgId,
        createdById: callerTeamMemberId ?? userId,
        createdAt: now,
        updatedAt: now,
      })

      // Delete the deal. Cascades dealContacts; activities tied to
      // this dealId get cascaded too.
      await database.delete(schema.deals).where(eq(schema.deals.id, c.dealId))

      moved.push({ dealId: c.dealId, leadId, title: c.title })
    } catch (err) {
      failures.push({
        dealId: c.dealId,
        title: c.title,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    dryRun: false,
    moved,
    failures,
    summary: { totalCandidates: candidates.length, moved: moved.length, failed: failures.length },
  })
}

/**
 * Yank a likely person name out of a deal title like
 * "Charles Bilash - Costa Rica Luxury Real Estate Platform" or
 * "Hey Dee Ho - Webflow Website (Melissa Smile)".
 * Returns null if nothing obvious found.
 */
function parseFirstPersonOutOfTitle(title: string): string | null {
  // Pattern: "<name> - <project>"  → take the bit before " - "
  const hyphenSplit = title.split(' - ')
  if (hyphenSplit.length > 1) {
    const candidate = hyphenSplit[0].trim()
    if (candidate.length > 0 && candidate.length < 80) return candidate
  }
  return null
}
