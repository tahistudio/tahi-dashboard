import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// POST /api/admin/clients/[id]/welcome-email
// Sends a welcome email to the primary contact of a client organisation via Resend.
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Fetch the organisation
  const [org] = await drizzle
    .select({
      id: schema.organisations.id,
      name: schema.organisations.name,
    })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, id))
    .limit(1)

  if (!org) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  // Find primary contact for this org (prefer isPrimary, fall back to first contact)
  const contacts = await drizzle
    .select({ email: schema.contacts.email, name: schema.contacts.name, isPrimary: schema.contacts.isPrimary })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, id))

  if (contacts.length === 0) {
    return NextResponse.json(
      { error: 'No contacts found for this client' },
      { status: 400 }
    )
  }

  const contact = contacts.find(c => c.isPrimary) ?? contacts[0]

  if (!contact.email) {
    return NextResponse.json(
      { error: 'Contact has no email address' },
      { status: 400 }
    )
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: 'Email service is not configured' },
      { status: 500 }
    )
  }

  const portalUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://dashboard.tahistudio.com'

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    await resend.emails.send({
      from: 'Tahi Studio <notifications@tahi.studio>',
      to: contact.email,
      subject: 'Welcome to Tahi Studio',
      html: `<div style="font-family: Manrope, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 2rem;">
          <h1 style="color: #5A824E; font-size: 1.5rem; margin: 0;">Tahi Studio</h1>
        </div>
        <h2 style="color: #121A0F; font-size: 1.25rem; margin-bottom: 0.5rem;">Welcome aboard, ${contact.name}!</h2>
        <p style="color: #5a6657; font-size: 0.9375rem; line-height: 1.6; margin-bottom: 1rem;">
          We are excited to have ${org.name} on board. Your client portal is ready and waiting for you.
        </p>
        <p style="color: #5a6657; font-size: 0.9375rem; line-height: 1.6; margin-bottom: 1.5rem;">
          From your dashboard you can submit requests, track progress, view invoices, upload files, and communicate directly with our team. Everything you need in one place.
        </p>
        <div style="text-align: center; margin-bottom: 2rem;">
          <a href="${portalUrl}" style="display: inline-block; background: #5A824E; color: #ffffff; text-decoration: none; padding: 0.75rem 2rem; border-radius: 0 16px 0 16px; font-weight: 600; font-size: 0.9375rem;">Get Started</a>
        </div>
        <p style="color: #5a6657; font-size: 0.875rem; line-height: 1.6;">
          If you have any questions, simply reply to this email or reach out through your portal. We are here to help.
        </p>
        <hr style="border: none; border-top: 1px solid #e8f0e6; margin: 1.5rem 0;" />
        <p style="color: #8a9987; font-size: 0.75rem; text-align: center;">Tahi Studio Dashboard</p>
      </div>`,
    })

    return NextResponse.json({ success: true, sentTo: contact.email })
  } catch (err) {
    console.error('Failed to send welcome email:', err)
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    )
  }
}
