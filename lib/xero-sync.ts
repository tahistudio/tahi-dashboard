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
import {
  mapXeroInvoiceStatus,
  mapXeroInvoiceStatusForKnownRow,
  resolveXeroStatusWrite,
  normaliseXeroDate,
} from '@/lib/xero-status'
import {
  captureOnlineInvoiceUrls,
  needsOnlineInvoiceUrl,
  shouldClearOnlineInvoiceUrl,
  type OnlineInvoiceCandidate,
} from '@/lib/xero-online-invoice'

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
  /**
   * Set when the sync finished and wrote what it could, but did NOT see
   * everything Xero holds: a page was lost mid-walk (callXeroAPI swallows a
   * 429 or a 5xx into a null) or the page ceiling was hit. Every local row
   * past the gap reports 'not_found_in_xero' and silently goes unreconciled,
   * so the orchestrator marks the step not-ok and cron_runs shows it rather
   * than logging a clean 'success' over a half-read ledger.
   */
  warning?: string
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
// Paging
// ---------------------------------------------------------------------------

/** Xero returns at most 100 invoices per page on the /Invoices list endpoint. */
export const XERO_PAGE_SIZE = 100

/**
 * Hard ceiling on how many pages one sync will walk. 50 pages is 5,000
 * invoices, well past anything Tahi's ledger will hold for years, and it stops
 * a Xero-side paging bug from turning a nightly cron into an unbounded loop.
 */
export const XERO_MAX_PAGES = 50

export interface XeroPageWalk<T> {
  /** Every row read, in page order. */
  rows: T[]
  /** How many pages were actually fetched (the log the summary reports). */
  pagesRead: number
  /** True when the ceiling was hit before a short page: there is more in Xero. */
  truncated: boolean
  /** True when a page came back empty-handed (Xero error), so rows are partial. */
  failed: boolean
}

/**
 * Walk Xero's `page` parameter until a short page, a failure, or the ceiling.
 *
 * `readPage` returns the rows for a 1-based page, or null when the call
 * failed. A page shorter than `pageSize` is Xero's end-of-list signal, so the
 * walk stops there; a full page means there is probably another one.
 *
 * The reader is injected rather than called inline so the walk itself is unit
 * testable against a fake client, with no fetch and no token.
 */
export async function walkXeroPages<T>(
  readPage: (page: number) => Promise<T[] | null>,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<XeroPageWalk<T>> {
  const pageSize = opts.pageSize ?? XERO_PAGE_SIZE
  const maxPages = opts.maxPages ?? XERO_MAX_PAGES

  const rows: T[] = []
  let pagesRead = 0
  let truncated = false
  let failed = false

  for (let page = 1; page <= maxPages; page++) {
    const batch = await readPage(page)
    if (batch === null) {
      failed = true
      break
    }
    pagesRead++
    rows.push(...batch)
    if (batch.length < pageSize) return { rows, pagesRead, truncated, failed }
    if (page === maxPages) truncated = true
  }

  return { rows, pagesRead, truncated, failed }
}

/**
 * A one-line description of an incomplete walk, or undefined when the walk saw
 * everything. Becomes SyncOutcome.warning, which the orchestrator turns into a
 * not-ok step so a half-read ledger is visible in cron_runs instead of logging
 * a clean 'success' while every row past the gap silently goes unreconciled.
 */
export function walkWarning(walk: XeroPageWalk<unknown>): string | undefined {
  if (walk.failed) {
    return `Partial Xero read: a page failed after ${walk.pagesRead} page(s), so invoices past that point were not reconciled`
  }
  if (walk.truncated) {
    return `Partial Xero read: stopped at the ${XERO_MAX_PAGES} page ceiling, so invoices past ${XERO_MAX_PAGES * XERO_PAGE_SIZE} were not reconciled`
  }
  return undefined
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
  AmountDue?: number
  FullyPaidOnDate?: string
  UpdatedDateUTC: string
  HasAttachments: boolean
}

interface XeroPaymentInvoicesResponse {
  Invoices: XeroPaymentInvoice[]
}

/**
 * Sync payment statuses from Xero back to local invoices that were pushed to
 * or imported from Xero (matched by xeroInvoiceId).
 *
 * Reads EVERY page of Xero's ACCREC list, not just the first: before IC.5 the
 * call carried no `page` parameter at all, so every local invoice past Xero's
 * first 100 reported 'not_found_in_xero' forever. Status comes from the one
 * shared mapper in lib/xero-status.ts, and paidAt comes from Xero's
 * FullyPaidOnDate rather than "now", so a payment that landed last month stops
 * reporting as this month's revenue.
 *
 * The write is forward-only (see NEVER_OVERWRITTEN_BY in lib/xero-status.ts):
 * a dashboard-raised invoice sits at Xero DRAFT forever because the push route
 * never approves it, so trusting Xero backwards would walk a sent or paid
 * invoice back to 'draft' every night and hide it from the client portal.
 * A row nothing would change is left alone entirely, so a quiet night does not
 * bump updated_at on every invoice and report it as work done.
 *
 * Only touches rows whose `source` is 'xero'. A Stripe-billed invoice that
 * happens to carry a xeroInvoiceId belongs to the Stripe rail.
 *
 * Also captures Xero's own pay link. Any row Xero has issued (mapped 'sent' or
 * 'paid', and not still awaiting approval) that has no xero_online_invoice_url
 * yet gets one extra GET, capped per run, and the outcome is reported as
 * `payLinks` in the body. A failure there leaves the column NULL and does not
 * affect the sync's result. The reverse is handled here too: a row whose Xero
 * counterpart has gone back to DRAFT or been voided loses the stored link with
 * its status, so the client is never shown a URL Xero has revoked. See
 * lib/xero-online-invoice.ts for why the reader, not the push, has to do it.
 */
export async function syncXeroPayments(database: D1): Promise<SyncOutcome> {
  try {
    const syncedInvoices = await database
      .select({
        id: schema.invoices.id,
        xeroInvoiceId: schema.invoices.xeroInvoiceId,
        status: schema.invoices.status,
        source: schema.invoices.source,
        paidAt: schema.invoices.paidAt,
        sentAt: schema.invoices.sentAt,
        // Whether this row still needs Xero's own pay link captured. Xero only
        // issues one once the invoice is AUTHORISED, which happens by hand in
        // Xero long after the push, so the sync is the only thing that can see
        // it appear. See lib/xero-online-invoice.ts.
        xeroOnlineInvoiceUrl: schema.invoices.xeroOnlineInvoiceUrl,
      })
      .from(schema.invoices)
      .where(isNotNull(schema.invoices.xeroInvoiceId))

    if (syncedInvoices.length === 0) {
      return { ok: true, status: 200, body: { success: true, synced: 0, updated: 0, pagesRead: 0, truncated: false, partial: false, results: [] }, count: 0 }
    }

    const walk = await walkXeroPages<XeroPaymentInvoice>(async (page) => {
      const res = await callXeroAPI<XeroPaymentInvoicesResponse>(
        'GET',
        `/Invoices?where=Type%3D%3D%22ACCREC%22&page=${page}`,
      )
      return res?.Invoices ?? null
    })

    if (walk.pagesRead === 0) {
      return { ok: false, status: 500, body: { error: 'Failed to fetch invoices from Xero' }, error: 'Failed to fetch invoices from Xero' }
    }

    const xeroInvoiceMap = new Map(
      walk.rows.map((inv) => [inv.InvoiceID, inv]),
    )

    const results: Array<Record<string, unknown>> = []
    const payLinkCandidates: OnlineInvoiceCandidate[] = []
    let updated = 0
    const now = new Date().toISOString()

    for (const localInvoice of syncedInvoices) {
      if (localInvoice.source !== 'xero') {
        results.push({ invoiceId: localInvoice.id, status: 'skipped_not_xero_source', source: localInvoice.source })
        continue
      }

      const xeroInvoice = xeroInvoiceMap.get(localInvoice.xeroInvoiceId ?? '')

      if (!xeroInvoice) {
        results.push({ invoiceId: localInvoice.id, status: 'not_found_in_xero' })
        continue
      }

      const mapped = mapXeroInvoiceStatusForKnownRow(
        xeroInvoice.Status,
        xeroInvoice.AmountDue,
        xeroInvoice.FullyPaidOnDate,
      )
      const write: Record<string, unknown> = {
        ...resolveXeroStatusWrite(localInvoice, mapped, xeroInvoice.FullyPaidOnDate, now),
      }

      // Queue the pay link BEFORE the no-change bail-out. The common case is
      // exactly a row Xero agrees with (local 'sent', Xero AUTHORISED) that
      // has simply never been asked for its OnlineInvoiceUrl, and skipping it
      // with the status write would mean the link was never captured at all.
      if (
        localInvoice.xeroInvoiceId
        && needsOnlineInvoiceUrl(mapped, localInvoice.xeroOnlineInvoiceUrl, xeroInvoice.Status)
      ) {
        payLinkCandidates.push({ id: localInvoice.id, xeroInvoiceId: localInvoice.xeroInvoiceId })
      }

      // The other direction: Xero has taken the bill back out of AUTHORISED /
      // PAID, so the link we hold is dead. Cleared here, with the status, or
      // the client-facing surface hands someone a URL that 404s or shows a
      // voided invoice.
      if (shouldClearOnlineInvoiceUrl(mapped, localInvoice.xeroOnlineInvoiceUrl)) {
        write.xeroOnlineInvoiceUrl = null
      }

      // Nothing Xero says would change this row: no status move it is allowed
      // to make, no better paid date, no missing sent date, no dead link to
      // clear. Do not bump updated_at for it, and do not report work that did
      // not happen.
      if (Object.keys(write).length === 0) {
        results.push({
          invoiceId: localInvoice.id,
          xeroInvoiceId: localInvoice.xeroInvoiceId,
          status: 'no_change',
          xeroStatus: xeroInvoice.Status,
        })
        continue
      }

      await database
        .update(schema.invoices)
        .set({ ...write, updatedAt: now })
        .where(eq(schema.invoices.id, localInvoice.id))

      updated++

      results.push({
        invoiceId: localInvoice.id,
        xeroInvoiceId: localInvoice.xeroInvoiceId,
        previousStatus: localInvoice.status,
        newStatus: write.status ?? localInvoice.status,
      })
    }

    // Xero's own pay link for the invoices that now have one. Capped per run
    // and never fatal: a failure leaves the column NULL and the next run
    // tries again.
    const payLinks = await captureOnlineInvoiceUrls(database, payLinkCandidates, now)

    const warning = walkWarning(walk)
    const body = {
      success: true,
      synced: syncedInvoices.length,
      updated,
      pagesRead: walk.pagesRead,
      truncated: walk.truncated,
      partial: walk.failed,
      payLinks,
      results,
    }
    return { ok: true, status: 200, body, count: updated, warning }
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

/**
 * Import a page of ACCREC invoices from Xero, matching or auto-creating the
 * owning org, and creating local invoice + line-item rows.
 *
 * A row already known by xeroInvoiceId is UPDATED rather than skipped (that
 * skip is why a Xero invoice imported while it was a DRAFT stayed local
 * 'draft' forever, and the portal hides drafts from the client): status,
 * subtotal, total, currency, due date, sent date and paid date are all re-read
 * from Xero. Rows whose `source` is not 'xero' are never touched, whatever id
 * they carry.
 *
 * Two things the update deliberately will not do. It only moves a row FORWARD
 * (see NEVER_OVERWRITTEN_BY in lib/xero-status.ts), because a dashboard-raised
 * invoice sits at Xero DRAFT forever and a backwards write would hide a paid
 * invoice from the client portal every night. And it is a DIFF, so an
 * unchanged invoice produces no UPDATE at all, no updated_at bump, and no
 * inflated `updated` count on a run that did nothing.
 *
 * AmountDue has no column of its own, so it only feeds the status decision
 * (a zero balance on an AUTHORISED invoice with a paid date reads as paid).
 *
 * Captures Xero's own pay link on the same pass, for both the rows it updates
 * and the rows it creates, whenever Xero has issued one and the column is
 * still empty, and CLEARS a stored link when Xero has taken the bill back out
 * of AUTHORISED / PAID. Capped per run, reported as `payLinks`, never fatal.
 * See lib/xero-online-invoice.ts.
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

    // Every column the known-row branch either compares against or writes: the
    // update is built as a DIFF, so a nightly run over an unchanged ledger
    // writes nothing at all rather than rewriting 100 rows and bumping their
    // updated_at (which made `updated` and the cron's count stop meaning
    // "something changed").
    const existing = await database
      .select({
        id: schema.invoices.id,
        xeroInvoiceId: schema.invoices.xeroInvoiceId,
        status: schema.invoices.status,
        source: schema.invoices.source,
        amountUsd: schema.invoices.amountUsd,
        totalUsd: schema.invoices.totalUsd,
        currency: schema.invoices.currency,
        dueDate: schema.invoices.dueDate,
        paidAt: schema.invoices.paidAt,
        sentAt: schema.invoices.sentAt,
        // Not a diffed column: it is written once, by the pay-link capture
        // below, and read here only to know whether to ask Xero for it.
        xeroOnlineInvoiceUrl: schema.invoices.xeroOnlineInvoiceUrl,
      })
      .from(schema.invoices)
      .where(sql`${schema.invoices.xeroInvoiceId} IS NOT NULL`)

    const existingByXeroId = new Map(
      existing.filter(e => e.xeroInvoiceId).map(e => [e.xeroInvoiceId as string, e]),
    )

    const allOrgs = await database
      .select({ id: schema.organisations.id, name: schema.organisations.name, xeroContactId: schema.organisations.xeroContactId })
      .from(schema.organisations)

    const now = new Date().toISOString()
    let imported = 0
    let updated = 0
    let skipped = 0
    let unchanged = 0
    const results: Array<{ invoiceNumber: string; status: string; orgMatch?: string }> = []
    const payLinkCandidates: OnlineInvoiceCandidate[] = []

    for (const inv of data.Invoices) {
      const known = existingByXeroId.get(inv.InvoiceID)

      if (known) {
        // Never reach into another rail's row, whatever id it is carrying.
        if (known.source !== 'xero') {
          skipped++
          results.push({ invoiceNumber: inv.InvoiceNumber, status: 'skipped_not_xero_source' })
          continue
        }

        const mapped = mapXeroInvoiceStatusForKnownRow(inv.Status, inv.AmountDue, inv.FullyPaidOnDate)

        // Queued before the no-change bail-out below, for the same reason as
        // in syncXeroPayments: the row whose status already agrees with Xero
        // is precisely the one that has been sitting there without a pay link.
        if (needsOnlineInvoiceUrl(mapped, known.xeroOnlineInvoiceUrl, inv.Status)) {
          payLinkCandidates.push({ id: known.id, xeroInvoiceId: inv.InvoiceID })
        }

        const updates: Record<string, unknown> = {
          ...resolveXeroStatusWrite(known, mapped, inv.FullyPaidOnDate, now),
        }

        // A link Xero no longer serves (voided, deleted, or demoted back to
        // DRAFT) has to go with the status, or the client keeps a dead URL.
        if (shouldClearOnlineInvoiceUrl(mapped, known.xeroOnlineInvoiceUrl)) {
          updates.xeroOnlineInvoiceUrl = null
        }

        // Money columns: only what actually differs, so an unchanged invoice
        // produces an empty patch and no write at all.
        if (typeof inv.SubTotal === 'number' && inv.SubTotal !== known.amountUsd) updates.amountUsd = inv.SubTotal
        if (typeof inv.Total === 'number' && inv.Total !== known.totalUsd) updates.totalUsd = inv.Total
        if (inv.CurrencyCode && inv.CurrencyCode !== known.currency) updates.currency = inv.CurrencyCode
        // Only when Xero actually supplies one. A DRAFT often carries no due
        // date, and writing that through would null a date the dashboard set.
        if (inv.DueDateString) {
          const dueDate = inv.DueDateString.split('T')[0]
          if (dueDate !== known.dueDate) updates.dueDate = dueDate
        }

        if (Object.keys(updates).length === 0) {
          unchanged++
          results.push({ invoiceNumber: inv.InvoiceNumber, status: 'no_change' })
          continue
        }

        try {
          await database
            .update(schema.invoices)
            .set({ ...updates, updatedAt: now })
            .where(eq(schema.invoices.id, known.id))
          updated++
          results.push({ invoiceNumber: inv.InvoiceNumber, status: 'updated' })
        } catch (updateErr) {
          results.push({
            invoiceNumber: inv.InvoiceNumber,
            status: 'error',
            orgMatch: updateErr instanceof Error ? updateErr.message : 'Update failed',
          })
        }
        continue
      }

      const localStatus = mapXeroInvoiceStatus(inv.Status, inv.AmountDue, inv.FullyPaidOnDate)

      // DELETED (and anything unrecognised) has no dashboard status, so there
      // is nothing honest to create. On a row we already hold it is handled
      // above, where DELETED reads as a write-off rather than as silence.
      if (!localStatus) {
        skipped++
        results.push({ invoiceNumber: inv.InvoiceNumber, status: 'skipped_no_local_status' })
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
          paidAt: localStatus === 'paid' ? (normaliseXeroDate(inv.FullyPaidOnDate) ?? now) : null,
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
        // A row imported already-approved has a pay link waiting for it right
        // now; making it wait for the next run would leave the client with
        // nothing to click for an hour for no reason.
        if (needsOnlineInvoiceUrl(localStatus, null, inv.Status)) {
          payLinkCandidates.push({ id: invoiceId, xeroInvoiceId: inv.InvoiceID })
        }
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

    const payLinks = await captureOnlineInvoiceUrls(database, payLinkCandidates, now)

    const body = {
      success: true,
      imported,
      updated,
      unchanged,
      skipped,
      total: data.Invoices.length,
      page,
      hasMore: data.Invoices.length >= XERO_PAGE_SIZE,
      payLinks,
      results,
    }
    return { ok: true, status: 200, body, count: imported + updated }
  } catch (err) {
    console.error('Xero import error:', err)
    return { ok: false, status: 500, body: { error: 'Import failed', message: err instanceof Error ? err.message : 'Unknown error' }, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}
