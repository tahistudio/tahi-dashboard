/**
 * POST /api/admin/cron/schema-watchdog
 *
 * Weekly schema watchdog. Scans every live blog + glossary item,
 * validates schema + verifies it renders in live HTML + flags drift
 * between lastUpdated and lastPublished. Auto-fixes schema_invalid +
 * schema_missing via the existing backfill paths.
 *
 * Body: { autoFix?: boolean, maxItems?: number }
 * Schedule: Sunday 23:00 UTC.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runSchemaWatchdog } from '@/lib/schema-watchdog-agent'
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

  const body = (await req.json().catch(() => ({}))) as { autoFix?: boolean; maxItems?: number }
  const startedAt = Date.now()
  const database = await db()
  try {
    const result = await runSchemaWatchdog(database, {
      autoFix: body.autoFix !== false,
      maxItems: body.maxItems,
    })
    await logCronRun(
      database as unknown as Parameters<typeof logCronRun>[0],
      'schema-watchdog',
      result.issues.length > 0 && result.autoFixed === 0 ? 'error' : 'success',
      Date.now() - startedAt,
      result,
      null,
    )
    return NextResponse.json(result)
  } catch (err) {
    const summary = { error: err instanceof Error ? err.message.slice(0, 200) : 'unknown' }
    await logCronRun(database as unknown as Parameters<typeof logCronRun>[0], 'schema-watchdog', 'error', Date.now() - startedAt, summary, null)
    return NextResponse.json({ error: summary.error }, { status: 500 })
  }
}
