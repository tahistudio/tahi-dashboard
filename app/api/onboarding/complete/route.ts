import { getPortalAuth } from '@/lib/server-auth'
import { clerkClient } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'
import {
  getStripe,
  isPlanId,
  isPresentmentCurrency,
  presentmentAmount,
  STRIPE_PLANS,
  type PresentmentCurrency,
} from '@/lib/stripe-plans'
import { isOrgAdmin } from '@/lib/portal-access'
import { notifyAllAdmins } from '@/lib/notifications'
import {
  DEFAULT_INVOICE_TERMS,
  dueDateForTerms,
  invoiceReference,
  isInvoicedTerms,
  paymentTermsLabel,
} from '@/lib/invoice-billing'

export const dynamic = 'force-dynamic'

const ACTIVE_SUB_STATUSES = new Set(['active', 'trialing', 'past_due'])

/**
 * POST /api/onboarding/complete
 * Mark the current user's onboarding as done (Clerk publicMetadata flag), so the
 * /onboarding and /welcome entry pages skip straight to /overview next time.
 *
 * SECURITY: this flag is what the dashboard layout gates client access on, so it
 * must NOT be a self-grantable bypass. We set it only once the caller is genuinely
 * ENTITLED to the portal:
 *   - a teammate / Tahi admin (in the Tahi org), OR
 *   - a client who consumed an admin-minted invite (the no-payment personas:
 *     invited project / existing client), OR
 *   - a client whose org holds an active/trialing/past_due subscription (a
 *     self-serve retainer who actually paid).
 *   - a client who chose "invoice me" (net terms) at onboarding, recorded on
 *     organisations.paymentTerms.
 * A self-serve visitor who only provisioned a free org and never paid is NOT
 * entitled, so the flag stays unset and the layout keeps them in onboarding.
 *
 * The net-terms path is a DELIBERATE, recorded entitlement, not a bypass: only
 * the org's workspace admin can set it, it writes a draft invoice the studio
 * has to send, it raises a bell row for the studio, and it lands in the audit
 * log. See recordInvoiceMe below.
 */

/** Currencies an invoice row may be denominated in (matches admin/invoices). */
const INVOICE_CURRENCIES = ['NZD', 'USD', 'AUD', 'GBP', 'EUR']

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface InvoiceMeRequest {
  plan?: string
  addon?: boolean
  currency?: string
}

/**
 * "Invoice me" at the onboarding pay step.
 *
 * Records the client's net-terms preference, raises a DRAFT invoice for the
 * plan they picked (never sent automatically, a human sends it) and tells the
 * studio. Before this, the client advanced, hit a 402 here and was bounced
 * between /overview and /onboarding forever with nothing recorded and nobody
 * told.
 *
 * Amounts are derived server-side from STRIPE_PLANS; nothing about the price
 * is taken from the request body.
 *
 * Returns true when the org now carries net terms (which entitles them).
 */
async function recordInvoiceMe(
  database: Drizzle,
  orgId: string,
  userId: string,
  body: InvoiceMeRequest,
): Promise<boolean> {
  // Only the workspace admin (or the primary contact, per portal-access) can
  // put their own org on net terms. A plain member seat cannot.
  if (!(await isOrgAdmin(database, orgId, userId))) return false

  const now = new Date().toISOString()

  const [org] = await database
    .select({ id: schema.organisations.id, name: schema.organisations.name, paymentTerms: schema.organisations.paymentTerms })
    .from(schema.organisations)
    .where(eq(schema.organisations.id, orgId))
    .limit(1)
  if (!org) return false

  // Idempotent: a repeated click must not raise a second draft invoice.
  if (isInvoicedTerms(org.paymentTerms)) return true

  const terms = DEFAULT_INVOICE_TERMS
  await database
    .update(schema.organisations)
    .set({ paymentTerms: terms, updatedAt: now })
    .where(eq(schema.organisations.id, orgId))

  // Price the first month from the catalogue, in the currency they were
  // looking at. An unrecognised plan still records the preference and tells
  // the studio; it just cannot price a draft.
  const plan = typeof body.plan === 'string' && isPlanId(body.plan) ? STRIPE_PLANS[body.plan] : null
  // The currency the amounts are CONVERTED into and the currency the invoice is
  // LABELLED with must be the same one, so an unsupported presentment currency
  // (e.g. CAD, which Stripe presents but our invoice rows do not carry) falls
  // all the way back to USD rather than pricing in one and labelling in another.
  const requested: PresentmentCurrency =
    typeof body.currency === 'string' && isPresentmentCurrency(body.currency) ? body.currency : 'usd'
  const presentment: PresentmentCurrency =
    INVOICE_CURRENCIES.includes(requested.toUpperCase()) ? requested : 'usd'
  const currency = presentment.toUpperCase()

  let invoiceId: string | null = null
  if (plan) {
    const addon = body.addon === true
    const lines = [
      {
        description: `${plan.name} retainer, first month`,
        amount: presentmentAmount(plan.baseAmount, presentment) / 100,
      },
      ...(addon
        ? [{
            description: 'Priority Support, parallel track',
            amount: presentmentAmount(plan.trackAmount, presentment) / 100,
          }]
        : []),
    ]
    const total = lines.reduce((sum, l) => sum + l.amount, 0)

    invoiceId = crypto.randomUUID()
    await database.insert(schema.invoices).values({
      id: invoiceId,
      orgId,
      source: 'manual',
      status: 'draft',
      amountUsd: total,
      totalUsd: total,
      currency,
      dueDate: dueDateForTerms(now, terms),
      notes: `Raised from onboarding: client chose to be invoiced (${paymentTermsLabel(terms)}).`,
      createdAt: now,
      updatedAt: now,
    })
    await database.insert(schema.invoiceItems).values(lines.map(l => ({
      id: crypto.randomUUID(),
      invoiceId: invoiceId as string,
      description: l.description,
      quantity: 1,
      unitPriceUsd: l.amount,
      totalUsd: l.amount,
    })))
  }

  // Tell the studio. Without this nobody knows a client is on net terms and
  // owes a first invoice.
  await notifyAllAdmins(database, {
    type: 'invoice_created',
    title: `${org.name} chose to be invoiced`,
    body: invoiceId
      ? `${paymentTermsLabel(terms)} terms recorded. Draft invoice ${invoiceReference(invoiceId)} is waiting to be reviewed and sent.`
      : `${paymentTermsLabel(terms)} terms recorded at onboarding. No plan was selected, so raise their first invoice by hand.`,
    entityType: invoiceId ? 'invoice' : 'organisation',
    entityId: invoiceId ?? orgId,
  })

  try {
    await database.insert(schema.auditLog).values({
      id: crypto.randomUUID(),
      actorId: userId,
      actorType: 'contact',
      action: 'billing_terms_set',
      entityType: 'organisation',
      entityId: orgId,
      metadata: JSON.stringify({ paymentTerms: terms, source: 'onboarding', invoiceId }),
      createdAt: now,
    })
  } catch {
    // Non-fatal: the preference and the draft are the durable record.
  }

  return true
}

export async function POST(req: NextRequest) {
  const { userId, orgId, clerkOrgId } = await getPortalAuth(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // A user with no org has not finished provisioning / joining. Marking them
  // complete would make onboarding redirect to /overview, which the middleware
  // bounces back (no org) - an infinite loop. Refuse until they have one.
  if (!orgId) return NextResponse.json({ ok: false, reason: 'no-org' })

  // Teammates / admins live in the Tahi org and are entitled by definition.
  const isTeammate = clerkOrgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID || orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // Optional body. billingMode 'invoice' is the "invoice me" click on the pay
  // step; anything else (including no body at all) is the plain completion
  // call and changes nothing.
  const body = (await req.json().catch(() => ({}))) as {
    billingMode?: string
    plan?: string
    addon?: boolean
    currency?: string
  }

  let entitled = isTeammate
  if (!entitled) {
    const database = await db()
    const drizzle = database as Drizzle

    // (0) "Invoice me": record the preference, raise the draft, tell the studio.
    if (body.billingMode === 'invoice') {
      try {
        if (await recordInvoiceMe(drizzle, orgId, userId, body)) entitled = true
      } catch {
        // non-fatal: fall through to the other entitlement checks
      }
    }

    // (a) Consumed invite for this user + org => admin-granted, no payment needed.
    if (!entitled) {
      try {
        const [inv] = await database
          .select({ id: schema.onboardingInvites.id })
          .from(schema.onboardingInvites)
          .where(and(eq(schema.onboardingInvites.orgId, orgId), eq(schema.onboardingInvites.usedByUserId, userId)))
          .limit(1)
        if (inv) entitled = true
      } catch {
        // non-fatal: fall through to the subscription checks
      }
    }

    // (a2) Net terms already on record: an invoiced client is entitled even
    // without a live subscription, and this makes the invoice-me path
    // idempotent across retries and later sign-ins.
    if (!entitled) {
      try {
        const [org] = await database
          .select({ paymentTerms: schema.organisations.paymentTerms })
          .from(schema.organisations)
          .where(eq(schema.organisations.id, orgId))
          .limit(1)
        if (isInvoicedTerms(org?.paymentTerms)) entitled = true
      } catch {
        // non-fatal: fall through to the subscription checks
      }
    }

    // (b) Active subscription on record.
    let stripeSubId: string | null = null
    if (!entitled) {
      try {
        const [sub] = await database
          .select({ status: schema.subscriptions.status, stripeSubscriptionId: schema.subscriptions.stripeSubscriptionId })
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.orgId, orgId))
          .limit(1)
        if (sub && ACTIVE_SUB_STATUSES.has(sub.status)) entitled = true
        else stripeSubId = sub?.stripeSubscriptionId ?? null
      } catch {
        // non-fatal
      }
    }

    // (c) Webhook-lag fallback: the PaymentElement may have just succeeded while
    // our row is still 'incomplete' (the customer.subscription.updated webhook
    // not yet processed). Ask Stripe directly so a genuine payer is never bounced.
    if (!entitled && stripeSubId) {
      try {
        const stripe = getStripe()
        if (stripe) {
          const s = await stripe.subscriptions.retrieve(stripeSubId)
          if (s && ACTIVE_SUB_STATUSES.has(s.status)) {
            entitled = true
            // Opportunistically sync our row so the next read is fast + correct.
            await database
              .update(schema.subscriptions)
              .set({ status: s.status, updatedAt: new Date().toISOString() })
              .where(eq(schema.subscriptions.orgId, orgId))
          }
        }
      } catch {
        // non-fatal: treat as not-yet-entitled
      }
    }
  }

  if (!entitled) {
    // Not paid and not invited: do not unlock the dashboard.
    return NextResponse.json({ ok: false, reason: 'not-entitled' }, { status: 402 })
  }

  try {
    const clerk = await clerkClient()
    const user = await clerk.users.getUser(userId)
    await clerk.users.updateUser(userId, {
      publicMetadata: { ...user.publicMetadata, onboardingComplete: true },
    })
  } catch {
    // Non-fatal: the flow still routes onward; the guard just won't skip next time.
    return NextResponse.json({ ok: false })
  }
  return NextResponse.json({ ok: true })
}
