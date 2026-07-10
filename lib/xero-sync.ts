/**
 * lib/xero-sync.ts
 *
 * Shared, reusable core for the four Xero finance syncs. Extracted verbatim
 * from the per-integration route handlers so BOTH the standalone routes
 * (POST /api/admin/integrations/xero/{sync-balances,sync-payments,sync-pnl,
 * import-invoices}) and the daily orchestrator cron
 * (POST /api/admin/cron/sync-xero) call the same logic without an internal
 * HTTP self-call.
 *
 * Every function returns a SyncOutcome instead of a NextResponse so the
 * caller decides how to surface it: the standalone route serialises
 * `body` at `status`; the orchestrator reads `ok` / `error` / `count` to
 * build a per-step report. Each function catches its own errors so one
 * failing sync never throws into the orchestrator and stops the others.
 */

import { schema } from '@/db/d1'
import { eq, sql, gte, isNotNull } from 'drizzle-orm'
import { callXeroAPI, callXeroAPIOrThrow, XeroAPIError } from '@/lib/xero'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Uniform result of a single sync. `body` is the exact JSON a standalone
 * route returns; `status` is the HTTP status it returns at; `error` is a
 * short human message for step reporting (only on failure); `count` is the
 * primary metric for step reporting (only on success).
 */
export interface SyncOutcome {
  ok: boolean
  status: number
  body: Record<string, unknown>
  error?: string
  count?: number
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

interface XeroAccount {
  AccountID: string
  Name: string
  Type: string
  CurrencyCode?: string
  Status: string
}

interface XeroBankSummaryReport {
  Reports: Array<{
    ReportDate?: string
    Rows: Array<{
      RowType: string
      Cells?: Array<{ Value: string }>
      Rows?: Array<{
        RowType: string
        Cells: Array<{ Value: string; Attributes?: Array<{ Value: string; Id: string }> }>
      }>
    }>
  }>
}

/**
 * Pull current bank account balances from Xero and upsert into
 * xero_bank_balances (keyed by Xero AccountID, overwritten each sync).
 */
export async function syncXeroBalances(drizzle: D1): Promise<SyncOutcome> {
  try {
    // 1. Fetch all bank accounts
    const accountsData = await callXeroAPIOrThrow<{ Accounts: XeroAccount[] }>(
      'GET',
      '/Accounts?where=Type%3D%3D%22BANK%22',
    )
    const bankAccounts = (accountsData?.Accounts ?? []).filter(a => a.Status === 'ACTIVE')
    const accountById = new Map(bankAccounts.map(a => [a.AccountID, a]))

    // 2. Fetch BankSummary report for closing balances
    const summaryData = await callXeroAPIOrThrow<XeroBankSummaryReport>(
      'GET',
      '/Reports/BankSummary',
    )

    const report = summaryData?.Reports?.[0]
    if (!report) {
      return { ok: false, status: 502, body: { error: 'BankSummary returned no report' }, error: 'BankSummary returned no report' }
    }

    const asOf = report.ReportDate ?? new Date().toISOString().slice(0, 10)
    const now = new Date().toISOString()

    const results: Array<{ accountId: string; name: string; balance: number; currency: string; matchMethod: string }> = []
    const skipped: Array<{ name: string; reason: string }> = []
    const accountByNameLower = new Map(bankAccounts.map(a => [a.Name.toLowerCase(), a]))

    function syntheticId(name: string): string {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      return `synthetic-${slug || 'unknown'}`
    }

    function resolveAccountId(nameCell: { Value: string; Attributes?: Array<{ Value: string; Id: string }> }): { accountId: string; method: string } {
      const attr = nameCell.Attributes?.find(a => ['account', 'accountID', 'AccountID', 'accountId'].includes(a.Id))
      if (attr?.Value && accountById.has(attr.Value)) {
        return { accountId: attr.Value, method: 'attribute' }
      }
      const name = (nameCell.Value ?? '').trim()
      if (name) {
        const exact = bankAccounts.find(a => a.Name === name)
        if (exact) return { accountId: exact.AccountID, method: 'exact-name' }
        const lower = name.toLowerCase()
        const containsMatch = bankAccounts.find(a => a.Name.toLowerCase().includes(lower) || lower.includes(a.Name.toLowerCase()))
        if (containsMatch) return { accountId: containsMatch.AccountID, method: 'name-contains' }
        const byNameLower = accountByNameLower.get(lower)
        if (byNameLower) return { accountId: byNameLower.AccountID, method: 'name-lower' }
      }
      return { accountId: syntheticId(name || 'unknown'), method: 'synthetic' }
    }

    for (const topRow of report.Rows) {
      if (topRow.RowType !== 'Section') continue
      for (const row of topRow.Rows ?? []) {
        if (row.RowType !== 'Row' || !row.Cells) continue
        const nameCell = row.Cells[0]
        const closingCell = row.Cells[row.Cells.length - 1]
        if (!nameCell || !closingCell) continue

        if (!(nameCell.Value ?? '').trim()) continue

        const resolved = resolveAccountId(nameCell)

        const balance = parseFloat((closingCell.Value ?? '0').replace(/,/g, ''))
        if (!Number.isFinite(balance)) {
          skipped.push({ name: nameCell.Value, reason: `non-numeric balance ${closingCell.Value}` })
          continue
        }

        const account = accountById.get(resolved.accountId)
        const currency = account?.CurrencyCode ?? 'NZD'

        await drizzle
          .insert(schema.xeroBankBalances)
          .values({
            accountId: resolved.accountId,
            accountName: nameCell.Value || account?.Name || 'Unknown',
            currency,
            balance,
            asOf,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: schema.xeroBankBalances.accountId,
            set: {
              accountName: nameCell.Value || account?.Name || 'Unknown',
              currency,
              balance,
              asOf,
              updatedAt: now,
            },
          })

        results.push({ accountId: resolved.accountId, name: nameCell.Value, balance, currency, matchMethod: resolved.method })
      }
    }

    if (results.length === 0 && bankAccounts.length > 0) {
      for (const a of bankAccounts) {
        const accWithBal = a as XeroAccount & { Balance?: number; CurrentBalance?: number }
        const balance = accWithBal.Balance ?? accWithBal.CurrentBalance
        if (typeof balance === 'number' && Number.isFinite(balance)) {
          await drizzle
            .insert(schema.xeroBankBalances)
            .values({
              accountId: a.AccountID,
              accountName: a.Name,
              currency: a.CurrencyCode ?? 'NZD',
              balance,
              asOf,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: schema.xeroBankBalances.accountId,
              set: {
                accountName: a.Name,
                currency: a.CurrencyCode ?? 'NZD',
                balance,
                asOf,
                updatedAt: now,
              },
            })
          results.push({ accountId: a.AccountID, name: a.Name, balance, currency: a.CurrencyCode ?? 'NZD', matchMethod: 'fallback-accounts-endpoint' })
        }
      }
    }

    const body = {
      synced: results.length,
      asOf,
      balances: results,
      skipped,
      diagnostics: results.length === 0 ? {
        bankAccountsFound: bankAccounts.length,
        bankAccountNames: bankAccounts.map(a => a.Name),
        reportRowCount: report.Rows.length,
        reportFirstSection: report.Rows.find(r => r.RowType === 'Section'),
      } : undefined,
    }
    return { ok: true, status: 200, body, count: results.length }
  } catch (err) {
    const msg = err instanceof XeroAPIError
      ? `Xero ${err.status}: ${err.responseBody?.slice(0, 200) ?? err.message}`
      : err instanceof Error ? err.message : 'Unknown error'
    return { ok: false, status: 502, body: { error: msg }, error: msg }
  }
}

// ---------------------------------------------------------------------------
// Payment status sync
// ---------------------------------------------------------------------------

interface XeroPaymentInvoice {
  InvoiceID: string
  InvoiceNumber: string
  Status: string
  Type: string
  Total: number
  UpdatedDateUTC: string
  HasAttachments: boolean
}

interface XeroPaymentInvoicesResponse {
  Invoices: XeroPaymentInvoice[]
}

/**
 * Sync payment statuses from Xero back to local invoices that were synced
 * to Xero (matched by xeroInvoiceId).
 */
export async function syncXeroPayments(database: D1): Promise<SyncOutcome> {
  try {
    const syncedInvoices = await database
      .select({
        id: schema.invoices.id,
        xeroInvoiceId: schema.invoices.xeroInvoiceId,
        status: schema.invoices.status,
      })
      .from(schema.invoices)
      .where(isNotNull(schema.invoices.xeroInvoiceId))

    if (syncedInvoices.length === 0) {
      return { ok: true, status: 200, body: { success: true, synced: 0, updated: 0, results: [] }, count: 0 }
    }

    const xeroRes = await callXeroAPI<XeroPaymentInvoicesResponse>(
      'GET',
      '/Invoices?ApiKey=',
    )

    if (!xeroRes?.Invoices) {
      return { ok: false, status: 500, body: { error: 'Failed to fetch invoices from Xero' }, error: 'Failed to fetch invoices from Xero' }
    }

    const xeroInvoiceMap = new Map(
      xeroRes.Invoices.map((inv) => [inv.InvoiceID, inv]),
    )

    const results: Array<Record<string, unknown>> = []
    let updated = 0
    const now = new Date().toISOString()

    for (const localInvoice of syncedInvoices) {
      const xeroInvoice = xeroInvoiceMap.get(localInvoice.xeroInvoiceId ?? '')

      if (!xeroInvoice) {
        results.push({ invoiceId: localInvoice.id, status: 'not_found_in_xero' })
        continue
      }

      let newStatus = localInvoice.status
      let paidAt: string | null = null

      if (xeroInvoice.Status === 'AUTHORISED') {
        newStatus = 'sent'
      } else if (xeroInvoice.Status === 'SUBMITTED') {
        newStatus = 'viewed'
      } else if (xeroInvoice.Status === 'PAID') {
        newStatus = 'paid'
        paidAt = now
      }

      if (newStatus !== localInvoice.status) {
        const updates: Record<string, unknown> = {
          status: newStatus,
          updatedAt: now,
        }

        if (paidAt) {
          updates.paidAt = paidAt
        }

        await database
          .update(schema.invoices)
          .set(updates)
          .where(eq(schema.invoices.id, localInvoice.id))

        updated++

        results.push({
          invoiceId: localInvoice.id,
          xeroInvoiceId: localInvoice.xeroInvoiceId,
          previousStatus: localInvoice.status,
          newStatus,
        })
      } else {
        results.push({
          invoiceId: localInvoice.id,
          xeroInvoiceId: localInvoice.xeroInvoiceId,
          status: 'no_change',
          xeroStatus: xeroInvoice.Status,
        })
      }
    }

    return { ok: true, status: 200, body: { success: true, synced: syncedInvoices.length, updated, results }, count: updated }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 500, body: { error: msg }, error: msg }
  }
}

// ---------------------------------------------------------------------------
// Profit & Loss snapshots
// ---------------------------------------------------------------------------

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
  const summary = (section.Rows ?? []).find(r => r.RowType === 'SummaryRow')
  if (summary?.Cells?.[1]) return toNumber(summary.Cells[1].Value)
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
  const end = new Date(Date.UTC(year, monthIndex + 1, 0))
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    monthKey: start.toISOString().slice(0, 7),
  }
}

/**
 * Pull one Xero P&L report per month for the last N months (clamped 1..24)
 * and upsert snapshots + line items. Recomputes the recurring flag for
 * line items appearing in >=3 of the last 4 months.
 */
export async function syncXeroPnl(drizzle: D1, months: number): Promise<SyncOutcome> {
  try {
    const clamped = Math.max(1, Math.min(24, months))
    const now = new Date()
    const syncedAt = now.toISOString()

    const results: Array<{ monthKey: string; status: 'synced' | 'error'; error?: string; lineCount?: number }> = []

    for (let i = clamped - 1; i >= 0; i--) {
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
            currency: 'NZD',
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
    // in >=3 of the last 4 months with amount > 0.
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

    const body = {
      synced: results.filter(r => r.status === 'synced').length,
      failed: results.filter(r => r.status === 'error').length,
      results,
    }
    return { ok: true, status: 200, body, count: body.synced }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 500, body: { error: msg }, error: msg }
  }
}

// ---------------------------------------------------------------------------
// Import invoices (ACCREC)
// ---------------------------------------------------------------------------

interface XeroImportInvoice {
  InvoiceID: string
  InvoiceNumber: string
  Type: string
  Status: string
  Contact: { ContactID: string; Name: string }
  DateString: string
  DueDateString: string
  SubTotal: number
  Total: number
  CurrencyCode: string
  AmountDue: number
  AmountPaid: number
  FullyPaidOnDate?: string
  LineItems?: Array<{
    Description: string
    Quantity: number
    UnitAmount: number
    LineAmount: number
    AccountCode: string
  }>
}

interface XeroImportInvoicesResponse {
  Invoices: XeroImportInvoice[]
}

function mapXeroStatus(xeroStatus: string): string {
  switch (xeroStatus) {
    case 'DRAFT': return 'draft'
    case 'SUBMITTED':
    case 'AUTHORISED': return 'sent'
    case 'PAID': return 'paid'
    case 'VOIDED':
    case 'DELETED': return 'written_off'
    default: return 'draft'
  }
}

/**
 * Import a page of ACCREC invoices from Xero, matching or auto-creating the
 * owning org, and creating local invoice + line-item rows. Idempotent:
 * invoices already present (by xeroInvoiceId) are skipped.
 */
export async function importXeroInvoices(database: D1, page: number): Promise<SyncOutcome> {
  try {
    const data = await callXeroAPI<XeroImportInvoicesResponse>(
      'GET',
      `/Invoices?where=Type%3D%3D%22ACCREC%22&order=DateString%20DESC&page=${page}&summaryOnly=false`,
    )

    if (!data?.Invoices) {
      return { ok: false, status: 502, body: { error: 'Failed to fetch invoices from Xero' }, error: 'Failed to fetch invoices from Xero' }
    }

    const existing = await database
      .select({ xeroInvoiceId: schema.invoices.xeroInvoiceId })
      .from(schema.invoices)
      .where(sql`${schema.invoices.xeroInvoiceId} IS NOT NULL`)

    const existingIds = new Set(existing.map(e => e.xeroInvoiceId))

    const allOrgs = await database
      .select({ id: schema.organisations.id, name: schema.organisations.name, xeroContactId: schema.organisations.xeroContactId })
      .from(schema.organisations)

    const now = new Date().toISOString()
    let imported = 0
    let skipped = 0
    const results: Array<{ invoiceNumber: string; status: string; orgMatch?: string }> = []

    for (const inv of data.Invoices) {
      if (existingIds.has(inv.InvoiceID)) {
        skipped++
        results.push({ invoiceNumber: inv.InvoiceNumber, status: 'already_exists' })
        continue
      }

      let matchedOrgId: string | null = null
      const xeroContactName = inv.Contact?.Name?.toLowerCase() ?? ''

      const exactMatch = allOrgs.find(o => o.xeroContactId === inv.Contact?.ContactID)
      if (exactMatch) {
        matchedOrgId = exactMatch.id
      } else {
        const nameMatch = allOrgs.find(o =>
          o.name.toLowerCase() === xeroContactName ||
          xeroContactName.includes(o.name.toLowerCase()) ||
          o.name.toLowerCase().includes(xeroContactName)
        )
        if (nameMatch) {
          matchedOrgId = nameMatch.id
          try {
            await database.update(schema.organisations).set({
              xeroContactId: inv.Contact.ContactID,
              updatedAt: now,
            }).where(eq(schema.organisations.id, nameMatch.id))
          } catch { /* column may not exist yet */ }
        }
      }

      if (!matchedOrgId && inv.Contact?.Name) {
        const newOrgId = crypto.randomUUID()
        try {
          await database.insert(schema.organisations).values({
            id: newOrgId,
            name: inv.Contact.Name,
            status: 'active',
            healthStatus: 'green',
            onboardingState: '{}',
            brands: '[]',
            customFields: '{}',
            preferredCurrency: inv.CurrencyCode ?? 'NZD',
            createdAt: now,
            updatedAt: now,
          })
          matchedOrgId = newOrgId
          allOrgs.push({ id: newOrgId, name: inv.Contact.Name, xeroContactId: inv.Contact.ContactID })
          try {
            await database.update(schema.organisations).set({
              xeroContactId: inv.Contact.ContactID,
              updatedAt: now,
            }).where(eq(schema.organisations.id, newOrgId))
          } catch { /* column may not exist */ }
        } catch {
          results.push({ invoiceNumber: inv.InvoiceNumber, status: 'error', orgMatch: 'Failed to create org' })
          continue
        }
      }

      if (!matchedOrgId) {
        results.push({ invoiceNumber: inv.InvoiceNumber, status: 'error', orgMatch: 'No Xero contact name' })
        continue
      }

      const localStatus = mapXeroStatus(inv.Status)
      const invoiceId = crypto.randomUUID()

      try {
        await database.insert(schema.invoices).values({
          id: invoiceId,
          orgId: matchedOrgId,
          xeroInvoiceId: inv.InvoiceID,
          source: 'xero',
          status: localStatus,
          amountUsd: inv.SubTotal,
          totalUsd: inv.Total,
          currency: inv.CurrencyCode ?? 'NZD',
          dueDate: inv.DueDateString?.split('T')[0] ?? null,
          paidAt: inv.FullyPaidOnDate ?? null,
          notes: `Imported from Xero: ${inv.InvoiceNumber}`,
          createdAt: inv.DateString ?? now,
          updatedAt: now,
        })

        if (inv.LineItems?.length) {
          for (const line of inv.LineItems) {
            await database.insert(schema.invoiceItems).values({
              id: crypto.randomUUID(),
              invoiceId,
              description: line.Description ?? 'Line item',
              quantity: line.Quantity ?? 1,
              unitPriceUsd: line.UnitAmount ?? 0,
              totalUsd: line.LineAmount ?? 0,
            })
          }
        }

        imported++
        results.push({
          invoiceNumber: inv.InvoiceNumber,
          status: 'imported',
          orgMatch: matchedOrgId ? allOrgs.find(o => o.id === matchedOrgId)?.name : undefined,
        })
      } catch (insertErr) {
        results.push({
          invoiceNumber: inv.InvoiceNumber,
          status: 'error',
          orgMatch: insertErr instanceof Error ? insertErr.message : 'Insert failed',
        })
      }
    }

    const body = {
      success: true,
      imported,
      skipped,
      total: data.Invoices.length,
      page,
      hasMore: data.Invoices.length >= 100,
      results,
    }
    return { ok: true, status: 200, body, count: imported }
  } catch (err) {
    console.error('Xero import error:', err)
    return { ok: false, status: 500, body: { error: 'Import failed', message: err instanceof Error ? err.message : 'Unknown error' }, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
