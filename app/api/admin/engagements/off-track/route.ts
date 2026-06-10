import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { listOffTrackEngagements } from '@/lib/delivery-aggregate'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// GET /api/admin/engagements/off-track
// Enumerate client engagements (grouped by org) whose delivery rollup is
// currently off track (blocked / delayed / at_risk), worst first. Powers the
// overview "engagements off-track" widget (Slice 5).
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const drizzle = (await db()) as D1
  const engagements = await listOffTrackEngagements(drizzle, new Date().toISOString())
  return NextResponse.json({ engagements })
}
