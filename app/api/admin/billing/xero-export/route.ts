import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, lt } from 'drizzle-orm'

/**
 * POST /api/admin/billing/xero-export
 * T226: Xero hourly billing export stub.
 * At end of month, auto-creates draft invoices in Xero for each client
 * with billable hours. One line item per client:
 * "Design and development services - [Month] - [X] hours at $[rate]/hr"
 *
 * Body (optional): { month?: 'YYYY-MM' }
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { month?: string }

  // Determine month
  const now = new Date()
  let year: number
  let month: number

  if (body.month && /^\d{4}-\d{2}$/.test(body.month)) {
    [year, month] = body.month.split('-').map(Number)
  } else {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    year = prev.getFullYear()
    month = prev.getMonth() + 1
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-NZ', {
    month: 'long',
    year: 'numeric',
  })

  const database = await db()

  // Get billable time entries for the month
  const entries = await database
    .select({
      orgId: schema.timeEntries.orgId,
      hours: schema.timeEntries.hours,
      hourlyRate: schema.timeEntries.hourlyRate,
    })
    .from(schema.timeEntries)
    .where(
      and(
        gte(schema.timeEntries.date, startDate),
        lt(schema.timeEntries.date, endDate),
        eq(schema.timeEntries.billable, true)
      )
    )

  // Group by org
  const orgTotals = new Map<string, { hours: number; rate: number }>()
  for (const entry of entries) {
    const existing = orgTotals.get(entry.orgId) ?? { hours: 0, rate: entry.hourlyRate ?? 0 }
    existing.hours += entry.hours
    // Use the latest non-zero rate
    if (entry.hourlyRate && entry.hourlyRate > 0) {
      existing.rate = entry.hourlyRate
    }
    orgTotals.set(entry.orgId, existing)
  }

  // Get org names
  const invoiceStubs = []
  for (const [orgIdKey, totals] of orgTotals.entries()) {
    const orgs = await database
      .select({ name: schema.organisations.name })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgIdKey))
      .limit(1)

    const orgName = orgs.length > 0 ? orgs[0].name : orgIdKey
    const lineItem = `Design and development services - ${monthLabel} - ${totals.hours.toFixed(1)} hours at $${totals.rate.toFixed(0)}/hr`
    const amount = totals.hours * totals.rate

    invoiceStubs.push({
      orgId: orgIdKey,
      orgName,
      lineItem,
      hours: totals.hours,
      rate: totals.rate,
      amount,
    })
  }

  // Stub: In production this would call the Xero API to create draft invoices
  // using XERO_CLIENT_ID and XERO_CLIENT_SECRET for OAuth
  const xeroConfigured = !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET)

  return NextResponse.json({
    success: true,
    month: monthLabel,
    invoiceCount: invoiceStubs.length,
    invoices: invoiceStubs,
    xeroSynced: false,
    message: xeroConfigured
      ? 'Xero export stub: would create draft invoices in production'
      : 'Xero not configured. Set XERO_CLIENT_ID and XERO_CLIENT_SECRET to enable.',
  })
}
