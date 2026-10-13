import { NextRequest, NextResponse } from 'next/server'
import { and, eq, or, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { resolvePermissions } from '@/lib/permissions'
import { stripeSecretKey } from '@/lib/stripe-key'
import { importStripeInvoice, type StripeInvoiceLike } from '@/lib/stripe-import'
import { logAudit } from '@/lib/audit'

// Recover a known invoice into an EXISTING client. No Stripe writes or email.
// The preview is the default; application re-fetches Stripe and every conflict.
export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const database = await db()
  const access = await resolvePermissions(database, auth)
  if (!access.isSuperAdmin) return NextResponse.json({ error: 'Recovery requires a super admin.' }, { status: 403 })
  const body = await req.json().catch(() => null) as { orgId?: unknown; stripeInvoiceId?: unknown; dryRun?: unknown; previewKey?: unknown } | null
  if (!body || typeof body.orgId !== 'string' || typeof body.stripeInvoiceId !== 'string' || !/^in_[A-Za-z0-9]+$/.test(body.stripeInvoiceId)) {
    return NextResponse.json({ error: 'Choose an existing client and a Stripe invoice id beginning in_.' }, { status: 400 })
  }
  const key = stripeSecretKey()
  if (!key) return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 })
  const [org] = await database.select().from(schema.organisations).where(eq(schema.organisations.id, body.orgId)).limit(1)
  if (!org || org.status === 'archived') return NextResponse.json({ error: 'Choose an active existing client.' }, { status: 404 })
  let inv: StripeInvoiceLike & { livemode?: boolean; customer_email?: string | null }
  try {
    const signal = AbortSignal.timeout(15_000)
    const read = async (path: string) => {
      const response = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${key}` }, signal })
      if (!response.ok) throw new Error(`Stripe could not retrieve this invoice (${response.status}). The configured key is ${key.startsWith('sk_test_') || key.startsWith('rk_test_') ? 'test mode' : 'live mode'}; check the account and mode.`)
      return response.json()
    }
    inv = await read(`invoices/${encodeURIComponent(body.stripeInvoiceId)}`) as typeof inv
    // An invoice response embeds only its first page of lines. Never recover
    // a complete paid total alongside a silently truncated set of items.
    if (inv.lines?.has_more) {
      const lines: NonNullable<StripeInvoiceLike['lines']>['data'] = []
      let cursor = ''
      for (let page = 0; ; page++) {
        if (page >= 20) throw new Error('This invoice has too many line items for recovery. No invoice was imported.')
        const data = await read(`invoices/${encodeURIComponent(inv.id)}/lines?limit=100${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ''}`) as NonNullable<StripeInvoiceLike['lines']>
        lines.push(...(data.data ?? []))
        if (!data.has_more) break
        cursor = data.data?.at(-1)?.id ?? ''
        if (!cursor) throw new Error('Stripe did not return a line cursor. No invoice was imported.')
      }
      inv.lines = { data: lines, has_more: false }
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'Stripe timed out. No invoice was imported; preview again.' }, { status: 502 })
  }
  if (inv.id !== body.stripeInvoiceId || typeof inv.customer !== 'string' || !inv.customer || inv.status !== 'paid' || !inv.livemode) {
    return NextResponse.json({ error: 'Recovery accepts paid live invoices with a Stripe customer only.' }, { status: 400 })
  }
  const contacts = await database.select({ name: schema.contacts.name, email: schema.contacts.email }).from(schema.contacts).where(eq(schema.contacts.orgId, org.id))
  const emailMatch = !!inv.customer_email && contacts.some(c => c.email?.trim().toLowerCase() === inv.customer_email?.trim().toLowerCase())
  const linked = await database.select({ id: schema.organisations.id }).from(schema.organisations).where(eq(schema.organisations.stripeCustomerId, inv.customer))
  const existing = await database.select().from(schema.invoices).where(or(eq(schema.invoices.stripeInvoiceId, inv.id), eq(schema.invoices.orgId, org.id)))
  const exact = existing.find(i => i.stripeInvoiceId === inv.id)
  const possibleTwins = existing.filter(i => i.stripeInvoiceId !== inv.id && i.orgId === org.id && Math.abs(i.totalUsd - (inv.total ?? 0) / 100) < 0.005 && i.currency?.toUpperCase() === inv.currency?.toUpperCase())
  const conflicts = [
    ...(!emailMatch ? ['The Stripe invoice email does not match an existing client contact.'] : []),
    ...(org.stripeCustomerId && org.stripeCustomerId !== inv.customer ? ['This client is linked to a different Stripe customer.'] : []),
    ...(linked.some(o => o.id !== org.id) ? ['This Stripe customer is linked to another client.'] : []),
    ...(exact && exact.orgId !== org.id ? ['This invoice is already attached to another client.'] : []),
    ...(!exact && possibleTwins.length ? ['Existing invoices with the same amount and currency need a duplicate review.'] : []),
  ]
  const preview = {
    dryRun: true, canApply: conflicts.length === 0, conflicts,
    client: { id: org.id, name: org.name, contacts },
    invoice: { id: inv.id, number: inv.number, customerId: inv.customer, customerName: inv.customer_name, customerEmail: inv.customer_email, total: (inv.total ?? 0) / 100, currency: inv.currency?.toUpperCase(), status: inv.status, paidAt: inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString() : null },
    existingInvoiceId: exact?.id ?? null,
    possibleTwins: possibleTwins.map(i => ({ id: i.id, number: i.number, status: i.status })),
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ preview, stripe: inv, linked: linked.map(o => o.id).sort() })))
  const previewKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  if (body.dryRun !== false) return NextResponse.json({ ...preview, previewKey })
  if (conflicts.length) return NextResponse.json({ ...preview, error: 'Recovery blocked by the identity or duplicate checks.' }, { status: 409 })
  if (body.previewKey !== previewKey) return NextResponse.json({ error: 'The invoice or client changed, or no preview was supplied. Preview the recovery again.' }, { status: 409 })

  // Check both sides in SQL so an intervening link cannot claim the same
  // customer for two clients or overwrite the chosen client's mapping.
  const mapped = await database.update(schema.organisations).set({ stripeCustomerId: inv.customer, updatedAt: new Date().toISOString() }).where(and(
    eq(schema.organisations.id, org.id),
    org.stripeCustomerId ? eq(schema.organisations.stripeCustomerId, org.stripeCustomerId) : isNull(schema.organisations.stripeCustomerId),
    sql`NOT EXISTS (SELECT 1 FROM organisations AS linked WHERE linked.stripe_customer_id = ${inv.customer} AND linked.id <> ${org.id})`,
  )).returning({ id: schema.organisations.id })
  if (!mapped.length) return NextResponse.json({ error: 'The client link changed. Preview the recovery again.' }, { status: 409 })
  const result = await importStripeInvoice(database, inv, { autoCreateOrg: false, expectedOrgId: org.id })
  if ('skipped' in result) return NextResponse.json({ error: result.reason }, { status: 409 })
  if (result.orgId !== org.id) {
    return NextResponse.json({ error: 'This invoice is attached to another client. Preview the recovery again.' }, { status: 409 })
  }
  await logAudit(database, { action: 'stripe_invoice_recovered', userId: auth.userId, entityType: 'invoice', entityId: result.localInvoiceId, metadata: { orgId: org.id, stripeInvoiceId: inv.id, stripeCustomerId: inv.customer, created: result.created } })
  return NextResponse.json({ ...preview, dryRun: false, result })
}
