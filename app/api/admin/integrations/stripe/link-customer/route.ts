import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { resolvePermissions } from '@/lib/permissions'
import { stripeSecretKey } from '@/lib/stripe-key'
import { attributedUserId } from '@/lib/mcp-actor'
import { logAudit } from '@/lib/audit'
import { signStripeCustomerLinkPreview, verifyStripeCustomerLinkPreview } from '@/lib/stripe-customer-link'

interface StripeCustomer {
  id: string
  name: string | null
  email: string | null
  livemode: boolean
  deleted?: boolean
}

export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!auth.userId || !isTahiAdmin(auth.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const database = await db()
  const access = await resolvePermissions(database, auth)
  if (!access.isSuperAdmin) return NextResponse.json({ error: 'Linking a Stripe customer requires a super admin.' }, { status: 403 })
  const body = await req.json().catch(() => null) as { orgId?: unknown; stripeCustomerId?: unknown; dryRun?: unknown; previewKey?: unknown } | null
  if (!body || typeof body.orgId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(body.orgId) || typeof body.stripeCustomerId !== 'string' || !/^cus_[A-Za-z0-9]{1,124}$/.test(body.stripeCustomerId)) {
    return NextResponse.json({ error: 'Choose an existing client and a Stripe customer id beginning cus_.' }, { status: 400 })
  }
  const key = stripeSecretKey()
  if (!key) return NextResponse.json({ error: 'Stripe is not configured.' }, { status: 503 })
  const [org] = await database.select({
    id: schema.organisations.id, name: schema.organisations.name, status: schema.organisations.status,
    stripeCustomerId: schema.organisations.stripeCustomerId, updatedAt: schema.organisations.updatedAt,
  }).from(schema.organisations).where(eq(schema.organisations.id, body.orgId)).limit(1)
  if (!org || org.status === 'archived') return NextResponse.json({ error: 'Choose an active existing client.' }, { status: 404 })

  let customer: StripeCustomer
  try {
    const response = await fetch(`https://api.stripe.com/v1/customers/${encodeURIComponent(body.stripeCustomerId)}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return NextResponse.json({ error: `Stripe could not retrieve this customer (${response.status}). Check the account and mode.` }, { status: 502 })
    const retrieved = await response.json() as Partial<StripeCustomer> | null
    if (!retrieved || retrieved.id !== body.stripeCustomerId || retrieved.deleted || retrieved.livemode !== true) {
      return NextResponse.json({ error: 'Choose an existing live Stripe customer.' }, { status: 400 })
    }
    customer = {
      id: retrieved.id,
      name: typeof retrieved.name === 'string' ? retrieved.name : null,
      email: typeof retrieved.email === 'string' ? retrieved.email : null,
      livemode: true,
    }
  } catch {
    return NextResponse.json({ error: 'Stripe could not be reached. No customer was linked; preview again.' }, { status: 502 })
  }

  const contacts = await database.select({ name: schema.contacts.name, email: schema.contacts.email }).from(schema.contacts)
    .where(eq(schema.contacts.orgId, org.id)).orderBy(schema.contacts.id)
  const linked = await database.select({ id: schema.organisations.id, name: schema.organisations.name }).from(schema.organisations)
    .where(eq(schema.organisations.stripeCustomerId, customer.id)).orderBy(schema.organisations.id)
  const conflicts = [
    ...(org.stripeCustomerId && org.stripeCustomerId !== customer.id ? ['This client is linked to a different Stripe customer.'] : []),
    ...(linked.some(client => client.id !== org.id) ? ['This Stripe customer is linked to another client.'] : []),
  ]
  const preview = {
    dryRun: true, canApply: conflicts.length === 0, conflicts,
    client: { id: org.id, name: org.name, stripeCustomerId: org.stripeCustomerId, contacts },
    customer: { id: customer.id, name: customer.name, email: customer.email, livemode: customer.livemode },
    linkedClients: linked,
    alreadyLinked: org.stripeCustomerId === customer.id,
  }
  const approvalState = { preview, clientStatus: org.status, clientUpdatedAt: org.updatedAt }
  if (body.dryRun !== false) {
    const previewKey = await signStripeCustomerLinkPreview(key, auth.userId, approvalState)
    return NextResponse.json({ ...preview, previewKey })
  }
  if (conflicts.length) return NextResponse.json({ ...preview, error: 'Linking blocked by the existing customer mappings.' }, { status: 409 })
  if (!await verifyStripeCustomerLinkPreview(key, auth.userId, approvalState, body.previewKey)) {
    return NextResponse.json({ error: 'The customer or client changed, or the preview expired. Preview the link again.' }, { status: 409 })
  }
  if (preview.alreadyLinked) return NextResponse.json({ ...preview, dryRun: false, applied: false })

  // The conditional write checks both sides in one SQL statement, so two
  // different clients cannot claim an unlinked customer between read and write.
  const mapped = await database.update(schema.organisations).set({ stripeCustomerId: customer.id, updatedAt: new Date().toISOString() }).where(and(
    eq(schema.organisations.id, org.id),
    isNull(schema.organisations.stripeCustomerId),
    ne(schema.organisations.status, 'archived'),
    eq(schema.organisations.updatedAt, org.updatedAt),
    sql`NOT EXISTS (SELECT 1 FROM organisations AS linked WHERE linked.stripe_customer_id = ${customer.id} AND linked.id <> ${org.id})`,
  )).returning({ id: schema.organisations.id })
  if (!mapped.length) return NextResponse.json({ error: 'The customer or client link changed. Preview the link again.' }, { status: 409 })
  await logAudit(database, {
    action: 'stripe_customer_linked', userId: attributedUserId(auth), entityType: 'organisation', entityId: org.id,
    metadata: { orgId: org.id, stripeCustomerId: customer.id },
  })
  return NextResponse.json({ ...preview, dryRun: false, applied: true })
}
