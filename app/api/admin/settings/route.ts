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
  ALLOWED_ADDRESSES_SETTING_KEY,
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
  BLOCKED_ADDRESSES_SETTING_KEY,
  DELIVERY_MODE_SETTING_KEY,
  EMAIL_DELIVERY_SETTING_KEYS,
  resolveAllowedAddresses,
  resolveAllowedDomains,
  resolveAllowedOrgIds,
  resolveBlockedAddresses,
  resolveDeliveryMode,
  validateEmailDeliverySetting,
} from '@/lib/email-allowlist'
import { resolvePermissions } from '@/lib/permissions'
import { logAudit } from '@/lib/audit'
import type { DB } from '@/db/d1'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Which writes to the delivery gate need more than "is in the Tahi org".
 *
 * Opening the gate is the single most consequential write in this system, and
 * it was the least protected one: PATCH gated on isTahiAdmin alone, so any
 * member of the Tahi Clerk org, and the MCP service token (which resolves to
 * admin), could store email.deliveryMode = 'all' in one call and reach every
 * real client. Meanwhile DELETE /api/admin/email-suppressions, which only
 * destroys evidence, was already super-admin. The two were the wrong way
 * round.
 *
 * CLOSING STAYS ADMIN-WRITABLE. Clearing email.deliveryMode, or setting it to
 * 'allowlist', shuts the gate, and nobody should need a second signature to
 * make this system send less mail. Everything else on these keys (the mode
 * going to 'all', widening a domain or address list, exempting a client,
 * dropping somebody off the denylist) is a widening and needs super admin.
 */
function isGateClosingWrite(key: string, value: string | null | undefined): boolean {
  if (key !== DELIVERY_MODE_SETTING_KEY) return false
  return value == null || value === '' || value === 'allowlist'
}

// -- GET /api/admin/settings --
// Returns all settings as key-value pairs.
//
// `invoicing.defaultChannel` and `invoicing.xeroEmailMode` are filled in with
// their studio defaults when no row holds a valid value, so a reader never has
// to know that an absent row means Stripe, or means our own email.
//
// The five `email.*` keys are filled in the same way, and for a sharper
// reason: an absent `email.deliveryMode` row means the allowlist is ON, an
// absent `email.allowedAddresses` row means one mailbox and no other, and an
// absent `email.blockedAddresses` row still holds staci@ and nathan@ back. A
// UI that showed empty boxes there would read as "no restriction" when the
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

  // The delivery gate, always answered, always in its resolved form. The four
  // lists come back as re-serialised JSON rather than the raw row so a caller
  // reads the list the sender will actually apply, not the one somebody typed.
  settings[DELIVERY_MODE_SETTING_KEY] = resolveDeliveryMode(settings[DELIVERY_MODE_SETTING_KEY])
  settings[ALLOWED_DOMAINS_SETTING_KEY] = JSON.stringify(
    resolveAllowedDomains(settings[ALLOWED_DOMAINS_SETTING_KEY]),
  )
  settings[ALLOWED_ORG_IDS_SETTING_KEY] = JSON.stringify(
    resolveAllowedOrgIds(settings[ALLOWED_ORG_IDS_SETTING_KEY]),
  )
  settings[ALLOWED_ADDRESSES_SETTING_KEY] = JSON.stringify(
    resolveAllowedAddresses(settings[ALLOWED_ADDRESSES_SETTING_KEY]),
  )
  settings[BLOCKED_ADDRESSES_SETTING_KEY] = JSON.stringify(
    resolveBlockedAddresses(settings[BLOCKED_ADDRESSES_SETTING_KEY]),
  )

  return NextResponse.json({ settings })
}

// -- PATCH /api/admin/settings --
// Upsert a single setting key-value pair.
// Body: { key, value }
//
// WIDENING THE DELIVERY GATE IS SUPER ADMIN. See isGateClosingWrite above:
// closing it stays open to any admin, and every `email.*` write is recorded in
// the audit log with its old value, its new value and the actor.
export async function PATCH(req: NextRequest) {
  const auth = await getRequestAuth(req)
  const { orgId } = auth
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

  // The email delivery gate: which mode, which domains, which addresses, which
  // orgs. Checked here for the same reason the pay keys are, only harder: a typo
  // in `email.allowedDomains` is not a cosmetic failure, it is the difference
  // between a test email landing in a teammate's inbox and landing in a
  // client's. An empty value is the clear on all five and stays allowed,
  // because GET synthesises the CLOSED default for each of them.
  const deliveryCheck = validateEmailDeliverySetting(body.key.trim(), body.value)
  if (!deliveryCheck.ok) {
    return NextResponse.json({ error: deliveryCheck.error }, { status: 400 })
  }

  const database = await db()
  const now = new Date().toISOString()

  const key = body.key.trim()
  const isEmailGateKey = (EMAIL_DELIVERY_SETTING_KEYS as readonly string[]).includes(key)

  // Widening the delivery gate is super admin, the same check the suppression
  // log's DELETE uses. The UI's ConfirmDialog is the human-facing half of this;
  // this is the half an MCP client cannot talk its way past, because the
  // "DO NOT set all unasked" sentence in the tool description is a prompt, not
  // a guard, and the service token resolves to admin.
  if (isEmailGateKey && !isGateClosingWrite(key, body.value)) {
    const access = await resolvePermissions(database as unknown as D1, auth)
    if (!access.isSuperAdmin) {
      return NextResponse.json({
        error: 'Forbidden',
        message: `${key} can only be widened by a super admin. Closing the gate (email.deliveryMode = allowlist, or clearing it) stays open to any admin.`,
      }, { status: 403 })
    }
  }

  // Check if key exists
  const existing = await database
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, body.key))
    .limit(1)

  // The old value, captured before the write so the audit row below can say
  // what this changed FROM. The gate is the one setting where "who opened this,
  // when, and from what" has to be answerable later, and the settings table
  // keeps no history of its own.
  const previousValue = (existing[0] as { value?: string | null } | undefined)?.value ?? null

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

  // Recorded after the write, so a row here means the change landed rather
  // than that somebody attempted it.
  if (isEmailGateKey) {
    await logAudit(database as unknown as DB, {
      action: 'settings.email_delivery_changed',
      userId: auth.userId,
      entityType: 'setting',
      entityId: key,
      metadata: { key, from: previousValue, to: body.value ?? null },
    })
  }

  return NextResponse.json({ success: true })
}
