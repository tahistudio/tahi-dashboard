/**
 * lib/email-allowlist.ts
 *
 * The rule, with nothing behind it. Keys, vocabulary, validators, and the pure
 * decision "would this address receive the message?".
 *
 * Split out of lib/email-delivery.ts, which is the door itself, for two
 * concrete reasons rather than tidiness:
 *
 *   1. The settings route validates these keys, and its tests mock 'drizzle-orm'
 *      down to the one operator they use. A validator that dragged in a Resend
 *      client and a D1 handle to check the spelling of a domain would make a
 *      cheap test expensive and the import graph a liability.
 *   2. The settings UI is a 'use client' module. It needs the same vocabulary
 *      and the same validators the server runs, so the two can never disagree,
 *      and it must not pull the Resend SDK or @opennextjs/cloudflare into the
 *      browser bundle to get them.
 *
 * Pure: no D1 handle, no fetch, no environment. Same shape as
 * lib/invoice-pay-settings.ts, for the same reasons.
 *
 * WHY ANY OF THIS EXISTS. Liam, 2026-09-06: no real client and no teammate may
 * receive any email from this system until he has verified it himself, and
 * that includes staci@ and nathan@. Before the gate there were nine
 * independent ways to put a message in someone's inbox, so "nothing goes out
 * yet" could only ever be an intention. It is now a setting with a default,
 * and the default is closed.
 */

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** 'allowlist' (default) or 'all'. Stored as a bare string. */
export const DELIVERY_MODE_SETTING_KEY = 'email.deliveryMode'

/** JSON array of bare domains, e.g. ["tahi.studio"]. */
export const ALLOWED_DOMAINS_SETTING_KEY = 'email.allowedDomains'

/** JSON array of organisation ids whose mail is exempt from the domain rule. */
export const ALLOWED_ORG_IDS_SETTING_KEY = 'email.allowedOrgIds'

/** Every key this module owns, for the settings route and for the tests. */
export const EMAIL_DELIVERY_SETTING_KEYS = [
  DELIVERY_MODE_SETTING_KEY,
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
] as const

// ---------------------------------------------------------------------------
// email.deliveryMode
// ---------------------------------------------------------------------------

export const DELIVERY_MODES = [
  { value: 'allowlist', label: 'Allowlist only' },
  { value: 'all', label: 'Everyone' },
] as const

export type DeliveryMode = (typeof DELIVERY_MODES)[number]['value']

/**
 * What happens when nobody has said otherwise, and what happens when what they
 * said cannot be read. Both are 'allowlist' on purpose: the cost of guessing
 * wrong in the other direction is a real client receiving a test email.
 */
export const DEFAULT_DELIVERY_MODE: DeliveryMode = 'allowlist'

/** The only domain that may receive mail until somebody widens it. */
export const DEFAULT_ALLOWED_DOMAINS: readonly string[] = ['tahi.studio']

export function isDeliveryMode(value: unknown): value is DeliveryMode {
  return typeof value === 'string' && DELIVERY_MODES.some(m => m.value === value)
}

/**
 * The stored mode read as a mode. Anything that is not exactly 'all' or
 * 'allowlist' reads as the default, which is the closed one.
 */
export function resolveDeliveryMode(stored: unknown): DeliveryMode {
  return isDeliveryMode(stored) ? stored : DEFAULT_DELIVERY_MODE
}

// ---------------------------------------------------------------------------
// The two lists
// ---------------------------------------------------------------------------

/** The result of validating one setting value. */
export type SettingValidation =
  | { ok: true }
  | { ok: false; error: string }

/**
 * A stored JSON array of non-empty strings, read tolerantly. Anything else
 * (absent, unparseable, an object, an array of numbers) reads as `fallback`.
 * Tolerant here and strict in the validator below, for the same reason
 * lib/invoice-pay-settings.ts splits them: a hand-edited row must degrade to
 * the safe default rather than throw inside a send.
 */
function parseStringList(stored: unknown, fallback: readonly string[]): string[] {
  if (typeof stored !== 'string' || stored.trim() === '') return [...fallback]
  let raw: unknown
  try {
    raw = JSON.parse(stored)
  } catch {
    return [...fallback]
  }
  if (!Array.isArray(raw)) return [...fallback]
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map(v => v.trim().toLowerCase())
    .filter(v => v !== '')
}

/**
 * The allowed domains, lower-cased, falling back to tahi.studio.
 *
 * An empty list falls back rather than being honoured, unlike the org ids
 * below. An empty domain list plus allowlist mode is a configuration that can
 * send nothing at all, which is not a state anyone means to be in and is
 * indistinguishable from a botched edit.
 */
export function resolveAllowedDomains(stored: unknown): string[] {
  const parsed = parseStringList(stored, DEFAULT_ALLOWED_DOMAINS)
  return parsed.length === 0 ? [...DEFAULT_ALLOWED_DOMAINS] : parsed
}

/**
 * The exempt organisation ids. An empty list is a legitimate, and the
 * expected, answer, so an empty stored array is honoured rather than replaced
 * with a default the way the domains list is.
 *
 * Lower-cased on the way out and compared lower-cased, so a copy-pasted id
 * with a stray capital still matches.
 */
export function resolveAllowedOrgIds(stored: unknown): string[] {
  return parseStringList(stored, [])
}

// ---------------------------------------------------------------------------
// Validation, at the door
// ---------------------------------------------------------------------------

/** A domain is a dotted label run: no '@', no spaces, no scheme, no path. */
const DOMAIN_SHAPE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

type ArrayValidation =
  | { ok: true; items: string[] }
  | { ok: false; error: string }

function validateStringArray(key: string, value: unknown): ArrayValidation {
  if (value == null || value === '') return { ok: true, items: [] }
  if (typeof value !== 'string') {
    return { ok: false, error: `${key} must be a JSON array of strings.` }
  }
  let raw: unknown
  try {
    raw = JSON.parse(value)
  } catch {
    return { ok: false, error: `${key} must be valid JSON.` }
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: `${key} must be a JSON array, e.g. ["tahi.studio"].` }
  }
  const items: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      return { ok: false, error: `${key} may only hold non-empty strings.` }
    }
    items.push(entry.trim())
  }
  return { ok: true, items }
}

export function validateDeliveryMode(value: unknown): SettingValidation {
  if (value == null || value === '') return { ok: true }
  if (!isDeliveryMode(value)) {
    return {
      ok: false,
      error: `${DELIVERY_MODE_SETTING_KEY} must be one of ${DELIVERY_MODES.map(m => m.value).join(', ')}, or empty to fall back to ${DEFAULT_DELIVERY_MODE}. "all" lets this system email any address, including real clients.`,
    }
  }
  return { ok: true }
}

export function validateAllowedDomains(value: unknown): SettingValidation {
  const parsed = validateStringArray(ALLOWED_DOMAINS_SETTING_KEY, value)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  for (const entry of parsed.items) {
    const domain = entry.toLowerCase()
    if (domain.includes('@')) {
      return {
        ok: false,
        error: `${ALLOWED_DOMAINS_SETTING_KEY} holds domains, not addresses. Drop the local part from "${entry}".`,
      }
    }
    if (!DOMAIN_SHAPE.test(domain)) {
      return {
        ok: false,
        error: `${ALLOWED_DOMAINS_SETTING_KEY} entry "${entry}" is not a domain. Use a bare dotted domain such as tahi.studio.`,
      }
    }
  }
  return { ok: true }
}

export function validateAllowedOrgIds(value: unknown): SettingValidation {
  const parsed = validateStringArray(ALLOWED_ORG_IDS_SETTING_KEY, value)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  for (const entry of parsed.items) {
    if (/\s/.test(entry)) {
      return {
        ok: false,
        error: `${ALLOWED_ORG_IDS_SETTING_KEY} entry "${entry}" is not an organisation id.`,
      }
    }
  }
  return { ok: true }
}

/**
 * Validate one settings write. Returns ok for any key this module does not
 * own, so the settings route can call it unconditionally, exactly the way it
 * already calls validateInvoicePaySetting.
 *
 * An empty value is always the clear and is always allowed, because GET
 * synthesises the CLOSED default for each of the three: clearing the mode
 * turns the allowlist ON, not off.
 */
export function validateEmailDeliverySetting(key: string, value: unknown): SettingValidation {
  switch (key) {
    case DELIVERY_MODE_SETTING_KEY:
      return validateDeliveryMode(value)
    case ALLOWED_DOMAINS_SETTING_KEY:
      return validateAllowedDomains(value)
    case ALLOWED_ORG_IDS_SETTING_KEY:
      return validateAllowedOrgIds(value)
    default:
      return { ok: true }
  }
}

// ---------------------------------------------------------------------------
// The rule, as a pure function
// ---------------------------------------------------------------------------

/** The three settings, resolved. Pure input to the pure decision below. */
export interface DeliveryPolicy {
  mode: DeliveryMode
  allowedDomains: string[]
  allowedOrgIds: string[]
}

/** The policy that applies when nothing could be read. The closed one. */
export function closedPolicy(): DeliveryPolicy {
  return {
    mode: DEFAULT_DELIVERY_MODE,
    allowedDomains: [...DEFAULT_ALLOWED_DOMAINS],
    allowedOrgIds: [],
  }
}

/**
 * The domain of an address, lower-cased, or null when there isn't one.
 *
 * Accepts the display-name form ("Jo <jo@acme.com>") because a from address is
 * written that way and a caller may hand us a to address the same way. Splits
 * on the LAST '@', so a local part containing one cannot smuggle a different
 * domain past the check. A plus alias lives in the local part and is therefore
 * invisible here, which is the point: business+dummy@tahi.studio and
 * business@tahi.studio are the same domain and both pass.
 */
export function recipientDomain(address: string): string | null {
  const inAngles = address.match(/<([^>]*)>/)?.[1]
  const bare = (inAngles ?? address).trim().toLowerCase()
  const at = bare.lastIndexOf('@')
  if (at <= 0 || at === bare.length - 1) return null
  const domain = bare.slice(at + 1).trim()
  return domain === '' ? null : domain
}

/**
 * Would this address receive the message? Pure, so the rule can be pinned by
 * tests and read by the Xero fallback without opening a database handle.
 *
 * An address we cannot parse is withheld. There is no reading of "not an
 * address" that should end in a send.
 */
export function isRecipientAllowed(
  address: string,
  policy: DeliveryPolicy,
  orgId?: string | null,
): boolean {
  if (policy.mode === 'all') return true
  const org = orgId?.trim().toLowerCase()
  if (org && policy.allowedOrgIds.includes(org)) return true
  const domain = recipientDomain(address)
  if (!domain) return false
  return policy.allowedDomains.includes(domain)
}

/**
 * Split a recipient list into what goes and what is withheld, preserving the
 * caller's original spelling of each address (the comparison is lower-cased,
 * the delivered address is not: Resend is handed exactly what the caller
 * asked for).
 */
export function partitionRecipients(
  addresses: readonly string[],
  policy: DeliveryPolicy,
  orgId?: string | null,
): { allowed: string[]; suppressed: string[] } {
  const allowed: string[] = []
  const suppressed: string[] = []
  for (const raw of addresses) {
    const address = raw?.trim()
    if (!address) continue
    if (isRecipientAllowed(address, policy, orgId)) allowed.push(address)
    else suppressed.push(address)
  }
  return { allowed, suppressed }
}

// ---------------------------------------------------------------------------
// The log, as a shape
// ---------------------------------------------------------------------------

/** One withheld recipient, as the settings UI and MCP read it. */
export interface EmailSuppressionRow {
  id: string
  createdAt: string
  to: string
  orgId: string | null
  template: string | null
  subject: string | null
  reason: string
}

/** The one reason a recipient is withheld today. Stored, not inferred. */
export const SUPPRESSION_REASON_NOT_ALLOWED = 'not_in_allowlist'
