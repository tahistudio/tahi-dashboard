import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { callXeroAPIOrThrow, XeroAPIError } from '@/lib/xero'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

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
 * POST /api/admin/integrations/xero/sync-balances
 *
 * Pulls current bank account balances from Xero and upserts into
 * xero_bank_balances (keyed by Xero AccountID, overwritten each sync).
 *
 * The BankSummary report's first section is the closing balances per
 * bank account. We join to the /Accounts endpoint to enrich with
 * currency code (BankSummary doesn't reliably include it).
 */
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const drizzle = (await db()) as D1

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
      return NextResponse.json({ error: 'BankSummary returned no report' }, { status: 502 })
    }

    const asOf = report.ReportDate ?? new Date().toISOString().slice(0, 10)
    const now = new Date().toISOString()

    // The BankSummary report has a Section row containing bank account rows.
    // Each bank account row: Cells = [Name, OpeningBal, Incoming, Outgoing, ClosingBal]
    // The first cell's Attributes contain the AccountID.
    const results: Array<{ accountId: string; name: string; balance: number; currency: string }> = []

    for (const topRow of report.Rows) {
      if (topRow.RowType !== 'Section') continue
      for (const row of topRow.Rows ?? []) {
        if (row.RowType !== 'Row' || !row.Cells) continue
        const nameCell = row.Cells[0]
        const closingCell = row.Cells[row.Cells.length - 1]
        if (!nameCell || !closingCell) continue

        const accountIdAttr = nameCell.Attributes?.find(a => a.Id === 'account' || a.Id === 'accountID')
        const accountId = accountIdAttr?.Value
        if (!accountId) continue

        const balance = parseFloat((closingCell.Value ?? '0').replace(/,/g, ''))
        if (!Number.isFinite(balance)) continue

        const account = accountById.get(accountId)
        const currency = account?.CurrencyCode ?? 'NZD'

        await drizzle
          .insert(schema.xeroBankBalances)
          .values({
            accountId,
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

        results.push({ accountId, name: nameCell.Value, balance, currency })
      }
    }

    return NextResponse.json({
      synced: results.length,
      asOf,
      balances: results,
    })
  } catch (err) {
    const msg = err instanceof XeroAPIError
      ? `Xero ${err.status}: ${err.responseBody?.slice(0, 200) ?? err.message}`
      : err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
