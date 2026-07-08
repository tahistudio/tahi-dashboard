import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { callXeroAPI } from '@/lib/xero'
import { emitDomainEvent } from '@/lib/events'
import { notifyAllAdmins } from '@/lib/notifications'

/**
 * POST /api/webhooks/xero
 *
 * Xero webhook receiver (Phase 11). Implements Xero's two-part protocol:
 *
 * 1. Intent-to-receive handshake. When you register or update a webhook in the
 *    Xero developer portal, Xero POSTs a payload signed with an
 *    `x-xero-signature` header (base64 HMAC-SHA256 of the RAW request body,
 *    keyed with XERO_WEBHOOK_KEY). We must recompute the signature over the raw
 *    bytes and reply 200 with an EMPTY body when it matches, 401 with an EMPTY
 *    body when it does not. Xero only marks the webhook "OK" once it sees both a
 *    correct 200 for a valid signature and a correct 401 for a tampered one.
 *    Every real event delivery is signed the same way, so the single signature
 *    gate below covers both the handshake and live events.
 *
 * 2. Event processing. For INVOICE / UPDATE events we fetch the authoritative
 *    invoice from Xero and reconcile the matching local invoices row (matched by
 *    `xeroInvoiceId`): sync status + amounts, fire `invoice_paid` when it flips
 *    to paid, and notify admins in-app.
 *
 * The reconcile runs on `ctx.waitUntil` so we always answer Xero inside its
 * short delivery timeout (the fetch/DB work continues after the response is
 * flushed). Reconciliation is idempotent: re-delivering the same event just
 * re-writes the same status, and `invoice_paid` only fires on an actual
 * not-paid -> paid transition.
 *
 * HITL: this only mirrors payment status FROM the accounting source of truth
 * (bookkeeping, not an AI action). It never sends any external email and never
 * charges or deletes anything.
 *
 * Config / env:
 *   XERO_WEBHOOK_KEY  - the webhook signing key from the Xero developer portal
 *                       (Webhooks tab of the app). Required; without it we cannot
 *                       verify signatures and every delivery is rejected 401.
 *   XERO_CLIENT_ID / XERO_CLIENT_SECRET / XERO_TENANT_ID - reused via lib/xero
 *                       to fetch the invoice during reconcile.
 *   Register the delivery URL `https://<host>/api/webhooks/xero` under the
 *   "Invoices" event in the Xero app's Webhooks tab, then hit "Send intent to
 *   receive" - it will call this endpoint and expect the 200/401 behaviour above.
 */

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface XeroWebhookEvent {
  resourceUrl?: string
  resourceId?: string
  eventDateUtc?: string
  eventType?: string
  eventCategory?: string
  tenantId?: string
  tenantType?: string
}

interface XeroWebhookPayload {
  events?: XeroWebhookEvent[]
  lastEventSequence?: number
  firstEventSequence?: number
  entropy?: string
}

interface XeroInvoice {
  InvoiceID: string
  InvoiceNumber?: string
  Type?: string
  Status?: string
  SubTotal?: number
  Total?: number
  AmountDue?: number
  AmountPaid?: number
  CurrencyCode?: string
  FullyPaidOnDate?: string
}

interface XeroInvoicesResponse {
  Invoices?: XeroInvoice[]
}

// Empty-body responses Xero expects from the signature gate.
const OK_EMPTY = () => new Response('', { status: 200 })
const UNAUTHORIZED_EMPTY = () => new Response('', { status: 401 })

/**
 * Recompute Xero's signature: base64( HMAC-SHA256( rawBody, XERO_WEBHOOK_KEY ) ).
 * Web Crypto only (Workers runtime has no Node `crypto`).
 */
async function computeSignature(rawBody: string, key: string): Promise<string> {
  const enc = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(rawBody))
  const bytes = new Uint8Array(sigBuf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

/** Length-safe constant-time string comparison. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Map a Xero invoice status/amounts to a local invoices.status value.
 * Local enum: draft | sent | viewed | paid | overdue | written_off (no
 * dedicated "partially paid" value, so a partial payment stays "sent" while
 * its amounts are still reconciled to the Xero figures).
 */
function mapStatus(inv: XeroInvoice): string {
  switch (inv.Status) {
    case 'PAID':
      return 'paid'
    case 'AUTHORISED':
    case 'SUBMITTED':
      // Fully settled invoices sometimes report AmountDue 0 while lagging on
      // the PAID flag; treat a zero balance on a positive total as paid.
      if ((inv.Total ?? 0) > 0 && (inv.AmountDue ?? inv.Total ?? 0) <= 0) return 'paid'
      return 'sent'
    case 'VOIDED':
    case 'DELETED':
      return 'written_off'
    case 'DRAFT':
      return 'draft'
    default:
      return 'sent'
  }
}

/**
 * Reconcile every INVOICE/UPDATE event in a payload against local invoices.
 * Runs after the HTTP response is flushed (via ctx.waitUntil). Best-effort:
 * never throws.
 */
async function reconcilePayload(payload: XeroWebhookPayload): Promise<void> {
  const events = payload.events ?? []

  // Dedup within this payload: one reconcile per invoice id even if Xero
  // batches several UPDATE events for the same resource.
  const invoiceIds = new Set<string>()
  for (const ev of events) {
    if (ev.eventCategory === 'INVOICE' && ev.eventType === 'UPDATE' && ev.resourceId) {
      invoiceIds.add(ev.resourceId)
    }
  }
  if (invoiceIds.size === 0) return

  const database = (await db()) as unknown as D1
  const now = new Date().toISOString()

  for (const xeroInvoiceId of invoiceIds) {
    try {
      // Pull the authoritative invoice from Xero (token/tenant plumbing reused
      // from lib/xero). callXeroAPI returns null on any failure.
      const res = await callXeroAPI<XeroInvoicesResponse>(
        'GET',
        `/Invoices/${xeroInvoiceId}`,
      )
      const inv = res?.Invoices?.[0]
      if (!inv) continue

      // Only reconcile receivable invoices (ACCREC). Skip bills (ACCPAY).
      if (inv.Type && inv.Type !== 'ACCREC') continue

      const [local] = await database
        .select({
          id: schema.invoices.id,
          orgId: schema.invoices.orgId,
          status: schema.invoices.status,
        })
        .from(schema.invoices)
        .where(eq(schema.invoices.xeroInvoiceId, xeroInvoiceId))
        .limit(1)

      // No local row for this Xero invoice: nothing to reconcile. (Import is a
      // separate, admin-triggered flow; we never auto-create here.)
      if (!local) continue

      const newStatus = mapStatus(inv)
      const flippedToPaid = newStatus === 'paid' && local.status !== 'paid'

      const updates: Record<string, unknown> = {
        status: newStatus,
        lastReconciledAt: now,
        updatedAt: now,
      }
      if (typeof inv.SubTotal === 'number') updates.amountUsd = inv.SubTotal
      if (typeof inv.Total === 'number') updates.totalUsd = inv.Total
      if (inv.CurrencyCode) updates.currency = inv.CurrencyCode
      if (newStatus === 'paid') {
        updates.paidAt = inv.FullyPaidOnDate ?? now
      }

      await database
        .update(schema.invoices)
        .set(updates)
        .where(eq(schema.invoices.id, local.id))

      if (flippedToPaid) {
        // Domain event: automations + outgoing webhooks. Never throws.
        await emitDomainEvent(database, {
          type: 'invoice_paid',
          entityId: local.id,
          entityType: 'invoice',
          orgId: local.orgId ?? null,
          data: { status: 'paid', source: 'xero', xeroInvoiceId },
        })

        // In-app ping to the whole team. No external email (HITL).
        await notifyAllAdmins(database, {
          type: 'invoice_paid',
          title: `Invoice paid${inv.InvoiceNumber ? `: ${inv.InvoiceNumber}` : ''}`,
          body: 'Marked paid from Xero reconciliation.',
          entityType: 'invoice',
          entityId: local.id,
        })
      }
    } catch (err) {
      // One bad invoice must not stop the rest of the batch.
      console.error('[xero-webhook] reconcile failed for', xeroInvoiceId, err instanceof Error ? err.message : err)
    }
  }
}

export async function POST(req: Request): Promise<Response> {
  // Read the RAW body BEFORE any parsing - the signature is over raw bytes.
  const rawBody = await req.text()

  const provided = req.headers.get('x-xero-signature')
  const key = process.env.XERO_WEBHOOK_KEY

  // Without a signing key we cannot verify anything: reject (empty 401).
  if (!key) {
    console.error('[xero-webhook] XERO_WEBHOOK_KEY not configured; rejecting delivery')
    return UNAUTHORIZED_EMPTY()
  }
  if (!provided) return UNAUTHORIZED_EMPTY()

  let expected: string
  try {
    expected = await computeSignature(rawBody, key)
  } catch (err) {
    console.error('[xero-webhook] signature computation failed:', err instanceof Error ? err.message : err)
    return UNAUTHORIZED_EMPTY()
  }

  if (!timingSafeEqual(provided, expected)) {
    // Tampered / unsigned delivery, or the intent-to-receive negative test.
    return UNAUTHORIZED_EMPTY()
  }

  // Signature valid. Parse the payload (empty/handshake payloads are fine).
  let payload: XeroWebhookPayload = {}
  if (rawBody) {
    try {
      payload = JSON.parse(rawBody) as XeroWebhookPayload
    } catch {
      // Valid signature but unparseable body: still a "received" 200 so Xero
      // does not retry a malformed delivery forever. Nothing to reconcile.
      return OK_EMPTY()
    }
  }

  // Schedule reconcile off the response path so we answer inside Xero's timeout.
  if ((payload.events?.length ?? 0) > 0) {
    const work = reconcilePayload(payload).catch((err) => {
      console.error('[xero-webhook] reconcile task failed:', err instanceof Error ? err.message : err)
    })
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare')
      const cfCtx = await getCloudflareContext({ async: true })
      if (cfCtx?.ctx?.waitUntil) {
        cfCtx.ctx.waitUntil(work)
      } else {
        void work
      }
    } catch {
      // No execution context (local dev): let it run detached.
      void work
    }
  }

  // Handshake + every valid event delivery: 200 with an empty body.
  return OK_EMPTY()
}
