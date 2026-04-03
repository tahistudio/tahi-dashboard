import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

type Params = { params: Promise<{ id: string }> }

// POST /api/admin/invoices/[id]/send-email
// Sends an invoice notification email to the client's primary contact via Resend.
export async function POST(req: NextRequest, { params }: Params) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const database = await db()
  const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

  // Fetch invoice with org name
  const [invoiceRow] = await drizzle
    .select({
      id: schema.invoices.id,
      orgId: schema.invoices.orgId,
      orgName: schema.organisations.name,
      status: schema.invoices.status,
      totalUsd: schema.invoices.totalUsd,
      currency: schema.invoices.currency,
      notes: schema.invoices.notes,
      dueDate: schema.invoices.dueDate,
      createdAt: schema.invoices.createdAt,
    })
    .from(schema.invoices)
    .leftJoin(schema.organisations, eq(schema.invoices.orgId, schema.organisations.id))
    .where(eq(schema.invoices.id, id))
    .limit(1)

  if (!invoiceRow) {
    return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
  }

  // Find primary contact for this org
  const [contact] = await drizzle
    .select({ email: schema.contacts.email, name: schema.contacts.name })
    .from(schema.contacts)
    .where(eq(schema.contacts.orgId, invoiceRow.orgId))
    .orderBy(schema.contacts.isPrimary)
    .limit(1)

  if (!contact?.email) {
    return NextResponse.json(
      { error: 'No contact found for this client' },
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
  const invoiceUrl = `${portalUrl}/invoices/${invoiceRow.id}`
  const formattedTotal = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: invoiceRow.currency ?? 'USD',
  }).format(invoiceRow.totalUsd)
  const dueDateDisplay = invoiceRow.dueDate
    ? new Date(invoiceRow.dueDate).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'On receipt'

  const invoiceNumber = invoiceRow.id.slice(0, 8).toUpperCase()

  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)

    await resend.emails.send({
      from: 'Tahi Studio <notifications@tahistudio.com>',
      to: contact.email,
      subject: `Invoice #${invoiceNumber} from Tahi Studio`,
      html: `<div style="font-family: Manrope, -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 2rem; background: #ffffff;">
        <div style="text-align: center; margin-bottom: 2rem;">
          <h1 style="color: #5A824E; font-size: 1.5rem; margin: 0;">Tahi Studio</h1>
        </div>
        <h2 style="color: #121A0F; font-size: 1.25rem; margin-bottom: 0.5rem;">Invoice #${invoiceNumber}</h2>
        <p style="color: #5a6657; font-size: 0.9375rem; line-height: 1.6; margin-bottom: 1.5rem;">
          Hi ${contact.name},<br /><br />
          A new invoice has been generated for your account.
        </p>
        <div style="background: #f7f9f6; border: 1px solid #e8f0e6; border-radius: 8px; padding: 1.25rem; margin-bottom: 1.5rem;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="color: #8a9987; font-size: 0.8125rem; padding: 0.25rem 0;">Amount</td>
              <td style="color: #121A0F; font-size: 0.9375rem; font-weight: 600; text-align: right;">${formattedTotal}</td>
            </tr>
            <tr>
              <td style="color: #8a9987; font-size: 0.8125rem; padding: 0.25rem 0;">Due Date</td>
              <td style="color: #121A0F; font-size: 0.9375rem; text-align: right;">${dueDateDisplay}</td>
            </tr>
            ${invoiceRow.notes ? `<tr>
              <td style="color: #8a9987; font-size: 0.8125rem; padding: 0.25rem 0;">Description</td>
              <td style="color: #121A0F; font-size: 0.9375rem; text-align: right;">${invoiceRow.notes}</td>
            </tr>` : ''}
          </table>
        </div>
        <div style="text-align: center; margin-bottom: 2rem;">
          <a href="${invoiceUrl}" style="display: inline-block; background: #5A824E; color: #ffffff; text-decoration: none; padding: 0.75rem 2rem; border-radius: 0 16px 0 16px; font-weight: 600; font-size: 0.9375rem;">View Invoice</a>
        </div>
        <hr style="border: none; border-top: 1px solid #e8f0e6; margin: 1.5rem 0;" />
        <p style="color: #8a9987; font-size: 0.75rem; text-align: center;">Tahi Studio Dashboard</p>
      </div>`,
    })

    // Update invoice status to sent and record sentAt timestamp
    const now = new Date().toISOString()
    await drizzle
      .update(schema.invoices)
      .set({ status: 'sent', sentAt: now, updatedAt: now })
      .where(eq(schema.invoices.id, id))

    return NextResponse.json({ success: true, sentTo: contact.email })
  } catch (err) {
    console.error('Failed to send invoice email:', err)
    return NextResponse.json(
      { error: 'Failed to send email' },
      { status: 500 }
    )
  }
}
