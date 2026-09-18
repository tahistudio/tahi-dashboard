import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { GUIDE_SECTIONS, guideSectionsFor } from '@/lib/dashboard-guide'

// GET /api/admin/guide - the full "how this works" guide, every section.
// Optional ?key=<section key> returns just one section.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const key = url.searchParams.get('key')
  if (key) {
    const section = GUIDE_SECTIONS.find(s => s.key === key)
    if (!section) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ section })
  }

  return NextResponse.json({ sections: guideSectionsFor('team') })
}
