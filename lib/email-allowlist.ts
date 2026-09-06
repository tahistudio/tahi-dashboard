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
 *
 * FOUR LAYERS, NOT ONE. The first pass of this file was a domain rule alone,
 * which could not say the thing Liam actually said. ["tahi.studio"] permits
 * staci@ and nathan@, and a client submitting a request fans a studio email
 * out to every teammate row, so the two people named as off limits were the
 * two the rule delivered to. So, in the order isRecipientAllowed applies them:
 *
 *   1. `email.blockedAddresses`  never, whatever else is set. Default
 *      staci@ and nathan@, alias-aware, checked ahead of mode 'all'.
 *   2. `email.deliveryMode`      'allowlist' (default) or the deliberate 'all'.
 *   3. `email.allowedOrgIds`     an exempt client, scoped to THAT CLIENT'S OWN
 *      addresses (see RecipientScope) rather than to the whole send.
 *   4. `email.allowedAddresses`  exact mailboxes, default ["business@tahi.studio"],
 *      and `email.allowedDomains`, default ["tahi.studio"]. Both must pass.
 *
 * So the state on the day this was written is: one inbox, Liam's, receives
 * anything at all.
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

/**
 * JSON array of exact mailboxes. When it holds anything, an address must be
 * ON it as well as on an allowed domain, so the gate can be narrower than a
 * whole domain. Default ["business@tahi.studio"]: Liam's own mailbox and
 * nothing else, which is the state the blackout actually describes.
 */
export const ALLOWED_ADDRESSES_SETTING_KEY = 'email.allowedAddresses'

/**
 * JSON array of exact mailboxes that may never receive anything, checked
 * before every other rule including mode 'all' and the org exemption. Default
 * ["staci@tahi.studio", "nathan@tahi.studio"], the two people Liam named by
 * hand. A domain list cannot express "everyone here except those two", which
 * is why this exists as its own layer rather than as a narrower domain.
 */
export const BLOCKED_ADDRESSES_SETTING_KEY = 'email.blockedAddresses'

/** Every key this module owns, for the settings route and for the tests. */
export const EMAIL_DELIVERY_SETTING_KEYS = [
  DELIVERY_MODE_SETTING_KEY,
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
  ALLOWED_ADDRESSES_SETTING_KEY,
  BLOCKED_ADDRESSES_SETTING_KEY,
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

/**
 * The only mailbox that may receive mail until somebody widens it.
 *
 * A domain is not tight enough for what Liam actually asked for. "No teammate
 * receives anything until I have verified it" is a statement about people, and
 * tahi.studio holds several of them. Until this list is edited, exactly one
 * inbox is reachable and it is the one doing the verifying.
 *
 * An explicitly stored `[]` is honoured and means "do not narrow by address,
 * the domain list decides". An ABSENT or blank row is not the same thing: it
 * falls back to this, because clearing a setting must close the gate rather
 * than open it.
 */
export const DEFAULT_ALLOWED_ADDRESSES: readonly string[] = ['business@tahi.studio']

/**
 * Named by Liam, 2026-09-06: staci@ and nathan@ must not be emailed by this
 * system. Held as its own list rather than left to the allowlist so that the
 * guarantee survives somebody widening the domains, adding an address, or
 * flipping the mode to 'all' in a hurry.
 */
export const DEFAULT_BLOCKED_ADDRESSES: readonly string[] = [
  'staci@tahi.studio',
  'nathan@tahi.studio',
]

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

/**
 * The exact mailboxes that may receive, alias-stripped and lower-cased.
 *
 * An absent or blank row falls back to DEFAULT_ALLOWED_ADDRESSES (closed). An
 * explicitly stored `[]` is honoured and means "no address narrowing", which
 * is the deliberate act of widening the gate back out to the domain list.
 */
export function resolveAllowedAddresses(stored: unknown): string[] {
  return parseStringList(stored, DEFAULT_ALLOWED_ADDRESSES).map(addressKey)
}

/**
 * The exact mailboxes that may never receive, alias-stripped and lower-cased.
 *
 * Falls back to DEFAULT_BLOCKED_ADDRESSES when the row is absent or blank, for
 * the same reason the domains list falls back: a cleared row must not quietly
 * drop the two names Liam gave. Storing `[]` on purpose does drop them, which
 * is a decision somebody has to make in words.
 */
export function resolveBlockedAddresses(stored: unknown): string[] {
  return parseStringList(stored, DEFAULT_BLOCKED_ADDRESSES).map(addressKey)
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

/**
 * An address list holds addresses: one bare mailbox per entry, no display name
 * lockup, no comma-separated pair. Strict here so the tolerant reader never has
 * to guess, and so the box reads back the way it was typed.
 */
function validateAddressList(key: string, value: unknown): SettingValidation {
  const parsed = validateStringArray(key, value)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  for (const entry of parsed.items) {
    if (/[<>]/.test(entry) || normaliseAddress(entry) === null) {
      return {
        ok: false,
        error: `${key} entry "${entry}" is not a single bare email address. One mailbox per entry, no display name, e.g. business@tahi.studio.`,
      }
    }
  }
  return { ok: true }
}

export function validateAllowedAddresses(value: unknown): SettingValidation {
  return validateAddressList(ALLOWED_ADDRESSES_SETTING_KEY, value)
}

export function validateBlockedAddresses(value: unknown): SettingValidation {
  return validateAddressList(BLOCKED_ADDRESSES_SETTING_KEY, value)
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
    case ALLOWED_ADDRESSES_SETTING_KEY:
      return validateAllowedAddresses(value)
    case BLOCKED_ADDRESSES_SETTING_KEY:
      return validateBlockedAddresses(value)
    default:
      return { ok: true }
  }
}

// ---------------------------------------------------------------------------
// The rule, as a pure function
// ---------------------------------------------------------------------------

/** The five settings, resolved. Pure input to the pure decision below. */
export interface DeliveryPolicy {
  mode: DeliveryMode
  allowedDomains: string[]
  allowedOrgIds: string[]
  /** Exact mailboxes. Empty means "do not narrow by address". */
  allowedAddresses: string[]
  /** Exact mailboxes that may never receive. Beats every other rule. */
  blockedAddresses: string[]
}

/** The policy that applies when nothing could be read. The closed one. */
export function closedPolicy(): DeliveryPolicy {
  return {
    mode: DEFAULT_DELIVERY_MODE,
    allowedDomains: [...DEFAULT_ALLOWED_DOMAINS],
    allowedOrgIds: [],
    allowedAddresses: [...DEFAULT_ALLOWED_ADDRESSES],
    blockedAddresses: [...DEFAULT_BLOCKED_ADDRESSES],
  }
}

/**
 * Which client this send belongs to, and who that client actually is.
 *
 * `orgAddresses` is the half that matters. The org exemption used to be read
 * per SEND rather than per ADDRESS: any address at all was delivered as soon as
 * the send carried an exempted org id, so cc'ing a stranger on a proposal for
 * an exempted client mailed the stranger. An exemption is permission to write
 * to THAT CLIENT, so the addresses it covers are that client's own.
 */
export interface RecipientScope {
  orgId?: string | null
  /** The exempt client's own addresses. Compared alias-stripped. */
  orgAddresses?: readonly string[]
}

/**
 * One address, unwrapped from a display name, lower-cased, or null.
 *
 * NULL IS THE ANSWER FOR ANYTHING THAT IS NOT EXACTLY ONE MAILBOX, and that is
 * the point of this function rather than a convenience. A single string holding
 * two addresses used to be judged on the text after its LAST '@' and then
 * handed to Resend verbatim, which fanned it out to both: the preview route's
 * own guard accepted "jo@acme.com, business@tahi.studio" because it ends with
 * the right domain, and so did the gate. A comma, a semicolon, internal
 * whitespace, a second '@' or a second angle bracket now all read as "not an
 * address" and are withheld. It fails in the safe direction, and it costs one
 * regex.
 */
export function normaliseAddress(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed === '') return null

  // "Jo Bloggs <jo@acme.com>" is one address. "a@x.com, Jo <jo@y.com>" is two
  // wearing the same coat, so anything address-shaped before the bracket, or a
  // second bracket, or text after the closing one, is refused rather than read.
  let bare = trimmed
  const open = trimmed.indexOf('<')
  if (open !== -1) {
    if (!trimmed.endsWith('>')) return null
    if (trimmed.lastIndexOf('<') !== open) return null
    if (/[@,;<]/.test(trimmed.slice(0, open))) return null
    bare = trimmed.slice(open + 1, -1).trim()
  }

  bare = bare.toLowerCase()
  if (/[\s,;<>]/.test(bare)) return null
  if ((bare.match(/@/g) ?? []).length !== 1) return null
  const [local, domain] = bare.split('@')
  if (!local || !domain) return null
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null
  return bare
}

/**
 * The form an exact-match list compares on: normalised, with the plus alias
 * dropped. business+dummy@tahi.studio and business@tahi.studio are one
 * mailbox, so an allowlist entry for either covers both, and a denylist entry
 * for staci@ is not sidestepped by staci+test@.
 *
 * Falls back to the trimmed, lower-cased input when the address will not parse,
 * so a comparison against it simply fails rather than throwing. Nothing
 * unparseable ever reaches a send: isRecipientAllowed withholds it first.
 */
export function addressKey(address: string): string {
  const bare = normaliseAddress(address) ?? address.trim().toLowerCase()
  const at = bare.indexOf('@')
  if (at <= 0) return bare
  const local = bare.slice(0, at)
  const plus = local.indexOf('+')
  return plus === -1 ? bare : `${local.slice(0, plus)}${bare.slice(at)}`
}

/**
 * The domain of an address, lower-cased, or null when there isn't one.
 *
 * Delegates to normaliseAddress, so a string that is not exactly one mailbox
 * has no domain at all and is therefore withheld.
 */
export function recipientDomain(address: string): string | null {
  const bare = normaliseAddress(address)
  if (!bare) return null
  return bare.slice(bare.indexOf('@') + 1)
}

/**
 * Would this address receive the message? Pure, so the rule can be pinned by
 * tests and read by the Xero fallback without opening a database handle.
 *
 * The order is the argument:
 *   1. anything that is not exactly one parseable mailbox is withheld;
 *   2. the denylist, ahead of everything, mode 'all' included;
 *   3. mode 'all', the deliberate open;
 *   4. the org exemption, but only over that client's own addresses;
 *   5. the address allowlist, when it holds anything;
 *   6. the domain list.
 */
export function isRecipientAllowed(
  address: string,
  policy: DeliveryPolicy,
  scope?: RecipientScope | null,
): boolean {
  const bare = normaliseAddress(address)
  if (!bare) return false
  const key = addressKey(bare)

  if (policy.blockedAddresses.includes(key)) return false
  if (policy.mode === 'all') return true

  const org = scope?.orgId?.trim().toLowerCase()
  if (org && policy.allowedOrgIds.includes(org)) {
    for (const own of scope?.orgAddresses ?? []) {
      if (addressKey(own) === key) return true
    }
    // Not one of that client's people, so fall through. An exempt org widens
    // the gate for the client; it never widens it for whoever else is on the
    // line.
  }

  if (policy.allowedAddresses.length > 0 && !policy.allowedAddresses.includes(key)) return false

  return policy.allowedDomains.includes(bare.slice(bare.indexOf('@') + 1))
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
  scope?: RecipientScope | null,
): { allowed: string[]; suppressed: string[] } {
  const allowed: string[] = []
  const suppressed: string[] = []
  for (const raw of addresses) {
    const address = raw?.trim()
    if (!address) continue
    if (isRecipientAllowed(address, policy, scope)) allowed.push(address)
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

/** Neither the address list nor the domain list covered them. */
export const SUPPRESSION_REASON_NOT_ALLOWED = 'not_in_allowlist'

/** On `email.blockedAddresses`. Named by hand, so it is never a near miss. */
export const SUPPRESSION_REASON_BLOCKED = 'address_blocked'

/** Not one parseable mailbox: a pair, a fragment, a comma-separated list. */
export const SUPPRESSION_REASON_UNPARSEABLE = 'not_an_address'

/**
 * Why this one was withheld, so the log distinguishes "we have not opened
 * delivery to them yet" from "somebody typed two addresses into one box" from
 * "this person is on the never list". Pure, and only ever asked about an
 * address isRecipientAllowed has already refused.
 */
export function suppressionReason(address: string, policy: DeliveryPolicy): string {
  if (normaliseAddress(address) === null) return SUPPRESSION_REASON_UNPARSEABLE
  if (policy.blockedAddresses.includes(addressKey(address))) return SUPPRESSION_REASON_BLOCKED
  return SUPPRESSION_REASON_NOT_ALLOWED
}
