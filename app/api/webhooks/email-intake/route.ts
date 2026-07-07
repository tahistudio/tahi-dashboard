/**
 * POST /api/webhooks/email-intake
 *
 * Inbound email -> DRAFT request (or LEAD) intake. The receiving half of the
 * "email-to-request" pipeline: a client emails a monitored inbox, the provider
 * forwards the parsed message here as JSON, and we turn it into a triageable
 * record for a human. We never auto-reply, never charge, never delete
 * (human-in-the-loop).
 *
 * ── Required env ──────────────────────────────────────────────────────────────
 *   EMAIL_INTAKE_SECRET   Shared secret. Every request must present it, either
 *                         as `x-email-intake-secret: <secret>` or
 *                         `authorization: Bearer <secret>`. Missing env -> 500;
 *                         missing/wrong header -> 401.
 *
 * ── Provider setup (either works) ─────────────────────────────────────────────
 *   Resend inbound routing:
 *     - Point an inbound domain / address at this endpoint's URL.
 *     - Resend POSTs JSON. We accept both the flat shape and the enveloped
 *       `{ type: 'email.received', data: { from, to, subject, text, html } }`.
 *     - Add the shared secret as a custom header on the route (or via a query
 *       string proxy) so this endpoint can authenticate the call.
 *   Cloudflare Email Workers:
 *     - In your email worker, parse the message and POST JSON to this URL with
 *       `{ from, to, subject, text, html }` plus the `x-email-intake-secret`
 *       header. (Email Workers deliver a raw message event, not JSON, so the
 *       small forwarding worker does the parse.)
 *
 * The JSON parser is deliberately tolerant: `from`/`to` may be a plain string
 * ("Name <a@b.com>"), an object ({ address, name } / { email }), or an array of
 * those; subject/text/html may live at the top level or under `data`.
 *
 * ── Behaviour ─────────────────────────────────────────────────────────────────
 *   1. Authenticate via the shared secret header.
 *   2. Resolve the sender address against contacts.email (case-insensitive):
 *        matched   -> create a request under that contact's org, status
 *                     'submitted', with a "via email" marker in formResponses
 *                     and submittedBy set to the contact. Fires request_created.
 *        unmatched -> create a LEAD (source 'email') so the mail is never
 *                     dropped, and notify admins.
 *   3. Notify all Tahi admins in-app either way. No email is ever sent back to
 *      the sender (human-in-the-loop triage).
 */

import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { sanitizeRichText } from '@/lib/sanitize-rich-text'
import { lookupOrCreatePerson } from '@/lib/people'
import { dispatchDomainEvent } from '@/lib/events'
import { notifyAllAdmins } from '@/lib/notifications'

// Prevent build-time static analysis (env vars unavailable on Webflow Cloud).
export const dynamic = 'force-dynamic'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

// ── Tolerant address parsing ─────────────────────────────────────────────────
// Providers hand us `from`/`to` as a string, an object, or an array of either.

type AddressLike =
  | string
  | { address?: string | null; email?: string | null; name?: string | null }
  | Array<string | { address?: string | null; email?: string | null; name?: string | null }>
  | null
  | undefined

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null
  return Array.isArray(v) ? (v.length > 0 ? v[0] : null) : v
}

/** Pull a bare email address out of any of the accepted shapes. */
function extractEmail(input: AddressLike): string | null {
  const one = firstOf(input as unknown)
  if (one == null) return null
  if (typeof one === 'string') {
    // "Display Name <user@host>" or a bare "user@host".
    const angle = one.match(/<([^>]+)>/)
    const candidate = (angle ? angle[1] : one).trim()
    return candidate.includes('@') ? candidate.toLowerCase() : null
  }
  const obj = one as { address?: string | null; email?: string | null }
  const val = (obj.address ?? obj.email ?? '').trim()
  return val.includes('@') ? val.toLowerCase() : null
}

/** Best-effort display name for the sender; falls back to the local part. */
function extractName(input: AddressLike, email: string | null): string {
  const one = firstOf(input as unknown)
  if (typeof one === 'string') {
    const angle = one.match(/^\s*"?([^"<]+?)"?\s*</)
    if (angle && angle[1].trim()) return angle[1].trim()
  } else if (one && typeof one === 'object') {
    const nm = (one as { name?: string | null }).name
    if (nm && nm.trim()) return nm.trim()
  }
  if (email) return email.split('@')[0]
  return 'Email sender'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Build safe description HTML from the email body (prefers html, else text). */
function buildDescription(html: string | null, text: string | null): string | null {
  if (html && html.trim()) return sanitizeRichText(html)
  if (text && text.trim()) {
    const paras = text
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
      .join('')
    return sanitizeRichText(paras)
  }
  return null
}

// ── Auth ─────────────────────────────────────────────────────────────────────

/** Length-safe constant-time string comparison (mirrors the Xero webhook). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function isAuthorised(req: NextRequest): { ok: boolean; configured: boolean } {
  const secret = process.env.EMAIL_INTAKE_SECRET
  if (!secret) return { ok: false, configured: false }
  const headerSecret = req.headers.get('x-email-intake-secret')
  const auth = req.headers.get('authorization')
  const bearer = auth?.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : null
  const presented = headerSecret ?? bearer
  return { ok: presented != null && timingSafeEqual(presented, secret), configured: true }
}

interface InboundPayload {
  from?: AddressLike
  to?: AddressLike
  subject?: string | null
  text?: string | null
  html?: string | null
}

/** Accept the flat shape or the enveloped `{ data: {...} }` shape. */
function normalisePayload(raw: unknown): InboundPayload {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const data =
    obj.data && typeof obj.data === 'object'
      ? (obj.data as Record<string, unknown>)
      : obj
  return {
    from: (data.from ?? data.sender) as AddressLike,
    to: (data.to ?? data.recipient) as AddressLike,
    subject: (data.subject as string | null) ?? null,
    text: (data.text as string | null) ?? (data.plain as string | null) ?? null,
    html: (data.html as string | null) ?? null,
  }
}

async function resolveDefaultLeadOwner(database: DrizzleDB): Promise<string | null> {
  try {
    const [setting] = await database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
      .limit(1)
    if (!setting?.value) return null
    const [member] = await database
      .select({ id: schema.teamMembers.id })
      .from(schema.teamMembers)
      .where(eq(schema.teamMembers.id, setting.value))
      .limit(1)
    return member?.id ?? null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const authz = isAuthorised(req)
  if (!authz.configured) {
    return NextResponse.json({ error: 'Email intake not configured' }, { status: 500 })
  }
  if (!authz.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: InboundPayload
  try {
    payload = normalisePayload(await req.json())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const fromEmail = extractEmail(payload.from)
  if (!fromEmail) {
    return NextResponse.json({ error: 'Missing sender address' }, { status: 400 })
  }
  const fromName = extractName(payload.from, fromEmail)
  const toEmail = extractEmail(payload.to)
  const subject = (payload.subject ?? '').trim() || 'Email request'
  const description = buildDescription(payload.html ?? null, payload.text ?? null)

  const database = (await db()) as DrizzleDB
  const now = new Date().toISOString()

  // ── Sender resolution: match against a known contact ──────────────────────
  // Case-insensitive email match. First match wins (a person can be a contact
  // at only one org in practice).
  const [contact] = await database
    .select({
      id: schema.contacts.id,
      orgId: schema.contacts.orgId,
      name: schema.contacts.name,
    })
    .from(schema.contacts)
    .where(sql`lower(${schema.contacts.email}) = ${fromEmail}`)
    .limit(1)

  // Marker recorded on both records so a human sees exactly where it came from.
  const intakeMarker = {
    _source: 'email',
    fromEmail,
    fromName,
    toEmail,
    subject,
    receivedAt: now,
  }

  if (contact) {
    // ── Matched contact -> DRAFT request under their org ────────────────────
    const id = crypto.randomUUID()
    const formResponses = JSON.stringify(intakeMarker)

    // Atomically assign the next request number (mirrors the portal route).
    await database.run(sql`
      INSERT INTO requests (
        id, org_id, title, type, category, description, form_responses,
        status, priority, submitted_by_id, submitted_by_type, is_internal,
        revision_count, max_revisions, request_number, created_at, updated_at
      ) VALUES (
        ${id},
        ${contact.orgId},
        ${subject},
        'small_task',
        'admin',
        ${description},
        ${formResponses},
        'submitted',
        'standard',
        ${contact.id},
        'contact',
        0,
        0,
        3,
        COALESCE((SELECT MAX(request_number) FROM requests), 0) + 1,
        ${now},
        ${now}
      )
    `)

    // Fan out to automations + outgoing webhooks (non-blocking).
    await dispatchDomainEvent(database, {
      type: 'request_created',
      entityId: id,
      entityType: 'request',
      orgId: contact.orgId,
      data: {
        title: subject,
        type: 'small_task',
        category: 'admin',
        status: 'submitted',
        isInternal: 0,
        source: 'email',
        fromEmail,
      },
    })

    // In-app ping for the internal team.
    await notifyAllAdmins(database, {
      type: 'request_created',
      title: `New request via email from ${contact.name}`,
      body: subject,
      entityType: 'request',
      entityId: id,
    })

    return NextResponse.json(
      { ok: true, kind: 'request', id, orgId: contact.orgId },
      { status: 201 },
    )
  }

  // ── Unmatched sender -> LEAD (never drop the mail) ────────────────────────
  const leadId = crypto.randomUUID()
  const ownerId = await resolveDefaultLeadOwner(database)
  const brief = (payload.text ?? '').trim() || subject

  try {
    const personId = await lookupOrCreatePerson(database, {
      fullName: fromName,
      email: fromEmail,
    })
    await database.insert(schema.leads).values({
      id: leadId,
      personId,
      name: fromName,
      email: fromEmail,
      source: 'email',
      sourceDetail: `Inbound email: ${subject}`,
      brief,
      status: 'new',
      currency: 'NZD',
      ownerId,
      createdAt: now,
      updatedAt: now,
    })
    await database.insert(schema.activities).values({
      id: crypto.randomUUID(),
      type: 'lead_created',
      title: `Lead via email: ${fromName}`,
      description: brief,
      leadId,
      // createdById is NOT NULL; this activity is system-generated (no human
      // caller), so fall back to the resolved owner or a stable sentinel.
      createdById: ownerId ?? 'system:email-intake',
      createdAt: now,
      updatedAt: now,
    })
  } catch (err) {
    console.error('[email-intake] failed to record lead', err)
    return NextResponse.json({ error: 'Could not record inbound email' }, { status: 500 })
  }

  // In-app ping so a human triages the new lead.
  await notifyAllAdmins(database, {
    type: 'lead_assigned',
    title: `New lead via email from ${fromName}`,
    body: subject,
    entityType: 'lead',
    entityId: leadId,
  })

  return NextResponse.json({ ok: true, kind: 'lead', id: leadId }, { status: 201 })
}
