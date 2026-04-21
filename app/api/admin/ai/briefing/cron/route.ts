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

  // Only fire on weekdays (Mon\u2013Fri) in NZ local time.
  const dow = currentNzDayOfWeek()
  if (dow < 1 || dow > 5) {
    return NextResponse.json({ skipped: true, reason: 'not a weekday in NZ' })
  }

  // Only fire during the 7am/8am window in NZ local time. GitHub Actions
  // will hit this twice a day to cover both NZDT and NZST \u2014 the other
  // one silently no-ops.
  const hour = currentNzHour()
  if (!TARGET_HOURS.has(hour)) {
    return NextResponse.json({ skipped: true, reason: `NZ local hour ${hour} outside target window` })
  }

  // Dedup against the cached briefing \u2014 don't regenerate if one was
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
      // Corrupt cache \u2014 fall through and regenerate.
    }
  }

  // Call the shared generator directly. We used to self-fetch the POST
  // handler over HTTP, but Cloudflare rejects workers looping back through
  // their own public hostname with error 1014, so the shared function is
  // the right pattern.
  try {
    const briefing = await generateBriefing()
    return NextResponse.json({
      generated: true,
      nzHour: hour,
      dayOfWeek: dow,
      briefing,
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'Briefing generation failed', detail: err instanceof Error ? err.message : 'Unknown' },
      { status: 500 },
    )
  }
}

// GET returns a status heartbeat for debugging.
export async function GET(req: NextRequest) {
  const expected = process.env.TAHI_CRON_SECRET
  const provided = req.headers.get('x-cron-secret')
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json({
    ok: true,
    nzHour: currentNzHour(),
    nzDayOfWeek: currentNzDayOfWeek(),
    targetHours: Array.from(TARGET_HOURS),
    dedupWindowHours: DEDUP_WINDOW_HOURS,
  })
}
