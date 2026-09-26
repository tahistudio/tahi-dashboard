import { withCronRun } from '@/lib/cron-runs'
import { parseSecondPass, parseSweepLimit, runSuggestionSweep } from '@/lib/task-suggester'

// POST /api/admin/crons/suggest-from-transcripts
//
// Call notes to tasks, Phase 1. Every thirty minutes, read the transcripts
// nobody has read yet, ask Sonnet what the call changed, and write
// task_suggestions rows for a human to approve. Nothing is applied here, and
// nothing ever will be: the whole point of the table is that a person presses
// the button.
//
// The body lives in lib/task-suggester.ts#runSuggestionSweep. A route.ts may
// only export HTTP handlers, and this is the one scheduled job in the repo
// that spends money with nobody watching, so its gate, its high-water mark
// and its cost accounting have to be unit testable without a Worker.
//
// Everything the route itself does is in withCronRun: the cron secret (or an
// admin session), the timing, and one cron_runs row per run so
// /settings/automations can answer "is this thing alive" without firing it.
//
// Whatever the batch, a run stops starting transcripts once another would
// risk lib/task-suggester.ts#SWEEP_BUDGET_MS: workers/cron-trigger hangs up
// at 120 seconds, and each call is two reads of 20 to 27 seconds. What it
// did not reach stays unread for the next run and is counted in the
// summary's `deferred`.
//
// Two knobs, both for a human firing it by hand; the scheduled job passes
// neither:
//
//   ?limit=        transcripts per run. Default five, at most twenty, for a
//                  person draining a backlog. Clamped in
//                  lib/task-suggester.ts#parseSweepLimit, because an
//                  unbounded sweep is an unbounded model bill. The time
//                  budget still applies, so in practice a run reads one or
//                  two calls and defers the rest.
//   ?second_pass=0 read each call once instead of twice (CN.1c). The second
//                  read, with the first shown to the model and the question
//                  "anything missed?", is on by default; 0, false, off or no
//                  switch it off for this run only
//                  (lib/task-suggester.ts#parseSecondPass).
export const POST = withCronRun('suggest-from-transcripts', async (req, database) => {
  const params = new URL(req.url).searchParams
  const batch = parseSweepLimit(params.get('limit'))
  const secondPass = parseSecondPass(params.get('second_pass'))
  return runSuggestionSweep(database, { batch, secondPass })
})
