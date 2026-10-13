import { and, eq, isNull } from 'drizzle-orm'
import { NextRequest, NextResponse } from 'next/server'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { assertCronAuth, hasCronSecretAuth, logCronRun } from '@/lib/cron-runs'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { can, resolvePermissions } from '@/lib/permissions'
import { resolveTeamMember, SERVICE_USER_ID } from '@/lib/team-identity'
import { parseSecondPass, parseSweepLimit, runSuggestionSweep } from '@/lib/task-suggester'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
const CRON = 'suggest-from-transcripts'

async function mayRunManually(database: D1, userId: string): Promise<boolean> {
  try {
    if (userId !== SERVICE_USER_ID) {
      const member = await resolveTeamMember(database, userId)
      if (!member) return false
      const [role] = await database.select({ id: schema.teamMemberRoles.id })
        .from(schema.teamMemberRoles)
        .innerJoin(schema.roles, eq(schema.teamMemberRoles.roleId, schema.roles.id))
        .where(and(
          eq(schema.teamMemberRoles.teamMemberId, member.id),
          isNull(schema.teamMemberRoles.endedAt),
        )).limit(1)
      if (!role) return false
    }
    const access = await resolvePermissions(database, {
      userId, orgId: process.env.NEXT_PUBLIC_TAHI_ORG_ID ?? null,
    })
    return can(access, 'tasks') && can(access, 'requests')
      && (await resolveAccessScoping(database, userId)) === null
  } catch {
    return false
  }
}

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
// Manual callers need both inbox features and unrestricted client access:
// the sweep also resurfaces snoozed rows and repairs orgs across the workspace.
// Denials precede every write, including cron_runs. Verified scheduler secrets
// retain the automated path. Successful and failed runs keep the shared log.
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
export async function POST(req: NextRequest) {
  const auth = await assertCronAuth(req)
  if (!auth.ok) return auth.response!

  const scheduler = hasCronSecretAuth(req)
  const database = await db() as unknown as D1
  if (!scheduler && !(await mayRunManually(database, auth.userId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const params = new URL(req.url).searchParams
  const batch = parseSweepLimit(params.get('limit'))
  const secondPass = parseSecondPass(params.get('second_pass'))
  const startedAt = Date.now()
  try {
    const summary = await runSuggestionSweep(database, { batch, secondPass })
    await logCronRun(database, CRON, 'success', Date.now() - startedAt, summary, null)
    return NextResponse.json(summary)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await logCronRun(database, CRON, 'error', Date.now() - startedAt, null, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
