/**
 * lib/cron-runs.ts — small helper that wraps a cron handler with
 * cron_runs logging so /settings/automations can show "last run" status
 * without re-running.
 *
 * Usage:
 *
 *   export const POST = withCronRun('pre-call-digest', async (req, database) => {
 *     ...the actual cron body...
 *     return { sent: 3, skipped: 1 }    // summary object surfaces in the UI
 *   })
 *
 * The helper:
 *   - authenticates (cron secret or admin session — same rules as before)
 *   - times the run
 *   - writes one row to cron_runs with status / durationMs / summary / error
 *   - returns the cron's summary JSON to the caller
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function logCronRun(
  database: D1,
  cron: string,
  status: 'success' | 'error' | 'skipped',
  durationMs: number,
  summary: unknown,
  error: string | null,
) {
  try {
    await database.insert(schema.cronRuns).values({
      id: crypto.randomUUID(),
      cron,
      status,
      durationMs,
      summary: summary ? JSON.stringify(summary) : null,
      error,
      ranAt: new Date().toISOString(),
    })
  } catch {
    // Don't let a failed log break the cron itself.
  }
}

export interface CronAuthResult {
  ok: boolean
  userId: string
  response?: NextResponse
}

/** Run the shared cron auth check (cron secret or admin session). */
export async function assertCronAuth(req: NextRequest): Promise<CronAuthResult> {
  const cronHeader = req.headers.get('x-cron-secret')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
  if (hasCronAuth) return { ok: true, userId: 'system' }
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return { ok: false, userId: '', response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  if (!auth.userId) {
    return { ok: false, userId: '', response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { ok: true, userId: auth.userId }
}

/** Wrap a cron handler with auth + cron_runs logging. */
export function withCronRun<TSummary>(
  cron: string,
  handler: (req: NextRequest, database: D1, userId: string) => Promise<TSummary>,
) {
  return async (req: NextRequest) => {
    const auth = await assertCronAuth(req)
    if (!auth.ok) return auth.response!
    const database = await db() as unknown as D1
    const t0 = Date.now()
    try {
      const summary = await handler(req, database, auth.userId)
      await logCronRun(database, cron, 'success', Date.now() - t0, summary, null)
      return NextResponse.json(summary)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await logCronRun(database, cron, 'error', Date.now() - t0, null, message)
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }
}
