import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import {
  DEFAULT_INVOICE_CHANNEL,
  INVOICE_CHANNELS,
  INVOICE_CHANNEL_SETTING_KEY,
  isInvoiceChannel,
} from '@/lib/invoice-channel'
import {
  DEFAULT_XERO_EMAIL_MODE,
  XERO_EMAIL_MODE_SETTING_KEY,
  isXeroEmailMode,
  validateInvoicePaySetting,
} from '@/lib/invoice-pay-settings'
import {
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
  DELIVERY_MODE_SETTING_KEY,
  resolveAllowedDomains,
  resolveAllowedOrgIds,
  resolveDeliveryMode,
  validateEmailDeliverySetting,
} from '@/lib/email-allowlist'

// -- GET /api/admin/settings --
// Returns all settings as key-value pairs.
//
// `invoicing.defaultChannel` and `invoicing.xeroEmailMode` are filled in with
// their studio defaults when no row holds a valid value, so a reader never has
// to know that an absent row means Stripe, or means our own email.
//
// The three `email.*` keys are filled in the same way, and for a sharper
// reason: an absent `email.deliveryMode` row means the allowlist is ON, and a
// UI that showed an empty box there would read as "no restriction" when the
// truth is the opposite.
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()

  const rows = await database
    .select()
    .from(schema.settings)

  const settings: Record<string, string | null> = {}
  for (const row of rows) {
    settings[row.key] = row.value
  }

  if (!isInvoiceChannel(settings[INVOICE_CHANNEL_SETTING_KEY])) {
    settings[INVOICE_CHANNEL_SETTING_KEY] = DEFAULT_INVOICE_CHANNEL
  }

  if (!isXeroEmailMode(settings[XERO_EMAIL_MODE_SETTING_KEY])) {
    settings[XERO_EMAIL_MODE_SETTING_KEY] = DEFAULT_XERO_EMAIL_MODE
  }

  // The delivery gate, always answered, always in its resolved form. The two
  // lists come back as re-serialised JSON rather than the raw row so a caller
  // reads the list the sender will actually apply, not the one somebody typed.
  settings[DELIVERY_MODE_SETTING_KEY] = resolveDeliveryMode(settings[DELIVERY_MODE_SETTING_KEY])
  settings[ALLOWED_DOMAINS_SETTING_KEY] = JSON.stringify(
    resolveAllowedDomains(settings[ALLOWED_DOMAINS_SETTING_KEY]),
  )
  settings[ALLOWED_ORG_IDS_SETTING_KEY] = JSON.stringify(
    resolveAllowedOrgIds(settings[ALLOWED_ORG_IDS_SETTING_KEY]),
  )

  return NextResponse.json({ settings })
}

// -- PATCH /api/admin/settings --
// Upsert a single setting key-value pair.
// Body: { key, value }
export async function PATCH(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as {
    key?: string
    value?: string
  }

  if (!body.key?.trim()) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }

  // The studio default channel is a closed vocabulary: storing anything else
  // would silently resolve back to Stripe for every unset client. A null or
  // empty value is the clear, not a bad value, and stays allowed: GET
  // synthesises Stripe whenever the row is missing or does not hold a rail.
  if (
    body.key.trim() === INVOICE_CHANNEL_SETTING_KEY
    && body.value != null
    && body.value !== ''
    && !isInvoiceChannel(body.value)
  ) {
    return NextResponse.json({
      error: `${INVOICE_CHANNEL_SETTING_KEY} must be one of ${INVOICE_CHANNELS.map(c => c.value).join(', ')}, or empty to fall back to ${DEFAULT_INVOICE_CHANNEL}.`,
    }, { status: 400 })
  }

  // The pay-path keys (bank details, the Xero payment account code, who sends
  // a Xero-rail invoice). `settings` is untyped TEXT, so the shape has to be
  // enforced here or not at all: a malformed bankDetails blob would otherwise
  // only surface as an empty "How to pay" block on a live client invoice, and
  // a mistyped account code would post real payments to the wrong Xero
  // account. An empty value is the clear on all three and stays allowed.
  const payCheck = validateInvoicePaySetting(body.key.trim(), body.value)
  if (!payCheck.ok) {
    return NextResponse.json({ error: payCheck.error }, { status: 400 })
  }

  // The email delivery gate: which mode, which domains, which orgs. Checked
  // here for the same reason the pay keys are, only harder: a typo in
  // `email.allowedDomains` is not a cosmetic failure, it is the difference
  // between a test email landing in a teammate's inbox and landing in a
  // client's. An empty value is the clear on all three and stays allowed,
  // because GET synthesises the CLOSED default for each of them.
  const deliveryCheck = validateEmailDeliverySetting(body.key.trim(), body.value)
  if (!deliveryCheck.ok) {
    return NextResponse.json({ error: deliveryCheck.error }, { status: 400 })
  }

  const database = await db()
  const now = new Date().toISOString()

  // Check if key exists
  const existing = await database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, body.key))
    .limit(1)

  if (existing.length > 0) {
    await database
      .update(schema.settings)
      .set({ value: body.value ?? null, updatedAt: now })
      .where(eq(schema.settings.key, body.key))
  } else {
    await database.insert(schema.settings).values({
      key: body.key,
      value: body.value ?? null,
      updatedAt: now,
    })
  }

  return NextResponse.json({ success: true })
}
