import { schema } from '@/db/d1'
import { eq, and, sql } from 'drizzle-orm'
import { withCronRun } from '@/lib/cron-runs'
import { createNotification, resolveOwnerSetting } from '@/lib/notifications'
import { listOffTrackEngagements } from '@/lib/delivery-aggregate'
import { DELIVERY_STATUS_LABEL } from '@/lib/delivery-status-labels'
import { nudgeStalledHandoffs } from '@/lib/request-handoff-nudge'

// POST /api/admin/cron/delivery-watch
// Delivery spine (#148) Slice 5: scan active engagements and ping the operator
// when a client's delivery rollup is off track (blocked / delayed / at_risk).
// Absolute-condition + dedup: one notification per off-track org per 23h window,
// so a persistently off-track engagement pings at most once a day. No new schema.
//
// Second step (migration 0104): chase the clients a request has been handed to
// and is still sitting with. Same question, other side of the table, so it
// rides the same daily run rather than a cron of its own. The rules live in
// lib/request-handoff-nudge.ts, because a route.ts may only export HTTP verbs
// and a scheduled mailer whose windows cannot be unit tested is a scheduled
// mailer that spams a client.
export const POST = withCronRun('delivery-watch', async (_req, database) => {
  const engagements = await listOffTrackEngagements(database, new Date().toISOString())

  // Recipient = the configured default owner (same convention as other
  // crons). resolveOwnerSetting tolerates a teamMembers.id or a raw Clerk id
  // and returns the Clerk user id the bell queries, or null when unresolvable.
  const [ownerRow] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
    .limit(1)
  const owner = await resolveOwnerSetting(database, ownerRow?.value)

  let notified = 0
  let skipped = 0

  if (owner) {
    for (const e of engagements) {
      // Dedup: skip if we already pinged for this org in the last 23 hours.
      const [recent] = await database
        .select({ id: schema.notifications.id })
        .from(schema.notifications)
        .where(and(
          eq(schema.notifications.eventType, 'delivery_off_track'),
          eq(schema.notifications.entityId, e.orgId),
          sql`${schema.notifications.createdAt} > datetime('now', '-23 hours')`,
        ))
        .limit(1)
      if (recent) { skipped++; continue }

      const res = await createNotification(database, {
        recipient: owner,
        type: 'delivery_off_track',
        title: `Delivery off track: ${e.orgName}`,
        body: `${DELIVERY_STATUS_LABEL[e.status]}: ${e.offTrackCount} phase${e.offTrackCount === 1 ? '' : 's'} off track (${e.rowsDone}/${e.rowsTotal} done).`,
        entityType: 'organisation',
        entityId: e.orgId,
      })
      if (res.delivered > 0) notified++
    }
  }

  // The hand-off half. Never allowed to fail the run: the engagement report
  // above has already done its work by the time this starts, and losing it to
  // a hand-off query would be the worse trade. nudgeStalledHandoffs already
  // swallows its own failures; this is the belt on top of the braces.
  let handoffs = { scanned: 0, nudged: 0 }
  try {
    handoffs = await nudgeStalledHandoffs(database, new Date())
  } catch (err) {
    console.warn('[delivery-watch] hand-off nudge step failed:', err)
  }

  return {
    offTrack: engagements.length,
    notified,
    skipped,
    hadRecipient: !!owner,
    handoffsDue: handoffs.scanned,
    handoffsNudged: handoffs.nudged,
  }
})
