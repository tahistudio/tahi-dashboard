/**
 * lib/announcement-emails.ts
 *
 * Shared announcement email fan-out, used by both announcement routes
 * (POST /api/admin/announcements on create-and-publish, and
 * POST /api/admin/announcements/[id]/send for publish-later) so the two paths
 * can never diverge on targeting, templating, or preference handling.
 *
 * Recipient resolution mirrors the banner targeting model:
 *   - all       -> every organisation
 *   - plan_type -> organisations whose planType matches targetValue
 *   - org       -> the organisations named in targetIds
 * From those orgs we take every contact with a non-empty email, honour each
 * contact's email preference for the announcement event, and render the
 * AnnouncementEmail React Email template. Delivery is best-effort and never
 * surfaces as an error to the caller: a Resend outage must not fail the
 * announcement itself.
 */

import { createElement } from 'react'
import { eq, inArray } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { sendEmail } from '@/lib/email'
import { isEventChannelEnabled } from '@/lib/notification-preferences'
import { publicUrl } from '@/lib/app-url'
import AnnouncementEmail, { type AnnouncementEmailType } from '@/emails/announcement'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const ANNOUNCEMENT_EMAIL_TYPES: readonly AnnouncementEmailType[] = [
  'info',
  'success',
  'warning',
  'maintenance',
]

export function toEmailType(type: string): AnnouncementEmailType {
  return (ANNOUNCEMENT_EMAIL_TYPES as readonly string[]).includes(type)
    ? (type as AnnouncementEmailType)
    : 'info'
}

/** Returns the number of contacts actually emailed. */
export async function fanOutAnnouncementEmails(
  database: DrizzleDB,
  opts: {
    title: string
    body: string
    type: string
    targetType: string
    targetValue: string | null
    targetIds: string[] | null
  },
): Promise<number> {
  // 1) Resolve the targeted organisations.
  let orgIds: string[] = []
  try {
    if (opts.targetType === 'org') {
      orgIds = opts.targetIds ?? []
    } else if (opts.targetType === 'plan_type') {
      if (!opts.targetValue) return 0
      const rows = await database
        .select({ id: schema.organisations.id })
        .from(schema.organisations)
        .where(eq(schema.organisations.planType, opts.targetValue))
      orgIds = rows.map((r) => r.id)
    } else {
      const rows = await database
        .select({ id: schema.organisations.id })
        .from(schema.organisations)
      orgIds = rows.map((r) => r.id)
    }
  } catch (err) {
    console.error('[announcements] failed to resolve target orgs', err)
    return 0
  }

  if (orgIds.length === 0) return 0

  // 2) Load contacts for those orgs that have an email address.
  let contacts: { id: string; email: string; clerkUserId: string | null }[] = []
  try {
    const rows = await database
      .select({
        id: schema.contacts.id,
        email: schema.contacts.email,
        clerkUserId: schema.contacts.clerkUserId,
      })
      .from(schema.contacts)
      .where(inArray(schema.contacts.orgId, orgIds))
    contacts = rows.filter((c) => typeof c.email === 'string' && c.email.trim().length > 0)
  } catch (err) {
    console.error('[announcements] failed to load target contacts', err)
    return 0
  }

  if (contacts.length === 0) return 0

  // 3) Honour each contact's email preference for the announcement event. A
  //    contact keys their preferences on their Clerk user id (same id the
  //    portal writes under); a contact who has never signed in has no clerk id
  //    and no possible row, so the channel default (email on) applies.
  const emailType = toEmailType(opts.type)
  const emailReact = createElement(AnnouncementEmail, {
    title: opts.title,
    body: opts.body,
    type: emailType,
    ctaLabel: 'Open your portal',
    ctaUrl: publicUrl('/'),
  })

  const eligible: { email: string }[] = []
  for (const contact of contacts) {
    let allowed = true
    if (contact.clerkUserId) {
      allowed = await isEventChannelEnabled(
        database,
        contact.clerkUserId,
        'contact',
        'announcement_posted',
        'email',
      )
    }
    if (allowed) eligible.push({ email: contact.email.trim() })
  }

  if (eligible.length === 0) return 0

  // 4) Fan out in bounded batches. Each contact gets their own email (no shared
  //    To header), and one failure never blocks the rest.
  const subject = opts.title.trim()
  const BATCH = 20
  let emailed = 0
  for (let i = 0; i < eligible.length; i += BATCH) {
    const slice = eligible.slice(i, i + BATCH)
    const results = await Promise.all(
      slice.map(async (r) => {
        try {
          const res = await sendEmail(r.email, subject, emailReact)
          return res.success
        } catch (err) {
          console.error('[announcements] email send failed', err)
          return false
        }
      }),
    )
    emailed += results.filter(Boolean).length
  }

  return emailed
}
