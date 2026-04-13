import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { callXeroAPI } from '@/lib/xero'

// GET /api/admin/integrations/xero/profit-loss
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(req.url)
  const fromDate = url.searchParams.get('fromDate') ?? ''
  const toDate = url.searchParams.get('toDate') ?? ''
  const periods = url.searchParams.get('periods') ?? '1'
  const timeframe = url.searchParams.get('timeframe') ?? 'MONTH'

  let endpoint = '/Reports/ProfitAndLoss?'
  if (fromDate) endpoint += `fromDate=${fromDate}&`
  if (toDate) endpoint += `toDate=${toDate}&`
  endpoint += `periods=${periods}&timeframe=${timeframe}`

  const data = await callXeroAPI<Record<string, unknown>>('GET', endpoint)
  if (!data) return NextResponse.json({ error: 'Failed to fetch P&L from Xero' }, { status: 502 })

  return NextResponse.json(data)
}
