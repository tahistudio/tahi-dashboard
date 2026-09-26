import { withCronRun } from '@/lib/cron-runs'
import { parseDigestFlag, runSuggestionDigest } from '@/lib/slack/digest'

// POST /api/admin/cron/suggestion-digest
//
// The Monday digest of suggestions still waiting (CN.3 contract section 5):
// one Slack DM to each founder, and to anyone whose own notes have waited a
// day or more. The body lives in lib/slack/digest.ts#runSuggestionDigest,
// because a route.ts may only export HTTP handlers and the claim, the window
// and the content all need to be unit testable without a Worker.
//
// withCronRun does the rest: the cron secret (or an admin session), the
// timing, and one cron_runs row per run.
//
// The scheduler fires this twice every Sunday UTC (19:30 and 20:00, see
// workers/cron-trigger/src/schedule.ts); whichever lands inside Monday 08:00
// to 09:59 in Auckland sends, and the other finds the week already claimed.
// Without SLACK_BOT_TOKEN it returns { ran: false, reason:
// 'slack_not_configured' } and touches nothing.
//
// Two knobs, for a person firing it by hand (the MCP cron_suggestion_digest):
//
//   ?dry_run=1  build every message and send none. Reads only, works without
//               Slack, and returns the studio preview and each payload.
//   ?force=1    send outside the Monday window. Never skips the weekly
//               claim, so it cannot send anybody a second digest that week.
export const POST = withCronRun('suggestion-digest', async (req, database) => {
  const params = new URL(req.url).searchParams
  return runSuggestionDigest(database, {
    force: parseDigestFlag(params.get('force')),
    dryRun: parseDigestFlag(params.get('dry_run')),
  })
})
