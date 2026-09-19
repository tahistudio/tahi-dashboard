import { withCronRun } from '@/lib/cron-runs'
import { runSuggestionSweep } from '@/lib/task-suggester'

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
export const POST = withCronRun('suggest-from-transcripts', async (_req, database) => {
  return runSuggestionSweep(database)
})
