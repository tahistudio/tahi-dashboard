import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import type { CalculationInputs, CalculationOutputs } from '@/lib/calculator/types'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/calculator/draft
 * Body: { calculationId: string; target: 'proposal' | 'schedule' | 'contract' }
 *
 * Creates a fresh artefact pre-filled from a saved calculation, links
 * the calc to it via linkedArtefactRef, and returns { id, url }. The
 * calc keeps owning its inputs + outputs; the artefact is a snapshot
 * at draft time.
 */
export async function POST(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as {
    calculationId?: string
    target?: 'proposal' | 'schedule' | 'contract'
  }
  if (!body.calculationId) return NextResponse.json({ error: 'calculationId required' }, { status: 400 })
  if (!body.target) return NextResponse.json({ error: 'target required' }, { status: 400 })

  const database = await db() as unknown as D1
  const [calc] = await database
    .select()
    .from(schema.projectCalculations)
    .where(eq(schema.projectCalculations.id, body.calculationId))
    .limit(1)
  if (!calc) return NextResponse.json({ error: 'Calculation not found' }, { status: 404 })

  let inputs: CalculationInputs
  let outputs: CalculationOutputs
  try {
    inputs = JSON.parse(calc.inputs) as CalculationInputs
    outputs = JSON.parse(calc.outputs) as CalculationOutputs
  } catch {
    return NextResponse.json({ error: 'Calculation inputs/outputs are corrupt' }, { status: 500 })
  }

  const now = new Date().toISOString()
  const dealId = calc.dealId
  const orgIdForArtefact = calc.orgId

  // Resolve client + deal context for nicer naming. Best-effort — we
  // don't fail the draft if the lookup misses.
  let dealTitle: string | null = null
  if (dealId) {
    const [deal] = await database.select({ title: schema.deals.title })
      .from(schema.deals).where(eq(schema.deals.id, dealId)).limit(1)
    dealTitle = deal?.title ?? null
  }

  if (body.target === 'proposal') {
    return draftProposal(database, calc.id, inputs, outputs, dealId, orgIdForArtefact, dealTitle, userId, now)
  }
  if (body.target === 'schedule') {
    return draftSchedule(database, calc.id, inputs, dealId, orgIdForArtefact, dealTitle, userId, now)
  }
  if (body.target === 'contract') {
    return draftContract(database, calc.id, inputs, outputs, dealId, orgIdForArtefact, dealTitle, userId, now)
  }
  return NextResponse.json({ error: 'Unknown target' }, { status: 400 })
}

async function draftProposal(
  database: D1,
  calcId: string,
  inputs: CalculationInputs,
  outputs: CalculationOutputs,
  dealId: string | null,
  orgIdForArtefact: string | null,
  dealTitle: string | null,
  userId: string | null,
  now: string,
): Promise<NextResponse> {
  const proposalId = crypto.randomUUID()
  const title = dealTitle ? `${dealTitle} proposal` : 'New proposal'

  await database.insert(schema.proposals).values({
    id: proposalId,
    orgId: orgIdForArtefact ?? null,
    dealId: dealId ?? null,
    title,
    subtitle: 'Draft from project calculator',
    preparedFor: null,
    preparedBy: null,
    effectiveDate: inputs.timeline.startDate,
    expiresAt: addDaysIso(now, 30),
    status: 'draft',
    coverTheme: 'brand_glass',
    createdById: userId ?? 'api-service',
    createdAt: now,
    updatedAt: now,
  })

  // Three variants — Standard, Standard + Care (featured if retainer
  // applies), Premium. Pulled from outputs.recommendation tiers.
  const ccy = inputs.client.currency
  const target = outputs.recommendation.target
  const monthly = outputs.pacing.asProjectPlusRetainer?.monthlyFee ?? 0
  const variants = [
    {
      name: 'Standard build',
      tagline: 'A clean delivery of the agreed scope.',
      oneOffAmount: outputs.recommendation.floor,
      monthlyAmount: 0,
      isFeatured: 0,
    },
    {
      name: 'Standard + Care',
      tagline: monthly > 0 ? 'Build, plus an ongoing retainer with the loyalty discount.' : 'Build, plus a steady ongoing cadence.',
      oneOffAmount: target,
      monthlyAmount: monthly,
      isFeatured: monthly > 0 ? 1 : 0,
    },
    {
      name: 'Premium',
      tagline: 'Faster timeline, deeper scope, full ongoing partnership.',
      oneOffAmount: outputs.recommendation.stretch,
      monthlyAmount: Math.round(monthly * 1.6),
      isFeatured: 0,
    },
  ]
  const scopeHtml = scopeHtmlFromInputs(inputs)
  await database.insert(schema.proposalVariants).values(
    variants.map((v, i) => ({
      id: crypto.randomUUID(),
      proposalId,
      name: v.name,
      tagline: v.tagline,
      oneOffAmount: v.oneOffAmount,
      monthlyAmount: v.monthlyAmount,
      currency: ccy,
      scopeHtml,
      pricingNotesHtml: '<p>50% on signing, 50% on launch.</p>',
      ctaLabel: `Accept ${v.name}`,
      isFeatured: v.isFeatured,
      position: i,
      createdAt: now,
      updatedAt: now,
    }))
  )

  await database.update(schema.projectCalculations).set({
    linkedArtefactRef: `proposal:${proposalId}`,
    updatedAt: now,
  }).where(eq(schema.projectCalculations.id, calcId))

  return NextResponse.json({ id: proposalId, url: `/proposals/${proposalId}` })
}

async function draftSchedule(
  database: D1,
  calcId: string,
  inputs: CalculationInputs,
  dealId: string | null,
  orgIdForArtefact: string | null,
  dealTitle: string | null,
  userId: string | null,
  now: string,
): Promise<NextResponse> {
  const scheduleId = crypto.randomUUID()
  const title = dealTitle ? `${dealTitle} schedule` : 'New project schedule'
  await database.insert(schema.projectSchedules).values({
    id: scheduleId,
    orgId: orgIdForArtefact ?? null,
    dealId: dealId ?? null,
    proposalId: null,
    title,
    subtitle: 'Draft from project calculator',
    preparedFor: null,
    preparedBy: null,
    effectiveDate: inputs.timeline.startDate,
    targetLaunchDate: inputs.timeline.targetLaunchDate,
    numberOfWeeks: inputs.timeline.durationWeeks,
    overviewHtml: null,
    status: 'draft',
    createdById: userId ?? 'api-service',
    createdAt: now,
    updatedAt: now,
  })

  // Seed a default gantt section so the schedule renders something
  // the moment it opens.
  await database.insert(schema.scheduleSections).values({
    id: crypto.randomUUID(),
    scheduleId,
    type: 'gantt',
    title: 'Project schedule',
    subtitle: null,
    startWeek: null,
    endWeek: null,
    data: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
  })

  await database.update(schema.projectCalculations).set({
    linkedArtefactRef: `schedule:${scheduleId}`,
    updatedAt: now,
  }).where(eq(schema.projectCalculations.id, calcId))

  return NextResponse.json({ id: scheduleId, url: `/schedules/${scheduleId}` })
}

async function draftContract(
  database: D1,
  calcId: string,
  inputs: CalculationInputs,
  outputs: CalculationOutputs,
  dealId: string | null,
  orgIdForArtefact: string | null,
  dealTitle: string | null,
  userId: string | null,
  now: string,
): Promise<NextResponse> {
  const contractId = crypto.randomUUID()
  const ccy = inputs.client.currency
  const fmtMoney = (n: number) => `${ccy} ${n.toLocaleString()}`
  const target = outputs.recommendation.target
  const monthly = outputs.pacing.asProjectPlusRetainer?.monthlyFee ?? 0

  const name = dealTitle ? `${dealTitle} SoW` : 'Statement of Work'

  const bodyHtml = `
    <h2>Statement of work</h2>
    <p><strong>Engagement:</strong> ${dealTitle ?? 'Project engagement'}</p>
    <p><strong>Project fee:</strong> ${fmtMoney(target)}${monthly > 0 ? `, plus ${fmtMoney(monthly)} per month retainer` : ''}.</p>
    <p><strong>Effective:</strong> ${inputs.timeline.startDate}</p>
    <p><strong>Target launch:</strong> ${inputs.timeline.targetLaunchDate}</p>

    <h3>Scope</h3>
    ${scopeHtmlFromInputs(inputs)}

    <h3>Payment</h3>
    <p>50% on signing, 50% on launch. ${monthly > 0 ? `Retainer billed monthly in advance, starting on launch day.` : ''}</p>

    <h3>Cancellation</h3>
    <p>Either party can end the engagement with one month's notice. No minimum term.</p>

    <h3>IP</h3>
    <p>All deliverables transfer to the client on final payment.</p>

    <h3>Confidentiality</h3>
    <p>Both parties agree to keep non-public information shared during the engagement private.</p>
  `.trim()

  await database.insert(schema.contractDocuments).values({
    id: contractId,
    orgId: orgIdForArtefact ?? null,
    dealId: dealId ?? null,
    proposalId: null,
    templateId: null,
    type: 'sow',
    name,
    status: 'draft',
    bodyHtml,
    variableValues: null,
    publicShareToken: null,
    publicSharedAt: null,
    sentAt: null,
    signedAt: null,
    expiresAt: null,
    finalHash: null,
    createdById: userId ?? 'api-service',
    createdAt: now,
    updatedAt: now,
  })

  await database.update(schema.projectCalculations).set({
    linkedArtefactRef: `contract:${contractId}`,
    updatedAt: now,
  }).where(eq(schema.projectCalculations.id, calcId))

  return NextResponse.json({ id: contractId, url: `/contracts/${contractId}` })
}

/** Build a scope HTML block from a calculation's per-line inputs. */
function scopeHtmlFromInputs(inputs: CalculationInputs): string {
  const lines: string[] = []
  for (const key of ['webflow', 'engineering', 'design', 'strategy'] as const) {
    const line = inputs.scope[key]
    if (line.hours <= 0) continue
    const label = key === 'webflow' ? 'Webflow build'
      : key === 'engineering' ? 'Engineering'
      : key === 'design' ? 'Design'
      : 'Strategy'
    const delivery = line.delivery === 'ourselves' ? '' : ' (contractor)'
    lines.push(`<li>${label}${delivery}: ${line.hours} hours</li>`)
  }
  if (lines.length === 0) return '<p>Scope to be detailed.</p>'
  return `<ul>${lines.join('')}</ul>`
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}
