import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, lt } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * POST /api/admin/billing/xero-export
 * Auto-generates draft invoices for hourly clients based on billable time entries.
 * Creates both local invoice + pushes to Xero as DRAFT.
 *
 * Body (optional): { month?: 'YYYY-MM', dryRun?: boolean }
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { month?: string; dryRun?: boolean }
  const dryRun = body.dryRun ?? false

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

  const database = await db() as unknown as D1

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
    if (entry.hourlyRate && entry.hourlyRate > 0) {
      existing.rate = entry.hourlyRate
    }
    orgTotals.set(entry.orgId, existing)
  }

  // Get org details (name + xeroContactId + defaultHourlyRate)
  const results = []
  for (const [orgIdKey, totals] of orgTotals.entries()) {
    const [org] = await database
      .select({
        name: schema.organisations.name,
        xeroContactId: schema.organisations.xeroContactId,
        defaultHourlyRate: schema.organisations.defaultHourlyRate,
      })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgIdKey))
      .limit(1)

    if (!org) continue

    // Use org default rate if time entries don't have one
    const rate = totals.rate > 0 ? totals.rate : (org.defaultHourlyRate ?? 0)
    if (rate === 0) continue // Skip if no rate

    const lineItem = `Design and development services - ${monthLabel} - ${totals.hours.toFixed(1)} hours at $${rate.toFixed(0)}/hr`
    const amount = Math.round(totals.hours * rate * 100) / 100

    if (dryRun) {
      results.push({ orgName: org.name, lineItem, hours: totals.hours, rate, amount, status: 'dry_run' })
      continue
    }

    // Create local invoice
    const invoiceId = crypto.randomUUID()
    const invoiceNow = new Date().toISOString()
    const dueDate = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]

    await database.insert(schema.invoices).values({
      id: invoiceId,
      orgId: orgIdKey,
      source: 'xero',
      status: 'draft',
      amountUsd: amount,
      totalUsd: amount,
      currency: 'NZD',
      dueDate,
      notes: `Auto-generated for ${monthLabel} billable hours`,
      createdAt: invoiceNow,
      updatedAt: invoiceNow,
    })

    await database.insert(schema.invoiceItems).values({
      id: crypto.randomUUID(),
      invoiceId,
      description: lineItem,
      quantity: totals.hours,
      unitPriceUsd: rate,
      totalUsd: amount,
    })

    // Push to Xero if org has xeroContactId
    let xeroStatus = 'no_xero_contact'
    if (org.xeroContactId) {
      const xeroResult = await callXeroAPI<{ Invoices?: Array<{ InvoiceID: string; InvoiceNumber: string }> }>('POST', '/Invoices', {
        Invoices: [{
          Type: 'ACCREC',
          Status: 'DRAFT',
          Contact: { ContactID: org.xeroContactId },
          DueDate: dueDate,
          LineAmountTypes: 'Exclusive',
          CurrencyCode: 'NZD',
          LineItems: [{
            Description: lineItem,
            Quantity: totals.hours,
            UnitAmount: rate,
            AccountCode: '200',
          }],
        }],
      })

      if (xeroResult?.Invoices?.[0]) {
        const xeroInv = xeroResult.Invoices[0]
        await database.update(schema.invoices).set({
          xeroInvoiceId: xeroInv.InvoiceID,
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.invoices.id, invoiceId))
        xeroStatus = 'synced'
      } else {
        xeroStatus = 'xero_failed'
      }
    }

    results.push({
      orgName: org.name,
      lineItem,
      hours: totals.hours,
      rate,
      amount,
      invoiceId,
      status: 'created',
      xeroStatus,
    })
  }

  return NextResponse.json({
    success: true,
    month: monthLabel,
    dryRun,
    invoiceCount: results.length,
    invoices: results,
  })
}
