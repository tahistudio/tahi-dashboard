/**
 * lib/task-access.ts
 *
 * One access rule for every task route. A task with a client is guarded by
 * that client's access rule; a task with no client is the studio's own
 * housekeeping and is allowed for every team member on this surface.
 *
 * Lives in lib/ rather than in a route file because Next.js App Router
 * routes may only export HTTP methods and config; tsc accepts more, and
 * `next build` then rejects it.
 */

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { requireAccessToOrg } from '@/lib/require-access'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Look the task up and decide in one call, so no route has to remember to do
 * both.
 *
 * Returns a NextResponse to short circuit on (404 missing, 403 forbidden), or
 * null when the caller may proceed. That is the same contract
 * `requireAccessToOrg` already uses across the admin API, and it is the whole
 * reason this returns a response rather than a boolean: `requireAccessToOrg`
 * itself resolves to `NextResponse | null` with NULL MEANING ALLOWED, so a
 * boolean wrapper around it inverts on every denial.
 */
export async function guardTask(
  drizzle: Drizzle,
  userId: string | null,
  taskId: string,
): Promise<NextResponse | null> {
  const [task] = await drizzle
    .select({ orgId: schema.tasks.orgId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1)

  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  // No client means the studio's own housekeeping, which every team member on
  // this surface may reach (Decision 14). Same rule as the isNull clause on
  // the list route and on bulk, so all three hide and admit the same rows.
  //
  // The hidden internal studio org is deliberately NOT treated as a client
  // here: nothing writes it to tasks.org_id (it exists because
  // time_entries.org_id is NOT NULL), and admitting it would make this guard
  // more permissive than the list clause it is meant to match. The
  // internal-org case is settled where it actually arises, in
  // app/api/admin/time-entries, which gates on the target's own client rather
  // than on the org resolveTimerOrgId falls back to.
  if (!task.orgId) return null
  return requireAccessToOrg(drizzle, userId, task.orgId)
}
