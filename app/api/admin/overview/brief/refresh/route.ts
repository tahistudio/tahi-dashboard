/**
 * POST /api/admin/overview/brief/refresh
 *
 * Regenerates the owner "Daily brief" and writes it to the
 * 'overview_brief_latest' settings cache, so the overview card serves a
 * once-per-day computed brief instead of recomputing on every page load.
 *
 * Two callers:
 *   1. The GitHub Actions morning cron (target 'overview-brief'), which sends
 *      the x-cron-secret header. It fires twice to cover NZDT/NZST and this
 *      handler self-gates: it only regenerates when the NZ local hour is 7 or 8
 *      AND the cache is stale (> 3h old). The off-cycle fire is a no-op, so the
 *      brief is produced exactly once each morning. Mirrors the AI briefing cron.
 *   2. A live admin (session, or ?force=1), which ALWAYS regenerates on demand —
 *      this is what the card's manual "Refresh" control posts.
 *
 * Auth: admin session OR cron secret (same pattern as the other cron routes).
 * A failure is logged via cron_runs and returned; it never throws past here.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logCronRun } from '@/lib/cron-runs'
import { computeBrief, writeBriefCache, readBriefCache, type D1 } from '@/app/api/admin/overview/brief/route'

export const dynamic = 'force-dynamic'

const NZ_TZ = 'Pacific/Auckland'
const TARGET_HOURS = new Set([7, 8])
const STALE_WINDOW_HOURS = 3

// Current hour in NZ local time, DST-safe (NZST vs NZDT handled by Intl).
function currentNzHour(): number {
  const fmt = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TZ,
    hour: 'numeric',
    hourCycle: 'h23',
  })
  const hourPart = fmt.formatToParts(new Date()).find(p => p.type === 'hour')
  return hourPart ? parseInt(hourPart.value, 10) : -1
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  // Auth: admin session OR cron secret. A live admin session also unlocks the
  // "always regenerate" path below (a scheduled cron fire self-gates instead).
  const cronHeader = req.headers.get('x-cron-secret')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)

  let sessionAuth: { userId: string | null; orgId: string | null } | null = null
  if (!hasCronAuth) {
    const auth = await getRequestAuth(req)
    if (!isTahiAdmin(auth.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    sessionAuth = auth
  }

  const force = new URL(req.url).searchParams.get('force') === '1'
  const database = (await db()) as unknown as D1

  // A scheduled cron fire (cron secret, not forced) self-gates: only regenerate
  // in the 7/8am NZ window when the cache is stale (> 3h). Any direct admin call
  // (session) or ?force=1 skips the gate and always regenerates.
  const scheduledFire = hasCronAuth && !force
  if (scheduledFire) {
    const hour = currentNzHour()
    if (!TARGET_HOURS.has(hour)) {
      const summary = { skipped: true, reason: `NZ local hour ${hour} outside target window` }
      await logCronRun(database, 'overview-brief', 'skipped', Date.now() - t0, summary, null)
      return NextResponse.json(summary)
    }
    const cached = await readBriefCache(database)
    if (cached?.generatedAt) {
      const ageHours = (Date.now() - new Date(cached.generatedAt).getTime()) / (1000 * 60 * 60)
      if (ageHours >= 0 && ageHours < STALE_WINDOW_HOURS) {
        const summary = { skipped: true, reason: `brief generated ${ageHours.toFixed(1)}h ago`, generatedAt: cached.generatedAt }
        await logCronRun(database, 'overview-brief', 'skipped', Date.now() - t0, summary, null)
        return NextResponse.json(summary)
      }
    }
  }

  // Compute identity: a live admin recomputes under their own auth (same gating
  // as GET); the cron recomputes as the unrestricted owner so the scheduled
  // brief is the full owner brief regardless of who wired the secret.
  const computeAuth = sessionAuth ?? {
    userId: 'api-service',
    orgId: process.env.NEXT_PUBLIC_TAHI_ORG_ID ?? null,
  }

  try {
    const result = await computeBrief(database, computeAuth)
    const generatedAt = new Date().toISOString()
    await writeBriefCache(database, result, generatedAt)
    const summary = {
      ok: true,
      generatedAt,
      counts: { urgent: result.urgent.length, week: result.week.length, slept: result.slept.length },
    }
    await logCronRun(database, 'overview-brief', 'success', Date.now() - t0, summary, null)
    return NextResponse.json({ ok: true, generatedAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await logCronRun(database, 'overview-brief', 'error', Date.now() - t0, null, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
