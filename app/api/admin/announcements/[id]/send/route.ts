import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

// POST /api/admin/announcements/[id]/send
// Publishes the announcement and optionally sends emails via Resend.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const now = new Date().toISOString()

  // Get the announcement
  const rows = await database
    .select()
    .from(schema.announcements)
    .where(eq(schema.announcements.id, id))
    .limit(1)

  if (rows.length === 0) {
    return NextResponse.json({ error: 'Announcement not found' }, { status: 404 })
  }

  const announcement = rows[0]

  // Mark as published
  await database
    .update(schema.announcements)
    .set({ publishedAt: now, updatedAt: now })
    .where(eq(schema.announcements.id, id))

  // If email delivery is toggled on, send via Resend
  let emailsSent = 0
  if (announcement.sentByEmail) {
    // Get target contacts based on targetType
    let contacts: Array<{ email: string; name: string }> = []

    if (announcement.targetType === 'all') {
      const result = await database
        .select({ email: schema.contacts.email, name: schema.contacts.name })
        .from(schema.contacts)
      contacts = result
    } else if (announcement.targetType === 'plan_type' && announcement.targetValue) {
      const result = await database
        .select({ email: schema.contacts.email, name: schema.contacts.name })
        .from(schema.contacts)
        .innerJoin(
          schema.organisations,
          eq(schema.contacts.orgId, schema.organisations.id)
        )
        .where(eq(schema.organisations.planType, announcement.targetValue))
      contacts = result.map(r => ({ email: r.email, name: r.name }))
    } else if (announcement.targetType === 'org' && announcement.targetIds) {
      try {
        const orgIds = JSON.parse(announcement.targetIds) as string[]
        for (const targetOrgId of orgIds) {
          const result = await database
            .select({ email: schema.contacts.email, name: schema.contacts.name })
            .from(schema.contacts)
            .where(eq(schema.contacts.orgId, targetOrgId))
          contacts.push(...result)
        }
      } catch {
        // Invalid JSON in targetIds
      }
    }

    // Send emails via Resend (if RESEND_API_KEY is configured)
    if (contacts.length > 0 && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)

        for (const contact of contacts) {
          try {
            await resend.emails.send({
              from: 'Tahi Studio <notifications@tahistudio.com>',
              to: contact.email,
              subject: announcement.title,
              html: `<div style="font-family: Manrope, -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem;">
                <h2 style="color: #121A0F; font-size: 1.25rem;">${announcement.title}</h2>
                <p style="color: #5a6657; font-size: 0.9375rem; line-height: 1.6;">${announcement.body}</p>
                <hr style="border-color: #e8f0e6; margin: 1.5rem 0;" />
                <p style="color: #8a9987; font-size: 0.75rem;">Tahi Studio Dashboard</p>
              </div>`,
            })
            emailsSent++
          } catch {
            // Individual email send failure - continue with others
          }
        }
      } catch {
        // Resend import or init failure
      }
    }

    // Update email sent status
    await database
      .update(schema.announcements)
      .set({ emailSentAt: now, updatedAt: now })
      .where(eq(schema.announcements.id, id))
  }

  return NextResponse.json({
    success: true,
    publishedAt: now,
    emailsSent,
  })
}
