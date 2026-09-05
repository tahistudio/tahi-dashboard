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

// -- GET /api/admin/settings --
// Returns all settings as key-value pairs.
//
// `invoicing.defaultChannel` and `invoicing.xeroEmailMode` are filled in with
// their studio defaults when no row holds a valid value, so a reader never has
// to know that an absent row means Stripe, or means our own email.
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
