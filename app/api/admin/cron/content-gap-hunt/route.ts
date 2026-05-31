/**
 * POST /api/admin/cron/content-gap-hunt
 *
 * Weekly content gap hunter. Surfaces 8-15 new topic ideas the
 * round-table pipeline can pick from.
 *
 * Cost: ~$0.05 per run. Schedule: Sunday 19:00 UTC.
 * Auth: TAHI_CRON_SECRET header or admin session.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { huntContentGaps } from '@/lib/content-gap-agent'
import { logCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const cronHeader = req.headers.get('x-cron-secret') ?? ''
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
  if (!hasCronAuth) {
    const { orgId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const startedAt = Date.now()
  const database = await db()
  try {
    const result = await huntContentGaps(database)
    await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'content-gap-hunt', 'success', Date.now() - startedAt, result, null)
    return NextResponse.json(result)
  } catch (err) {
    const summary = { error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' }
    await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'content-gap-hunt', 'error', Date.now() - startedAt, summary, null)
    return NextResponse.json({ error: summary.error }, { status: 500 })
  }
}
