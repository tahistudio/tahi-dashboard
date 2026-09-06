/**
 * lib/email-gate.ts
 *
 * The rule, wired to the database, with NO TRANSPORT ATTACHED.
 *
 * lib/email-allowlist.ts is the pure decision and lib/email-delivery.ts is the
 * Resend door. This module is the layer between them: it reads the policy out
 * of `settings`, resolves who an exempted client actually is, writes the
 * suppression log, and answers the one question a NON-RESEND transport needs
 * to ask before it acts.
 *
 * WHY IT IS ITS OWN FILE. Resend is not the only way this platform puts a
 * message in somebody's inbox. Clerk mails its own organisation invitations
 * from Clerk's systems, and Stripe mails a finalised invoice from Stripe's, so
 * neither ever passes an address through lib/email-delivery.ts. Those callers
 * still have to ask the same rule and still have to leave the same evidence,
 * and they must not drag the Resend SDK into a portal route to do it. Hence a
 * D1-aware, transport-free module that lib/email-delivery.ts imports and
 * re-exports, rather than a second copy of the rule.
 *
 * WHAT A CALLER OWES. `guardOutboundAddress` returns allowed/withheld AND logs
 * the withheld case, so a refusal is provable after the fact by a row rather
 * than by reading the route. A caller that only wants the decision (the Xero
 * stand-down, which has no address at all) reads `resolveDeliveryPolicy`
 * directly.
 */

import { desc, eq, inArray } from 'drizzle-orm'

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import {
  ALLOWED_ADDRESSES_SETTING_KEY,
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
  BLOCKED_ADDRESSES_SETTING_KEY,
  DELIVERY_MODE_SETTING_KEY,
  EMAIL_DELIVERY_SETTING_KEYS,
  closedPolicy,
  isRecipientAllowed,
  resolveAllowedAddresses,
  resolveAllowedDomains,
  resolveAllowedOrgIds,
  resolveBlockedAddresses,
  resolveDeliveryMode,
  suppressionReason,
  type DeliveryPolicy,
  type EmailSuppressionRow,
  type RecipientScope,
} from '@/lib/email-allowlist'

interface SettingRow {
  key: string
  value: string | null
}

/**
 * The live policy, read from the settings table.
 *
 * Every failure path lands on the closed policy: no D1 binding, a thrown
 * query, a settings table that has not been created. The gate is only worth
 * having if the broken case is the safe case.
 *
 * The read is narrowed to the five keys it uses. It used to SELECT the whole
 * settings table once per RECIPIENT, and an announcement fan-out mails one
 * contact at a time, so a 200-contact announcement paid 200 full table scans
 * against a Worker's subrequest budget. Fan-outs should also resolve this once
 * and hand it down: deliverEmail and guardOutboundAddress both accept a
 * pre-resolved policy.
 */
export async function resolveDeliveryPolicy(): Promise<DeliveryPolicy> {
  try {
    const database = await db()
    const rows = (await database
      .select({ key: schema.settings.key, value: schema.settings.value })
      .from(schema.settings)
      .where(inArray(schema.settings.key, [...EMAIL_DELIVERY_SETTING_KEYS]))) as SettingRow[]

    const map = new Map<string, string | null>()
    for (const row of rows) map.set(row.key, row.value)

    return {
      mode: resolveDeliveryMode(map.get(DELIVERY_MODE_SETTING_KEY)),
      allowedDomains: resolveAllowedDomains(map.get(ALLOWED_DOMAINS_SETTING_KEY)),
      allowedOrgIds: resolveAllowedOrgIds(map.get(ALLOWED_ORG_IDS_SETTING_KEY)),
      allowedAddresses: resolveAllowedAddresses(map.get(ALLOWED_ADDRESSES_SETTING_KEY)),
      blockedAddresses: resolveBlockedAddresses(map.get(BLOCKED_ADDRESSES_SETTING_KEY)),
    }
  } catch {
    return closedPolicy()
  }
}

/**
 * Who an exempted client actually is.
 *
 * `email.allowedOrgIds` names clients, not addresses, and the exemption is read
 * per address rather than per send, so the rule needs that client's own
 * mailboxes to compare against. Only asked when the org IS exempt, so a send
 * for any other client costs nothing: in the default blackout this query never
 * runs at all.
 *
 * A read failure returns an empty membership, which withholds rather than
 * delivers.
 */
export async function resolveOrgRecipientScope(
  orgId: string | null | undefined,
  policy: DeliveryPolicy,
): Promise<RecipientScope> {
  const org = orgId?.trim()
  if (!org) return { orgId: null }
  if (policy.mode === 'all') return { orgId: org }
  if (!policy.allowedOrgIds.includes(org.toLowerCase())) return { orgId: org }

  try {
    const database = await db()
    const rows = (await database
      .select({ email: schema.contacts.email })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, org))) as { email: string | null }[]
    return {
      orgId: org,
      orgAddresses: rows
        .map(r => r.email?.trim())
        .filter((e): e is string => !!e),
    }
  } catch {
    return { orgId: org, orgAddresses: [] }
  }
}

/** What a suppression row needs beyond the address itself. */
export interface SuppressionContext {
  /** Which email this is, in kebab case, e.g. 'invoice-sent'. */
  template: string
  /** The subject line, or a sentence naming the message when there isn't one. */
  subject?: string | null
  orgId?: string | null
  /** Defaults to the reason the policy gives for this address. */
  reason?: string
}

/**
 * Record every withheld address. Best effort by design: if this write fails
 * the recipient is still withheld, because throwing (and so failing the
 * caller's whole send) makes nobody safer, and losing the log entry makes
 * nobody less safe.
 */
export async function recordEmailSuppressions(
  addresses: readonly string[],
  ctx: SuppressionContext,
  policy?: DeliveryPolicy,
): Promise<void> {
  if (addresses.length === 0) return
  try {
    const database = await db()
    const now = new Date().toISOString()
    await database.insert(schema.emailSuppressions).values(
      addresses.map(address => ({
        id: crypto.randomUUID(),
        createdAt: now,
        to: address,
        orgId: ctx.orgId ?? null,
        template: ctx.template,
        subject: ctx.subject ?? null,
        reason: ctx.reason ?? (policy ? suppressionReason(address, policy) : 'not_in_allowlist'),
      })),
    )
  } catch {
    // Swallowed on purpose. See the doc comment above.
  }
}

/** What a non-Resend transport gets back before it acts. */
export interface OutboundAddressDecision {
  allowed: boolean
  policy: DeliveryPolicy
  /** The sentence to answer a caller with when `allowed` is false. */
  reason: string
}

/** The one message every transport gives a person it will not write to. */
export const ALLOWLIST_HELD_BACK =
  'Held back by the email allowlist. Settings > Studio details > Email delivery.'

/**
 * THE ENTRY POINT FOR A TRANSPORT WE DO NOT OWN.
 *
 * Clerk sends its own invitation email and Stripe sends its own finalised
 * invoice, so no address of theirs ever reaches lib/email-delivery.ts. Both
 * ask here first, and a withheld address is logged before the caller answers,
 * so the blackout is provable from `email_suppressions` rather than from the
 * absence of a complaint.
 *
 * Pass `policy` when the caller has already resolved one (a loop over several
 * addresses should), otherwise it is read here.
 */
export async function guardOutboundAddress(
  address: string,
  ctx: SuppressionContext,
  policy?: DeliveryPolicy,
): Promise<OutboundAddressDecision> {
  const resolved = policy ?? await resolveDeliveryPolicy()
  const scope = await resolveOrgRecipientScope(ctx.orgId, resolved)

  if (isRecipientAllowed(address, resolved, scope)) {
    return { allowed: true, policy: resolved, reason: '' }
  }

  await recordEmailSuppressions([address], ctx, resolved)
  return { allowed: false, policy: resolved, reason: ALLOWLIST_HELD_BACK }
}

/** The most recent suppressions, newest first. */
export async function listEmailSuppressions(limit = 100): Promise<EmailSuppressionRow[]> {
  const database = await db()
  const rows = await database
    .select()
    .from(schema.emailSuppressions)
    .orderBy(desc(schema.emailSuppressions.createdAt))
    .limit(limit)
  return rows as EmailSuppressionRow[]
}

/** Empty the log. Every row, no filter: this is the Clear button. */
export async function clearEmailSuppressions(): Promise<void> {
  const database = await db()
  await database.delete(schema.emailSuppressions)
}
