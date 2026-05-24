/**
 * POST /api/admin/ai-reply-drafts/[id]/send
 *
 * Fires the draft via Resend, flips status to 'sent', stamps sentAt
 * + resendMessageId, writes a lead_reply_sent activity.
 *
 * Requires RESEND_API_KEY env var. The from-address comes from the
 * settings key 'leads.replyFromEmail' (or falls back to a noreply
 * default).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

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
  if (!draft.leadId) {
    return NextResponse.json({ error: 'Draft is not attached to a lead' }, { status: 400 })
  }

  // Pull the lead (need email + name)
  const [lead] = await database
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, draft.leadId))
    .limit(1)
  if (!lead || !lead.email) {
    return NextResponse.json({ error: 'Lead missing or has no email' }, { status: 400 })
  }

  // Resolve the from-address (settings → fallback)
  const [fromSetting] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'leads.replyFromEmail'))
    .limit(1)
  const fromEmail = fromSetting?.value?.trim() || 'liam@tahi.studio'

  const subject = (draft.finalSubject ?? draft.aiDraftSubject ?? '').trim() || `Re: ${lead.name}`
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
        to: [lead.email],
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

  // Detect whether Liam edited the AI version — informs the tone log
  const wasEdited = (
    (draft.finalSubject ?? draft.aiDraftSubject) !== draft.aiDraftSubject
    || (draft.finalBody ?? draft.aiDraftBody) !== draft.aiDraftBody
  )

  // Activity stamp
  await database.insert(schema.activities).values({
    id: crypto.randomUUID(),
    type: 'lead_reply_sent',
    title: `First reply sent to ${lead.email}`,
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

  return NextResponse.json({
    ok: true,
    resendMessageId: resendId,
    wasEdited,
  })
}
