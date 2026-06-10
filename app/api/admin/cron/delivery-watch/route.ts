import { schema } from '@/db/d1'
import { eq, and, sql } from 'drizzle-orm'
import { withCronRun } from '@/lib/cron-runs'
import { listOffTrackEngagements } from '@/lib/delivery-aggregate'
import { DELIVERY_STATUS_LABEL } from '@/lib/delivery-status-labels'

// POST /api/admin/cron/delivery-watch
// Delivery spine (#148) Slice 5: scan active engagements and ping the operator
// when a client's delivery rollup is off track (blocked / delayed / at_risk).
// Absolute-condition + dedup: one notification per off-track org per 23h window,
// so a persistently off-track engagement pings at most once a day. No new schema.
export const POST = withCronRun('delivery-watch', async (_req, database) => {
  const engagements = await listOffTrackEngagements(database, new Date().toISOString())

  // Recipient = the configured default owner (same convention as other crons).
  const [ownerRow] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
    .limit(1)
  const recipient = ownerRow?.value?.trim()

  let notified = 0
  let skipped = 0

  if (recipient) {
    const now = new Date().toISOString()
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

      await database.insert(schema.notifications).values({
        id: crypto.randomUUID(),
        userId: recipient,
        userType: 'team_member',
        eventType: 'delivery_off_track',
        title: `Delivery off track: ${e.orgName}`,
        body: `${DELIVERY_STATUS_LABEL[e.status]} — ${e.offTrackCount} phase${e.offTrackCount === 1 ? '' : 's'} off track (${e.rowsDone}/${e.rowsTotal} done).`,
        entityType: 'organisation',
        entityId: e.orgId,
        read: false,
        createdAt: now,
      })
      notified++
    }
  }

  return { offTrack: engagements.length, notified, skipped, hadRecipient: !!recipient }
})
