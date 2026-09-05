/**
 * lib/task-access.ts
 *
 * The shared server-side task lookups. Two of them:
 *
 *   - `guardTask`, the one access rule every task route applies. A task with
 *     a client is guarded by that client's access rule; a task with no client
 *     is the studio's own housekeeping and is allowed for every team member
 *     on this surface.
 *   - `loadTaskLinks` and `requestOrgId`, the two reads the link invariants in
 *     lib/task-consistency.ts need before they can resolve a write. Both write
 *     doors (POST /api/admin/tasks and PATCH /api/admin/tasks/[id]) use them,
 *     so they live here rather than as two near-copies inside routes.
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

/**
 * The level / client / request triple a task holds today.
 *
 * PATCH needs the whole triple, not just the client `guardTask` reads, because
 * the three fields are one state: writing any of them means resolving all
 * three through `setTaskLevel` and `coerceTaskLinks`. Returns null when the
 * row is gone.
 */
export interface TaskLinkRow {
  type: string
  orgId: string | null
  requestId: string | null
}

export async function loadTaskLinks(
  drizzle: Drizzle,
  taskId: string,
): Promise<TaskLinkRow | null> {
  const [task] = await drizzle
    .select({
      type: schema.tasks.type,
      orgId: schema.tasks.orgId,
      requestId: schema.tasks.requestId,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId))
    .limit(1)

  return task ?? null
}

/**
 * The client a request belongs to, or null when there is no such request.
 *
 * Linking a task to a request adopts that request's client, because a task and
 * its request disagreeing about the client is the one state nothing downstream
 * can render honestly (the rule `setTaskRequest` states). A caller that knows
 * only the request, which is what the request detail's AI action items and the
 * discovery call promoter both send, should not have to know the client too.
 */
export async function requestOrgId(
  drizzle: Drizzle,
  requestId: string,
): Promise<string | null> {
  const [request] = await drizzle
    .select({ orgId: schema.requests.orgId })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1)

  return request?.orgId ?? null
}

/**
 * Which table an assignee id belongs to. The tasks surface assigns team
 * members, but legacy rows and the MCP tool can still carry a contact, and
 * the assignment notification is addressed off this value, so the server
 * settles it from the id rather than trusting the caller to send the pair.
 * Returns null when the id matches neither table.
 */
export async function resolveAssigneeType(
  drizzle: Drizzle,
  assigneeId: string,
): Promise<'team_member' | 'contact' | null> {
  const [member] = await drizzle
    .select({ id: schema.teamMembers.id })
    .from(schema.teamMembers)
    .where(eq(schema.teamMembers.id, assigneeId))
    .limit(1)
  if (member) return 'team_member'
  const [contact] = await drizzle
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(eq(schema.contacts.id, assigneeId))
    .limit(1)
  return contact ? 'contact' : null
}
