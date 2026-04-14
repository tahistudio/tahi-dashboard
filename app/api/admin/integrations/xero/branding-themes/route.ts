import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { callXeroAPI } from '@/lib/xero'

interface XeroBrandingTheme {
  BrandingThemeID: string
  Name: string
  SortOrder: number
  CreatedDateUTC: string
}

// GET /api/admin/integrations/xero/branding-themes
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const data = await callXeroAPI<{ BrandingThemes: XeroBrandingTheme[] }>('GET', '/BrandingThemes')
  if (!data?.BrandingThemes) {
    return NextResponse.json({ error: 'Failed to fetch branding themes from Xero' }, { status: 502 })
  }

  return NextResponse.json({ themes: data.BrandingThemes })
}
