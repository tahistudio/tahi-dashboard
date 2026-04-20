import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, desc } from 'drizzle-orm'
import { logActivity } from '@/lib/deal-activity'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>
type RouteContext = { params: Promise<{ id: string }> }

// GET /api/admin/deals/[id]/nudges
export async function GET(req: NextRequest, ctx: RouteContext) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await ctx.params
  const database = await db() as unknown as D1

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
      const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'business@tahi.studio'

      if (process.env.RESEND_API_KEY) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: `Liam from Tahi Studio <${fromEmail}>`,
            to: body.contactEmails,
            subject: body.subject,
            html: body.bodyHtml,
          }),
        })

        if (!res.ok) {
          const errText = await res.text()
          await database.update(schema.dealNudges).set({
            status: 'failed',
            updatedAt: new Date().toISOString(),
          }).where(eq(schema.dealNudges.id, nudgeId))
          return NextResponse.json({ id: nudgeId, status: 'failed', error: errText }, { status: 500 })
        }
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
