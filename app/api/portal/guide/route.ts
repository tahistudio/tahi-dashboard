import { getPortalAuth } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { guideSectionsFor } from '@/lib/dashboard-guide'

// GET /api/portal/guide - the client-facing slice of the "how this works"
// guide (audience 'client' or 'both' only; team-only sections like the MCP
// tool list never reach this route). Optional ?key=<section key> returns
// just one section, still filtered to the client audience.
export async function GET(req: NextRequest) {
  const { userId, orgId } = await getPortalAuth(req)
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const sections = guideSectionsFor('client')

  const url = new URL(req.url)
  const key = url.searchParams.get('key')
  if (key) {
    const section = sections.find(s => s.key === key)
    if (!section) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ section })
  }

  return NextResponse.json({ sections })
}
