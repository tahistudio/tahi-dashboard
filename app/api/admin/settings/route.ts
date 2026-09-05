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

// -- GET /api/admin/settings --
// Returns all settings as key-value pairs.
//
// `invoicing.defaultChannel` is filled in with the studio default when no row
// exists, so a reader never has to know that an absent row means Stripe.
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
