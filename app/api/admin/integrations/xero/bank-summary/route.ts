import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { callXeroAPI } from '@/lib/xero'

interface XeroAccount {
  AccountID: string
  Name: string
  Type: string
  BankAccountNumber?: string
  BankAccountType?: string
  CurrencyCode: string
  Status: string
}

interface XeroBankSummaryReport {
  Reports: Array<{
    ReportName: string
    Rows: Array<{
      RowType: string
      Cells?: Array<{ Value: string }>
      Rows?: Array<{
        RowType: string
        Cells: Array<{ Value: string; Attributes?: Array<{ Value: string }> }>
      }>
    }>
  }>
}

// GET /api/admin/integrations/xero/bank-summary
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Fetch bank accounts
  const accountsData = await callXeroAPI<{ Accounts: XeroAccount[] }>(
    'GET',
    '/Accounts?where=Type%3D%3D%22BANK%22',
  )

  // Fetch bank summary report for balances
  const summaryData = await callXeroAPI<XeroBankSummaryReport>(
    'GET',
    '/Reports/BankSummary',
  )

  if (!accountsData && !summaryData) {
    return NextResponse.json({ error: 'Failed to fetch bank data from Xero' }, { status: 502 })
  }

  return NextResponse.json({
    accounts: accountsData?.Accounts ?? [],
    summary: summaryData?.Reports?.[0] ?? null,
  })
}
