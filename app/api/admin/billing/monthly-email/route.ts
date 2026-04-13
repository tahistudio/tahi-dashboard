import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, and, gte, lt } from 'drizzle-orm'

/**
 * POST /api/admin/billing/monthly-email
 * T224: Monthly billing email. Generates a per-client table of billable hours
 * and amounts for the prior month, and sends it via Resend.
 *
 * Can be triggered by a Cloudflare Cron Trigger on the 1st of each month,
 * or manually from the admin dashboard.
 *
 * Body (optional): { month?: 'YYYY-MM' } - defaults to previous month
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { month?: string }

  // Determine the month to report on
  const now = new Date()
  let year: number
  let month: number

  if (body.month && /^\d{4}-\d{2}$/.test(body.month)) {
    [year, month] = body.month.split('-').map(Number)
  } else {
    // Default to previous month
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    year = prev.getFullYear()
    month = prev.getMonth() + 1
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`
  const endDate = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const database = await db()

  // Get all billable time entries for the month
  const entries = await database
    .select({
      orgId: schema.timeEntries.orgId,
      hours: schema.timeEntries.hours,
      hourlyRate: schema.timeEntries.hourlyRate,
      billable: schema.timeEntries.billable,
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
  const orgTotals = new Map<string, { hours: number; amount: number }>()
  for (const entry of entries) {
    const existing = orgTotals.get(entry.orgId) ?? { hours: 0, amount: 0 }
    existing.hours += entry.hours
    existing.amount += entry.hours * (entry.hourlyRate ?? 0)
    orgTotals.set(entry.orgId, existing)
  }

  // Get org names
  const orgNames = new Map<string, string>()
  for (const orgIdKey of orgTotals.keys()) {
    const orgs = await database
      .select({ name: schema.organisations.name })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgIdKey))
      .limit(1)
    if (orgs.length > 0) orgNames.set(orgIdKey, orgs[0].name)
  }

  // Build the email content
  const rows = Array.from(orgTotals.entries()).map(([orgIdKey, totals]) => ({
    client: orgNames.get(orgIdKey) ?? orgIdKey,
    hours: totals.hours.toFixed(1),
    amount: `$${totals.amount.toFixed(2)}`,
  }))

  const totalHours = rows.reduce((sum, r) => sum + parseFloat(r.hours), 0)
  const totalAmount = rows.reduce((sum, r) => sum + parseFloat(r.amount.replace('$', '')), 0)

  const monthLabel = new Date(year, month - 1).toLocaleDateString('en-NZ', {
    month: 'long',
    year: 'numeric',
  })

  // Build HTML email
  const tableRows = rows.map(r =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${r.client}</td>` +
    `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${r.hours}h</td>` +
    `<td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right">${r.amount}</td></tr>`
  ).join('')

  const emailHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1e2a1b">Monthly Billing Summary - ${monthLabel}</h2>
      <table style="width:100%;border-collapse:collapse;margin-top:16px">
        <thead>
          <tr style="background:#f5f7f5">
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d4e0d0">Client</th>
            <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #d4e0d0">Hours</th>
            <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #d4e0d0">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          <tr style="font-weight:bold;background:#f5f7f5">
            <td style="padding:8px 12px">Total</td>
            <td style="padding:8px 12px;text-align:right">${totalHours.toFixed(1)}h</td>
            <td style="padding:8px 12px;text-align:right">$${totalAmount.toFixed(2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `

  // Send via Resend
  const resendKey = process.env.RESEND_API_KEY
  if (resendKey && rows.length > 0) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Tahi Studio <business@tahi.studio>',
          to: ['liam@tahi.studio'],
          subject: `Monthly Billing Summary - ${monthLabel}`,
          html: emailHtml,
        }),
      })
    } catch {
      // Email send failed silently
    }
  }

  return NextResponse.json({
    success: true,
    month: monthLabel,
    clientCount: rows.length,
    totalHours: totalHours.toFixed(1),
    totalAmount: `$${totalAmount.toFixed(2)}`,
    rows,
    emailSent: !!resendKey && rows.length > 0,
  })
}
