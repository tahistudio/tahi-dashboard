import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'
import { logActivity } from '@/lib/deal-activity'
import { emailFromAddress } from '@/lib/email'
import { deliverEmail } from '@/lib/email-delivery'
import { requireDealAccess } from '../../_access'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// GET /api/admin/deals/[id]/nudges
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'deals')
  if (featureDenied) return featureDenied

  const { id } = await ctx.params
  const database = await db() as unknown as D1

  const denied = await requireDealAccess(database, { userId, orgId }, id)
  if (denied) return denied

  const nudges = await database
    .select()
    .from(schema.dealNudges)
    .where(eq(schema.dealNudges.dealId, id))
    .orderBy(desc(schema.dealNudges.createdAt))

  return NextResponse.json({ items: nudges })
}

// POST /api/admin/deals/[id]/nudges - create and optionally send immediately
export async function POST(req: NextRequest, ctx: RouteContext) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const featureDenied = await requireFeature({ userId, orgId }, 'deals')
  if (featureDenied) return featureDenied

  const { id: dealId } = await ctx.params
  const body = await req.json() as {
    templateId?: string
    contactEmails: string[] // array of email addresses
    subject: string
    bodyHtml: string
    sendNow?: boolean       // true = send immediately
    scheduledAt?: string    // ISO timestamp for scheduled send
  }

  if (!body.contactEmails?.length || !body.subject?.trim() || !body.bodyHtml?.trim()) {
    return NextResponse.json({ error: 'contactEmails, subject, and bodyHtml are required' }, { status: 400 })
  }

  const database = await db() as unknown as D1

  const denied = await requireDealAccess(database, { userId, orgId }, dealId)
  if (denied) return denied

  const now = new Date().toISOString()
  const nudgeId = crypto.randomUUID()

  const status = body.sendNow ? 'sent' : body.scheduledAt ? 'scheduled' : 'draft'

  await database.insert(schema.dealNudges).values({
    id: nudgeId,
    dealId,
    templateId: body.templateId ?? null,
    contactEmails: JSON.stringify(body.contactEmails),
    subject: body.subject.trim(),
    bodyHtml: body.bodyHtml.trim(),
    status,
    scheduledAt: body.scheduledAt ?? null,
    sentAt: body.sendNow ? now : null,
    createdById: userId ?? 'unknown',
    createdAt: now,
    updatedAt: now,
  })

  // Send immediately if requested
  if (body.sendNow) {
    try {
      // Pull signature from settings and append to body. Stored as raw HTML
      // under key `pipeline.nudgeSignatureHtml`. If unset/blank, send as-is.
      let outgoingHtml = body.bodyHtml
      try {
        const [sigRow] = await database
          .select({ value: schema.settings.value })
          .from(schema.settings)
          .where(eq(schema.settings.key, 'pipeline.nudgeSignatureHtml'))
          .limit(1)
        const signature = sigRow?.value?.trim()
        if (signature) {
          outgoingHtml = `${body.bodyHtml}<br><br>${signature}`
        }
      } catch {
        // Signature lookup failed — send without rather than block the nudge.
      }

      if (process.env.RESEND_API_KEY) {
        // Out through the one door (lib/email-delivery.ts). A nudge goes to a
        // prospect at their own company, which is exactly the shape of address
        // the tahi.studio allowlist exists to hold back until Liam has
        // verified it, so this is the call site most likely to be stopped.
        const outcome = await deliverEmail({
          // A nudge is written in one person's voice, so it keeps the display
          // name and takes the mailbox from the one configured lockup. Built
          // by hand it produced "Liam from Tahi Studio <Tahi Studio <...>>"
          // the moment RESEND_FROM_EMAIL held a full lockup.
          from: emailFromAddress('Liam from Tahi Studio'),
          to: body.contactEmails,
          subject: body.subject,
          html: outgoingHtml,
          template: 'deal-nudge',
        })

        if (!outcome.success) {
          await database.update(schema.dealNudges).set({
            status: 'failed',
            updatedAt: new Date().toISOString(),
          }).where(eq(schema.dealNudges.id, nudgeId))
          return NextResponse.json({
            id: nudgeId,
            status: 'failed',
            error: outcome.error ?? 'Send failed',
            suppressedCount: outcome.suppressedCount,
          }, { status: outcome.blocked ? 409 : 500 })
        }
      }

      // Persist the final composed HTML (with signature) so the timeline /
      // nudge history shows what was actually delivered, not the pre-append draft.
      if (outgoingHtml !== body.bodyHtml) {
        await database.update(schema.dealNudges).set({
          bodyHtml: outgoingHtml,
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.dealNudges.id, nudgeId))
      }
    } catch (err) {
      await database.update(schema.dealNudges).set({
        status: 'failed',
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.dealNudges.id, nudgeId))
      return NextResponse.json({
        id: nudgeId,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Send failed',
      }, { status: 500 })
    }
  }

  // Log to timeline (status-informed).
  const recipientPreview = body.contactEmails.slice(0, 2).join(', ') + (body.contactEmails.length > 2 ? `, +${body.contactEmails.length - 2}` : '')
  await logActivity(database, {
    dealId,
    type: 'nudge_sent',
    title: body.sendNow
      ? `Nudge sent to ${recipientPreview}`
      : body.scheduledAt
        ? `Nudge scheduled for ${body.scheduledAt.slice(0, 16).replace('T', ' ')}`
        : `Nudge drafted`,
    description: body.subject,
    metadata: {
      subject: body.subject,
      templateId: body.templateId ?? null,
      recipients: body.contactEmails,
      status,
      scheduledAt: body.scheduledAt ?? null,
    },
    createdById: userId ?? 'system',
  })

  return NextResponse.json({ id: nudgeId, status }, { status: 201 })
}
