import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc, and, sql } from 'drizzle-orm'
import { requireAccessToOrg } from '@/lib/require-access'

type Params = { params: Promise<{ id: string }> }

// ── GET /api/admin/clients/[id] ──────────────────────────────────────────────
// Returns full client profile: org + contacts + subscription + tracks + recent requests
export async function GET(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping: check the team member can see this specific org
  const denied = await requireAccessToOrg(drizzle, userId, id)
  if (denied) return denied

  const [org] = await drizzle
    .select()
    .from(schema.organisations)
    .where(eq(schema.organisations.id, id))
    .limit(1)

  if (!org) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // billingModel, customMrr, retainerStartDate, retainerEndDate live in DB
  // via migration 0016 but are NOT in Drizzle schema (to avoid crashing
  // SELECT * before migration is applied). Access via raw SQL.
  let billingExtras: Record<string, unknown> = {}
  try {
    const rows = await drizzle.all<{
      custom_mrr: number | null
      billing_model: string | null
      retainer_start_date: string | null
      retainer_end_date: string | null
    }>(
      sql`SELECT custom_mrr, billing_model, retainer_start_date, retainer_end_date
          FROM organisations WHERE id = ${id} LIMIT 1`
    )
    if (rows?.[0]) {
      billingExtras = {
        customMrr: rows[0].custom_mrr,
        billingModel: rows[0].billing_model,
        retainerStartDate: rows[0].retainer_start_date,
        retainerEndDate: rows[0].retainer_end_date,
      }
    }
  } catch {
    // Columns don't exist yet (pre-migration-0016)
  }

  const [contacts, subscription, recentRequests] = await Promise.all([
    drizzle
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, id)),

    drizzle
      .select()
      .from(schema.subscriptions)
      .where(and(
        eq(schema.subscriptions.orgId, id),
        eq(schema.subscriptions.status, 'active'),
      ))
      .orderBy(desc(schema.subscriptions.createdAt))
      .limit(1)
      .then(rows => rows[0] ?? null),

    drizzle
      .select({
        id: schema.requests.id,
        title: schema.requests.title,
        status: schema.requests.status,
        type: schema.requests.type,
        priority: schema.requests.priority,
        updatedAt: schema.requests.updatedAt,
        createdAt: schema.requests.createdAt,
      })
      .from(schema.requests)
      .where(and(
        eq(schema.requests.orgId, id),
        eq(schema.requests.isInternal, false),
      ))
      .orderBy(desc(schema.requests.updatedAt))
      .limit(10),
  ])

  // Get tracks if subscription exists
  let tracks: unknown[] = []
  if (subscription) {
    tracks = await drizzle
      .select({
        id: schema.tracks.id,
        type: schema.tracks.type,
        isPriorityTrack: schema.tracks.isPriorityTrack,
        currentRequestId: schema.tracks.currentRequestId,
        currentRequestTitle: schema.requests.title,
      })
      .from(schema.tracks)
      .leftJoin(schema.requests, eq(schema.tracks.currentRequestId, schema.requests.id))
      .where(eq(schema.tracks.subscriptionId, subscription.id))
  }

  return NextResponse.json({ org: { ...org, ...billingExtras }, contacts, subscription, tracks, recentRequests })
}

// ── PATCH /api/admin/clients/[id] ────────────────────────────────────────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json() as Partial<{
    name: string
    website: string
    industry: string
    planType: string
    status: string
    healthStatus: string
    healthNote: string
    internalNotes: string
    brands: string
    customFields: string
    defaultHourlyRate: number | null
    size: string | null
    annualRevenue: number | null
    customMrr: number | null
    billingModel: string | null
    retainerStartDate: string | null
    retainerEndDate: string | null
  }>

  const now = new Date().toISOString()
  const patch: Record<string, unknown> = { updatedAt: now }
  const allowed = [
    'name', 'website', 'industry', 'planType', 'status',
    'healthStatus', 'healthNote', 'internalNotes', 'brands',
    'customFields', 'defaultHourlyRate', 'size', 'annualRevenue',
  ] as const
  for (const key of allowed) {
    if (key in body) patch[key] = body[key] ?? null
  }

  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Access scoping
  const denied = await requireAccessToOrg(drizzle, userId, id)
  if (denied) return denied

  await drizzle
    .update(schema.organisations)
    .set(patch)
    .where(eq(schema.organisations.id, id))

  // Handle billing fields via raw SQL (not in Drizzle schema to avoid
  // crashing SELECT * before migration 0016 is applied). Each field that
  // is explicitly present in the request body flips its `_is_manual`
  // companion column to 1 so the next auto-derivation pass leaves it
  // alone. To re-enable auto-derivation for a field, POST to
  // /api/admin/clients/[id]/auto-derive with clearOverrides.
  const billingColumnMap: Record<string, { col: string; manualFlag: string | null }> = {
    customMrr: { col: 'custom_mrr', manualFlag: 'custom_mrr_is_manual' },
    billingModel: { col: 'billing_model', manualFlag: 'billing_model_is_manual' },
    retainerStartDate: { col: 'retainer_start_date', manualFlag: 'retainer_dates_is_manual' },
    retainerEndDate: { col: 'retainer_end_date', manualFlag: 'retainer_dates_is_manual' },
  }
  const billingFields = Object.keys(billingColumnMap) as Array<keyof typeof billingColumnMap>
  const touchedManualFlags = new Set<string>()

  for (const field of billingFields) {
    if (field in body) {
      const { col, manualFlag } = billingColumnMap[field]
      const val = body[field as keyof typeof body] ?? null
      try {
        await drizzle.run(sql`UPDATE organisations SET ${sql.raw(col)} = ${val} WHERE id = ${id}`)
        if (manualFlag) touchedManualFlags.add(manualFlag)
      } catch {
        // Column does not exist yet (pre-migration-0016) — silently skip.
      }
    }
  }

  for (const flag of touchedManualFlags) {
    try {
      await drizzle.run(sql`UPDATE organisations SET ${sql.raw(flag)} = 1 WHERE id = ${id}`)
    } catch {
      // Flag column does not exist yet — silently skip.
    }
  }

  return NextResponse.json({ success: true })
}
