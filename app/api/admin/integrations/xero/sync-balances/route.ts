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

    // Parse BankSummary rows. Format varies between tenants — some include
    // AccountID as a cell attribute, some don't. We use multiple fallbacks:
    //   1. nameCell.Attributes[Id in {account,accountID,AccountID}]
    //   2. Match nameCell.Value to a known bank account by exact Name
    //   3. Match nameCell.Value to a known bank account by case-insensitive
    //      contains (e.g. "Westpac Business" matches "Westpac Business")
    const results: Array<{ accountId: string; name: string; balance: number; currency: string; matchMethod: string }> = []
    const skipped: Array<{ name: string; reason: string }> = []
    const accountByNameLower = new Map(bankAccounts.map(a => [a.Name.toLowerCase(), a]))

    function resolveAccountId(nameCell: { Value: string; Attributes?: Array<{ Value: string; Id: string }> }): { accountId: string; method: string } | null {
      // 1. Attribute lookup
      const attr = nameCell.Attributes?.find(a => ['account', 'accountID', 'AccountID', 'accountId'].includes(a.Id))
      if (attr?.Value && accountById.has(attr.Value)) {
        return { accountId: attr.Value, method: 'attribute' }
      }
      // 2. Exact name match
      const name = (nameCell.Value ?? '').trim()
      if (!name) return null
      const exact = bankAccounts.find(a => a.Name === name)
      if (exact) return { accountId: exact.AccountID, method: 'exact-name' }
      // 3. Case-insensitive contains
      const lower = name.toLowerCase()
      const containsMatch = bankAccounts.find(a => a.Name.toLowerCase().includes(lower) || lower.includes(a.Name.toLowerCase()))
      if (containsMatch) return { accountId: containsMatch.AccountID, method: 'name-contains' }
      // 4. Map lookup as last resort
      const byNameLower = accountByNameLower.get(lower)
      if (byNameLower) return { accountId: byNameLower.AccountID, method: 'name-lower' }
      return null
    }

    for (const topRow of report.Rows) {
      if (topRow.RowType !== 'Section') continue
      for (const row of topRow.Rows ?? []) {
        if (row.RowType !== 'Row' || !row.Cells) continue
        const nameCell = row.Cells[0]
        const closingCell = row.Cells[row.Cells.length - 1]
        if (!nameCell || !closingCell) continue

        const resolved = resolveAccountId(nameCell)
        if (!resolved) {
          skipped.push({ name: nameCell.Value, reason: 'could not resolve AccountID' })
          continue
        }

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

    // If we found bank accounts but matched zero rows, the report shape is unexpected.
    // Fall back: write the live /Accounts balances directly. Some Xero accounts include
    // a real-time `Balance` field on the Account object, though it isn't always populated.
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

    return NextResponse.json({
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
    })
  } catch (err) {
    const msg = err instanceof XeroAPIError
      ? `Xero ${err.status}: ${err.responseBody?.slice(0, 200) ?? err.message}`
      : err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
