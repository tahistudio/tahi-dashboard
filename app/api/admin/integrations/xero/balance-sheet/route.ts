import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { callXeroAPI } from '@/lib/xero'

// GET /api/admin/integrations/xero/balance-sheet
export async function GET(req: NextRequest) {
  const { userId, orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const denied = await requireFeature({ userId, orgId }, 'settings.integrations')
  if (denied) return denied

  const url = new URL(req.url)
  const date = url.searchParams.get('date') ?? ''
  const periods = url.searchParams.get('periods') ?? '1'
  const timeframe = url.searchParams.get('timeframe') ?? 'MONTH'

  let endpoint = '/Reports/BalanceSheet?'
  if (date) endpoint += `date=${date}&`
  endpoint += `periods=${periods}&timeframe=${timeframe}`

  const data = await callXeroAPI<Record<string, unknown>>('GET', endpoint)
  if (!data) return NextResponse.json({ error: 'Failed to fetch balance sheet from Xero' }, { status: 502 })

  return NextResponse.json(data)
}
