import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { assertCronAuth, logCronRun } from '@/lib/cron-runs'
import { parseDigestFlag, runSuggestionDigest } from '@/lib/slack/digest'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const CRON = 'suggestion-digest'

// POST /api/admin/cron/suggestion-digest
//
// The Monday digest of suggestions still waiting (CN.3 contract section 5):
// one Slack DM to each founder, and to anyone whose own notes have waited a
// day or more. The body lives in lib/slack/digest.ts#runSuggestionDigest,
// because a route.ts may only export HTTP handlers and the claim, the window
// and the content all need to be unit testable without a Worker.
//
// The same auth as every cron (the cron secret or an admin session, through
// assertCronAuth), and one cron_runs row per real run. Not withCronRun, which
// logs every run as success, because the contract wants two other answers:
//
//   A run that stopped early (no SLACK_BOT_TOKEN, the kill switch, outside
//   the Monday window) is logged as skipped with its reason, so /settings/
//   crons reads "skipped slack_not_configured" rather than a success that
//   sent nothing.
//
//   A dry run writes nothing at all, cron_runs included. Its summary carries
//   every recipient's message, client names and all, and that belongs in the
//   caller's response, not in a table.
//
// The scheduler fires this twice every Sunday UTC (19:30 and 20:00, see
// workers/cron-trigger/src/schedule.ts); whichever lands inside Monday 08:00
// to 09:59 in Auckland sends, and the other finds the week already claimed.
// Without SLACK_BOT_TOKEN it returns { ran: false, reason:
// 'slack_not_configured' } and touches nothing but its own cron_runs row.
//
// Two knobs, for a person firing it by hand (the MCP cron_suggestion_digest):
//
//   ?dry_run=1  build every message and send none. Reads only, works without
//               Slack, and returns the studio preview and each payload.
//   ?force=1    send outside the Monday window. Never skips the weekly
//               claim, so it cannot send anybody a second digest that week.
//
// Both knobs are for an unrestricted caller only: the scheduler, the MCP
// service user, or a team member whose access scoping resolves to every
// client (a super_admin or admin role). A dry run answers with every
// founder's studio digest, which names every client and summarises their
// waiting suggestions, and every member's own notes; a scoped member reading
// that would see clients the inbox hides from them (CLAUDE.md rule 11). A
// plain run by hand stays open to any admin session, as every other cron is:
// it answers with counts only. A scoping lookup that fails refuses.
export async function POST(req: NextRequest) {
  const auth = await assertCronAuth(req)
  if (!auth.ok) return auth.response!

  const params = new URL(req.url).searchParams
  const force = parseDigestFlag(params.get('force'))
  const dryRun = parseDigestFlag(params.get('dry_run'))

  const database = await db() as unknown as D1

  if ((dryRun || force) && auth.userId !== 'system') {
    let unrestricted = false
    try {
      unrestricted = (await resolveAccessScoping(database, auth.userId)) === null
    } catch {
      unrestricted = false
    }
    if (!unrestricted) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const t0 = Date.now()
  try {
    const summary = await runSuggestionDigest(database, { force, dryRun })
    if (!dryRun) {
      await logCronRun(database, CRON, summary.ran ? 'success' : 'skipped', Date.now() - t0, summary, null)
    }
    return NextResponse.json(summary)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (!dryRun) await logCronRun(database, CRON, 'error', Date.now() - t0, null, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
