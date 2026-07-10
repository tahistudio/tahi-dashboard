/**
 * POST /api/admin/crons/sweep - the automation time sweep.
 *
 * Event-driven automation triggers (request_created, request_status_changed,
 * client_onboarded, ...) fire inline via lib/events.ts. The two time-based
 * triggers have no natural event point, so this sweep evaluates them on a
 * schedule and pushes them through the exact same engine:
 *
 *   request_overdue  - a request crossed its due date since the last sweep
 *                      (dueDate is a YYYY-MM-DD string; a request is overdue
 *                      from the first day after its due date).
 *   client_inactive  - an active client's most recent request activity crossed
 *                      the 30-day inactivity line since the last sweep.
 *
 * Both use the previous successful sweep as the window start (fallback 24h),
 * so each entity fires exactly once as it crosses the line - re-running the
 * sweep does not re-fire rules for already-overdue or already-inactive rows.
 *
 * Auth + cron_runs logging via withCronRun ('automation-sweep'), so the run
 * surfaces in Settings > Scheduled jobs with a Run now button.
 */

import { schema } from '@/db/d1'
import { and, desc, eq, gte, isNotNull, lt, notInArray, sql } from 'drizzle-orm'
import { withCronRun } from '@/lib/cron-runs'
import { emitDomainEvent } from '@/lib/events'

// Statuses that never count as overdue work.
const TERMINAL_REQUEST_STATUSES = ['draft', 'delivered', 'archived', 'cancelled']

const INACTIVE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

export const POST = withCronRun('automation-sweep', async (_req, database) => {
  const now = new Date()
  const nowIso = now.toISOString()
  const today = nowIso.slice(0, 10)

  // Window start = the previous successful sweep; first run looks back 24h.
  const [prev] = await database
    .select({ ranAt: schema.cronRuns.ranAt })
    .from(schema.cronRuns)
    .where(and(
      eq(schema.cronRuns.cron, 'automation-sweep'),
      eq(schema.cronRuns.status, 'success'),
    ))
    .orderBy(desc(schema.cronRuns.ranAt))
    .limit(1)
  const windowStartIso = prev?.ranAt ?? new Date(now.getTime() - DAY_MS).toISOString()
  const windowStartDay = windowStartIso.slice(0, 10)

  // request_overdue: due date crossed between the last sweep day and today.
  const overdue = await database
    .select({
      id: schema.requests.id,
      orgId: schema.requests.orgId,
      title: schema.requests.title,
      status: schema.requests.status,
      dueDate: schema.requests.dueDate,
    })
    .from(schema.requests)
    .where(and(
      isNotNull(schema.requests.dueDate),
      lt(schema.requests.dueDate, today),
      gte(schema.requests.dueDate, windowStartDay),
      notInArray(schema.requests.status, TERMINAL_REQUEST_STATUSES),
    ))

  for (const r of overdue) {
    await emitDomainEvent(database, {
      type: 'request_overdue',
      entityId: r.id,
      entityType: 'request',
      orgId: r.orgId,
      data: { title: r.title, status: r.status, dueDate: r.dueDate },
    })
  }

  // client_inactive: latest request activity per active org crossed the
  // 30-day line inside the window. Orgs with no request history are skipped
  // rather than guessed at.
  const inactiveCutoff = new Date(now.getTime() - INACTIVE_DAYS * DAY_MS).toISOString()
  const windowCutoff = new Date(
    new Date(windowStartIso).getTime() - INACTIVE_DAYS * DAY_MS,
  ).toISOString()

  const activity = await database
    .select({
      orgId: schema.requests.orgId,
      lastActivity: sql<string>`max(${schema.requests.updatedAt})`,
    })
    .from(schema.requests)
    .groupBy(schema.requests.orgId)

  const activeOrgs = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name })
    .from(schema.organisations)
    .where(eq(schema.organisations.status, 'active'))

  const lastByOrg = new Map(activity.map(a => [a.orgId, a.lastActivity]))
  let inactiveFired = 0
  for (const org of activeOrgs) {
    const last = lastByOrg.get(org.id)
    if (!last) continue
    if (last <= inactiveCutoff && last > windowCutoff) {
      await emitDomainEvent(database, {
        type: 'client_inactive',
        entityId: org.id,
        entityType: 'organisation',
        orgId: org.id,
        data: { name: org.name, lastActivityAt: last, inactiveDays: INACTIVE_DAYS },
      })
      inactiveFired++
    }
  }

  return {
    window: { from: windowStartIso, to: nowIso },
    overdueFired: overdue.length,
    inactiveFired,
  }
})
