import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, sql, gte } from 'drizzle-orm'
import { callXeroAPIOrThrow, XeroAPIError } from '@/lib/xero'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Xero's Profit & Loss report returns a deeply nested Rows structure.
 * Each top-level Row.RowType can be 'Header', 'Section', or 'Row'.
 * Sections contain rows (expense line items) with a Title (category name)
 * and either nested Rows or a SummaryRow.
 *
 * For a single-period query we get one value column per row.
 * We want to extract:
 *   - Total Income (Section with Title "Income" or "Revenue")
 *   - Total Cost of Sales
 *   - Total Operating Expenses
 *   - Individual expense line items (for categorisation)
 */

interface XeroRow {
  RowType: string
  Title?: string
  Rows?: XeroRow[]
  Cells?: Array<{ Value: string; Attributes?: Array<{ Value: string; Id: string }> }>
}

interface XeroPnlReport {
  Reports: Array<{
    ReportName: string
    ReportDate: string
    Fields?: Array<unknown>
    Rows: XeroRow[]
  }>
}

function toNumber(v: string | undefined): number {
  if (!v) return 0
  const n = parseFloat(v.replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function extractAccountCodeFromCell(cell: { Attributes?: Array<{ Value: string; Id: string }> } | undefined): string | null {
  if (!cell?.Attributes) return null
  const codeAttr = cell.Attributes.find(a => a.Id === 'account' || a.Id === 'accountID')
  return codeAttr?.Value ?? null
}

interface ExtractedExpense {
  accountName: string
  accountCode: string | null
  amount: number
  section: 'cost_of_sales' | 'expense' | 'other'
}

interface ExtractedSnapshot {
  revenue: number
  costOfSales: number
  expenses: number
  grossProfit: number
  netProfit: number
  lineItems: ExtractedExpense[]
}

function parseSection(section: XeroRow, classification: ExtractedExpense['section']): ExtractedExpense[] {
  const out: ExtractedExpense[] = []
  for (const row of section.Rows ?? []) {
    if (row.RowType === 'Row' && row.Cells && row.Cells.length >= 2) {
      const name = row.Cells[0]?.Value ?? 'Unknown'
      const amount = toNumber(row.Cells[1]?.Value)
      if (amount === 0) continue
      out.push({
        accountName: name,
        accountCode: extractAccountCodeFromCell(row.Cells[0]),
        amount,
        section: classification,
      })
    }
  }
  return out
}

function findSummaryValue(section: XeroRow): number {
  // Xero sections end with a SummaryRow containing the total
  const summary = (section.Rows ?? []).find(r => r.RowType === 'SummaryRow')
  if (summary?.Cells?.[1]) return toNumber(summary.Cells[1].Value)
  // Fallback: sum the row values
  return (section.Rows ?? [])
    .filter(r => r.RowType === 'Row')
    .reduce((s, r) => s + toNumber(r.Cells?.[1]?.Value), 0)
}

function parsePnl(report: XeroPnlReport['Reports'][number]): ExtractedSnapshot {
  const lineItems: ExtractedExpense[] = []
  let revenue = 0
  let costOfSales = 0
  let expenses = 0
  let grossProfit = 0
  let netProfit = 0

  for (const row of report.Rows) {
    if (row.RowType !== 'Section') continue
    const title = (row.Title ?? '').toLowerCase()

    if (title.includes('income') || title.includes('revenue') || title.includes('trading income')) {
      revenue += findSummaryValue(row)
    } else if (title.includes('cost of sales') || title.includes('cogs')) {
      costOfSales += findSummaryValue(row)
      lineItems.push(...parseSection(row, 'cost_of_sales'))
    } else if (title.includes('operating expense') || title.includes('expense')) {
      expenses += findSummaryValue(row)
      lineItems.push(...parseSection(row, 'expense'))
    } else if (title.includes('gross profit')) {
      // Some reports have gross profit as its own section
      const summary = (row.Rows ?? []).find(r => r.RowType === 'Row')
      if (summary?.Cells?.[1]) grossProfit = toNumber(summary.Cells[1].Value)
    } else if (title.includes('net profit') || title.includes('net income')) {
      const summary = (row.Rows ?? []).find(r => r.RowType === 'Row')
      if (summary?.Cells?.[1]) netProfit = toNumber(summary.Cells[1].Value)
    }
  }

  if (grossProfit === 0) grossProfit = revenue - costOfSales
  if (netProfit === 0) netProfit = grossProfit - expenses

  return { revenue, costOfSales, expenses, grossProfit, netProfit, lineItems }
}

function monthBounds(year: number, monthIndex: number): { start: string; end: string; monthKey: string } {
  const start = new Date(Date.UTC(year, monthIndex, 1))
  const end = new Date(Date.UTC(year, monthIndex + 1, 0)) // last day of month
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    monthKey: start.toISOString().slice(0, 7),
  }
}

/**
 * POST /api/admin/integrations/xero/sync-pnl
 *
 * Pulls one Xero P&L report per month for the last N months (default 12)
 * and upserts snapshots + line items. Also computes a simple "recurring"
 * flag for any line item that shows up in at least 3 of the last 4 months.
 *
 * Body: { months?: number }  (default 12)
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { months?: number }
  const months = Math.max(1, Math.min(24, body.months ?? 12))

  const drizzle = (await db()) as D1
  const now = new Date()
  const syncedAt = now.toISOString()

  const results: Array<{ monthKey: string; status: 'synced' | 'error'; error?: string; lineCount?: number }> = []

  // Iterate months from oldest to newest so line_items sync in order
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const { start, end, monthKey } = monthBounds(d.getUTCFullYear(), d.getUTCMonth())

    try {
      const report = await callXeroAPIOrThrow<XeroPnlReport>(
        'GET',
        `/Reports/ProfitAndLoss?fromDate=${start}&toDate=${end}&standardLayout=true`,
      )
      const first = report?.Reports?.[0]
      if (!first) {
        results.push({ monthKey, status: 'error', error: 'No report returned' })
        continue
      }

      const snapshot = parsePnl(first)

      // Upsert snapshot (primary key on monthKey)
      await drizzle
        .insert(schema.xeroPnlSnapshots)
        .values({
          monthKey,
          periodStart: start,
          periodEnd: end,
          totalRevenue: snapshot.revenue,
          totalCostOfSales: snapshot.costOfSales,
          totalExpenses: snapshot.expenses,
          grossProfit: snapshot.grossProfit,
          netProfit: snapshot.netProfit,
          rawJson: JSON.stringify(first).slice(0, 60000),
          syncedAt,
        })
        .onConflictDoUpdate({
          target: schema.xeroPnlSnapshots.monthKey,
          set: {
            periodStart: start,
            periodEnd: end,
            totalRevenue: snapshot.revenue,
            totalCostOfSales: snapshot.costOfSales,
            totalExpenses: snapshot.expenses,
            grossProfit: snapshot.grossProfit,
            netProfit: snapshot.netProfit,
            rawJson: JSON.stringify(first).slice(0, 60000),
            syncedAt,
          },
        })

      // Replace the month's line items
      await drizzle
        .delete(schema.xeroExpenseCategories)
        .where(eq(schema.xeroExpenseCategories.monthKey, monthKey))

      for (const li of snapshot.lineItems) {
        await drizzle.insert(schema.xeroExpenseCategories).values({
          id: crypto.randomUUID(),
          monthKey,
          accountCode: li.accountCode,
          accountName: li.accountName,
          section: li.section,
          amount: li.amount,
          currency: 'NZD',  // TODO pull from org settings when multi-currency
          isRecurring: false,
          syncedAt,
        })
      }

      results.push({ monthKey, status: 'synced', lineCount: snapshot.lineItems.length })
    } catch (err) {
      const msg = err instanceof XeroAPIError
        ? `Xero ${err.status}: ${err.responseBody?.slice(0, 200) ?? err.message}`
        : err instanceof Error ? err.message : 'Unknown error'
      results.push({ monthKey, status: 'error', error: msg })
    }
  }

  // Compute recurring flag: an account_name is "recurring" if it appears
  // in ≥3 of the last 4 months with amount > 0.
  try {
    const fourMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1))
      .toISOString().slice(0, 7)

    const recurringRows = await drizzle.all<{ account_name: string }>(sql`
      SELECT account_name
      FROM xero_expense_categories
      WHERE month_key >= ${fourMonthsAgo}
        AND amount > 0
      GROUP BY account_name
      HAVING COUNT(DISTINCT month_key) >= 3
    `)

    const recurringNames = new Set((recurringRows ?? []).map(r => r.account_name))

    // Reset all recurring flags then set the recurring ones
    await drizzle
      .update(schema.xeroExpenseCategories)
      .set({ isRecurring: false })
      .where(gte(schema.xeroExpenseCategories.monthKey, fourMonthsAgo))

    for (const name of recurringNames) {
      await drizzle
        .update(schema.xeroExpenseCategories)
        .set({ isRecurring: true })
        .where(sql`account_name = ${name} AND month_key >= ${fourMonthsAgo}`)
    }
  } catch (err) {
    console.error('[sync-pnl] recurring flag computation failed:', err)
  }

  return NextResponse.json({
    synced: results.filter(r => r.status === 'synced').length,
    failed: results.filter(r => r.status === 'error').length,
    results,
  })
}
