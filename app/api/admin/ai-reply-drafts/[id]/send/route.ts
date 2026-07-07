/**
 * POST /api/admin/ai-reply-drafts/[id]/send
 *
 * Fires the draft via Resend, flips status to 'sent', stamps sentAt
 * + resendMessageId, writes an activity.
 *
 * Handles two kinds of draft that share the ai_reply_drafts table:
 *   - Lead first-reply drafts (draft.leadId set): recipient = the lead,
 *     writes a lead_reply_sent activity, auto-advances new -> qualifying.
 *   - Overdue-invoice chase drafts (draft.invoiceId set): recipient = the
 *     client org's PRIMARY contact (desc isPrimary), writes an
 *     invoice_chase_sent activity, leaves invoice status untouched.
 *
 * The send is always an explicit human click (never automatic, never
 * chained from drafting). Requires RESEND_API_KEY. The from-address comes
 * from the settings key 'leads.replyFromEmail' (or a fallback default).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq } from 'drizzle-orm'

function invoiceNumber(id: string): string {
  return `INV-${id.slice(0, 6).toUpperCase()}`
}

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 })
  }

  const { id } = await params
  const database = await db()

  const [draft] = await database
    .select()
    .from(schema.aiReplyDrafts)
    .where(eq(schema.aiReplyDrafts.id, id))
    .limit(1)
  if (!draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }
  if (draft.status !== 'pending') {
    return NextResponse.json({ error: `Draft is ${draft.status}, not pending` }, { status: 409 })
  }
  if (!draft.leadId && !draft.invoiceId) {
    return NextResponse.json({ error: 'Draft is not attached to a lead or invoice' }, { status: 400 })
  }

  // Resolve the recipient depending on the draft kind. Lead drafts go to
  // the lead; invoice chase drafts go to the client org's primary contact.
  let recipientEmail: string
  let recipientName: string
  let lead: typeof schema.leads.$inferSelect | null = null
  let chaseOrgId: string | null = null
  let chaseContactId: string | null = null
  let subjectFallback: string

  if (draft.leadId) {
    const [leadRow] = await database
      .select()
      .from(schema.leads)
      .where(eq(schema.leads.id, draft.leadId))
      .limit(1)
    if (!leadRow || !leadRow.email) {
      return NextResponse.json({ error: 'Lead missing or has no email' }, { status: 400 })
    }
    lead = leadRow
    recipientEmail = leadRow.email
    recipientName = leadRow.name
    subjectFallback = `Re: ${leadRow.name}`
  } else {
    // Invoice chase draft - recipient is the org's primary contact.
    const [invoice] = await database
      .select({ id: schema.invoices.id, orgId: schema.invoices.orgId })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, draft.invoiceId as string))
      .limit(1)
    if (!invoice) {
      return NextResponse.json({ error: 'Invoice not found for this draft' }, { status: 400 })
    }
    const [primaryContact] = await database
      .select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, invoice.orgId))
      .orderBy(desc(schema.contacts.isPrimary))
      .limit(1)
    if (!primaryContact || !primaryContact.email) {
      return NextResponse.json({ error: 'Client has no contact with an email' }, { status: 400 })
    }
    recipientEmail = primaryContact.email
    recipientName = primaryContact.name
    chaseOrgId = invoice.orgId
    chaseContactId = primaryContact.id
    subjectFallback = `Invoice ${invoiceNumber(invoice.id)}`
  }

  // Resolve the from-address (settings → fallback)
  const [fromSetting] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'leads.replyFromEmail'))
    .limit(1)
  const fromEmail = fromSetting?.value?.trim() || 'liam@tahi.studio'

  const subject = (draft.finalSubject ?? draft.aiDraftSubject ?? '').trim() || subjectFallback
  const bodyText = (draft.finalBody ?? draft.aiDraftBody ?? '').trim()
  if (!bodyText) {
    return NextResponse.json({ error: 'Draft body is empty' }, { status: 400 })
  }

  // Convert plain-text paragraphs to a minimal HTML so the email
  // renders cleanly across clients. Keep line breaks; wrap paragraphs.
  const htmlBody = bodyText
    .split(/\n\s*\n/)
    .map(p => `<p>${p.replace(/\n/g, '<br>').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('\n')

  // Fire Resend
  let resendId: string | null = null
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Liam Miller <${fromEmail}>`,
        to: [recipientEmail],
        subject,
        html: htmlBody,
        text: bodyText,
      }),
    })
    const data = await res.json() as { id?: string; message?: string }
    if (!res.ok) {
      return NextResponse.json({
        error: 'Resend send failed',
        detail: data.message ?? `HTTP ${res.status}`,
      }, { status: 502 })
    }
    resendId = data.id ?? null
  } catch (err) {
    return NextResponse.json({
      error: 'Resend send failed',
      detail: err instanceof Error ? err.message : String(err),
    }, { status: 502 })
  }

  const now = new Date().toISOString()

  // Mark draft sent
  await database
    .update(schema.aiReplyDrafts)
    .set({
      status: 'sent',
      sentAt: now,
      resendMessageId: resendId,
      finalSubject: subject,
      finalBody: bodyText,
      updatedAt: now,
    })
    .where(eq(schema.aiReplyDrafts.id, id))

  // Detect whether Liam edited the AI version before sending.
  const wasEdited = (
    (draft.finalSubject ?? draft.aiDraftSubject) !== draft.aiDraftSubject
    || (draft.finalBody ?? draft.aiDraftBody) !== draft.aiDraftBody
  )

  if (lead && draft.leadId) {
    // Lead first-reply activity + auto-advance.
    await database.insert(schema.activities).values({
      id: crypto.randomUUID(),
      type: 'lead_reply_sent',
      title: `First reply sent to ${recipientEmail}`,
      description: wasEdited
        ? `Liam edited the AI draft before sending.`
        : `AI draft sent as-is.`,
      leadId: draft.leadId,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
    })

    // Auto-status: if the lead was 'new', flip to 'qualifying' (we've
    // engaged). If 'qualifying' or higher, leave it.
    if (lead.status === 'new') {
      await database
        .update(schema.leads)
        .set({ status: 'qualifying', updatedAt: now })
        .where(eq(schema.leads.id, lead.id))
      await database.insert(schema.activities).values({
        id: crypto.randomUUID(),
        type: 'lead_status_changed',
        title: 'Status changed: New → Qualifying (auto, on first reply)',
        description: null,
        leadId: lead.id,
        createdById: 'system',
        createdAt: now,
        updatedAt: now,
      })
    }
  } else if (draft.invoiceId) {
    // Invoice chase activity. Deliberately does NOT change invoice status -
    // a chase is a nudge, not a state transition.
    await database.insert(schema.activities).values({
      id: crypto.randomUUID(),
      type: 'invoice_chase_sent',
      title: `Overdue-invoice chase sent to ${recipientEmail} (${invoiceNumber(draft.invoiceId)})`,
      description: wasEdited
        ? `Liam edited the AI draft before sending.`
        : `AI draft sent as-is.`,
      orgId: chaseOrgId,
      contactId: chaseContactId,
      createdById: userId,
      createdAt: now,
      updatedAt: now,
    })
  }

  return NextResponse.json({
    ok: true,
    resendMessageId: resendId,
    wasEdited,
    recipientEmail,
    recipientName,
  })
}
