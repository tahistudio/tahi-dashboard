/**
 * POST /api/admin/ai/briefing/cron
 *
 * Scheduled daily briefing trigger. Called by GitHub Actions twice per
 * weekday (19:00 and 20:00 UTC) to cover both NZDT and NZST. The handler:
 *
 *  1. Verifies the `x-cron-secret` header against TAHI_CRON_SECRET.
 *  2. Checks the current hour in Pacific/Auckland \u2014 only proceeds when
 *     it's 7 or 8 AM local. The off-cycle fire is a no-op by design, so
 *     the user gets exactly one briefing per morning regardless of DST.
 *  3. Dedups against the cached briefing \u2014 skips if one was generated
 *     in the last 3 hours (e.g. user hit Generate manually before 8am).
 *  4. Forwards to the main briefing POST endpoint to produce the briefing.
 *
 * Decision #043 (2026-04-21): briefings cost ~$0.04/day; cheap enough
 * that re-running on manual click + scheduled trigger is fine.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { generateBriefing } from '@/lib/ai-briefing'

export const dynamic = 'force-dynamic'

const NZ_TZ = 'Pacific/Auckland'
const TARGET_HOURS = new Set([7, 8])
const DEDUP_WINDOW_HOURS = 3

function currentNzHour(): number {
  // Intl.DateTimeFormat gives us the hour in the target timezone reliably
  // across DST boundaries \u2014 the caller doesn't need to know NZST vs NZDT.
  const fmt = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TZ,
    hour: 'numeric',
    hourCycle: 'h23',
  })
  const parts = fmt.formatToParts(new Date())
  const hourPart = parts.find(p => p.type === 'hour')
  return hourPart ? parseInt(hourPart.value, 10) : -1
}

function currentNzDayOfWeek(): number {
  // 0 = Sunday, 1 = Monday, ..., 6 = Saturday, in NZ local time.
  const fmt = new Intl.DateTimeFormat('en-NZ', {
    timeZone: NZ_TZ,
    weekday: 'short',
  })
  const weekday = fmt.format(new Date())
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[weekday] ?? -1
}

export async function POST(req: NextRequest) {
  const expected = process.env.TAHI_CRON_SECRET
  const provided = req.headers.get('x-cron-secret')
  if (!expected) {
    return NextResponse.json({ error: 'TAHI_CRON_SECRET not configured' }, { status: 500 })
  }
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Manual test override: a valid cron caller (already past the secret check)
  // may pass ?force=1 or the x-cron-force header to bypass the weekday/hour/
  // dedup gates so the generation path can be exercised on demand. Scheduled
  // fires never set it, so production timing is unchanged.
  const forced =
    new URL(req.url).searchParams.get('force') === '1' ||
    req.headers.get('x-cron-force') === '1'

  if (!forced) {
    // Only fire on weekdays (Mon-Fri) in NZ local time.
    const dow = currentNzDayOfWeek()
    if (dow < 1 || dow > 5) {
      return NextResponse.json({ skipped: true, reason: 'not a weekday in NZ' })
    }

    // Only fire during the 7am/8am window in NZ local time. GitHub Actions
    // will hit this twice a day to cover both NZDT and NZST - the other one
    // silently no-ops.
    const hour = currentNzHour()
    if (!TARGET_HOURS.has(hour)) {
      return NextResponse.json({ skipped: true, reason: `NZ local hour ${hour} outside target window` })
    }

    // Dedup against the cached briefing - don't regenerate if one was
    // produced in the last 3 hours.
    const database = await db()
    const cached = await database.select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'ai_briefing_latest'))
      .limit(1)

    if (cached.length > 0 && cached[0].value) {
      try {
        const data = JSON.parse(cached[0].value) as { generatedAt?: string }
        if (data.generatedAt) {
          const ageHours = (Date.now() - new Date(data.generatedAt).getTime()) / (1000 * 60 * 60)
          if (ageHours < DEDUP_WINDOW_HOURS) {
            return NextResponse.json({
              skipped: true,
              reason: `briefing generated ${ageHours.toFixed(1)}h ago`,
              generatedAt: data.generatedAt,
            })
          }
        }
      } catch {
        // Corrupt cache - fall through and regenerate.
      }
    }
  }

  // generateBriefing() calls Claude Sonnet, which routinely runs longer than
  // Webflow Cloud's edge gateway timeout (~20s). Awaiting it here returns a
  // 504 to the caller even though the worker finishes server-side, and when
  // the client disconnects Cloudflare can tear down the in-flight generation
  // before it caches - so some mornings nothing is produced at all.
  //
  // Hand the work to ctx.waitUntil so the worker stays alive after we respond,
  // then answer immediately with 202. The result is cached to
  // settings.ai_briefing_latest for the UI's GET to read. Same pattern as the
  // Xero webhook reconcile and dispatchDomainEvent.
  const work = generateBriefing().catch((err) => {
    console.error(
      '[ai-briefing-cron] generation failed:',
      err instanceof Error ? err.message : err,
    )
  })
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const cfCtx = await getCloudflareContext({ async: true })
    if (cfCtx?.ctx?.waitUntil) {
      cfCtx.ctx.waitUntil(work)
    } else {
      void work
    }
  } catch {
    // No execution context (local dev): let it run detached.
    void work
  }

  return NextResponse.json({ scheduled: true, forced }, { status: 202 })
}

// GET returns a status heartbeat for debugging. It also surfaces when the
// cached briefing was last produced (timestamp only) so a forced test run's
// background generation can be confirmed through this same secret-gated route.
export async function GET(req: NextRequest) {
  const expected = process.env.TAHI_CRON_SECRET
  const provided = req.headers.get('x-cron-secret')
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let cachedGeneratedAt: string | null = null
  try {
    const database = await db()
    const cached = await database.select()
      .from(schema.settings)
      .where(eq(schema.settings.key, 'ai_briefing_latest'))
      .limit(1)
    if (cached.length > 0 && cached[0].value) {
      const data = JSON.parse(cached[0].value) as { generatedAt?: string }
      cachedGeneratedAt = data.generatedAt ?? null
    }
  } catch {
    cachedGeneratedAt = null
  }

  return NextResponse.json({
    ok: true,
    nzHour: currentNzHour(),
    nzDayOfWeek: currentNzDayOfWeek(),
    targetHours: Array.from(TARGET_HOURS),
    dedupWindowHours: DEDUP_WINDOW_HOURS,
    cachedGeneratedAt,
  })
}
