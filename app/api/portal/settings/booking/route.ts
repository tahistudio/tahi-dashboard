import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// GET /api/portal/settings/booking
// Returns the Google Calendar booking URL configured by admin.
export async function GET(req: NextRequest) {
  const { userId } = await getRequestAuth(req)
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const database = await db()

  const rows = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'booking.google_cal_url'))
    .limit(1)

  const url = rows.length > 0 ? rows[0].value : null

  return NextResponse.json({ url })
}
