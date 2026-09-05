/**
 * lib/portal-admin-label.ts
 *
 * Name the people a client member seat should ask about their org's money
 * surfaces. Pure and dependency-free ON PURPOSE: it runs in the browser
 * (app/(dashboard)/invoices/invoice-list.tsx renders it into the restricted
 * empty state), so it must not reach for `lib/portal-access.ts`, which pulls
 * the D1 schema in with it. The admin predicate below is therefore a
 * deliberate one-line copy of `isPortalAdminContact`: explicit portalRole
 * 'admin', or the org's primary contact, whose portalRole is not reliably
 * populated (see lib/portal-access.ts for the full history).
 *
 * Also classifies WHY the money route turned this client away
 * (`portalMoneyDenial`) and turns that into the sentence the page shows
 * (`portalInvoiceDenialCopy`), because a bare 403 has several meanings and only
 * one of them is "ask your admin".
 *
 * Feeds copy, never a permission decision. The server is the only gate.
 */

export interface PortalPersonSummary {
  name?: string | null
  portalRole?: string | null
  isPrimary?: boolean | number | null
  /** Invited but never signed in: cannot help anyone yet, so never named. */
  pending?: boolean | null
}

/** Said when nobody can be named, so the sentence still reads as a sentence. */
export const PORTAL_ADMIN_FALLBACK_LABEL = 'your organisation admin'

/** At most three names, so the copy stays a sentence rather than a roster. */
const MAX_NAMES = 3

/**
 * A human phrase for "who to ask": "Ana", "Ana or Ben", "Ana, Ben or Cara",
 * or the fallback when the roster is empty, unreadable, or holds no named
 * admin. Never throws, so a failed roster read degrades to the fallback.
 */
export function portalAdminLabel(
  people: readonly PortalPersonSummary[] | null | undefined,
): string {
  if (!people || people.length === 0) return PORTAL_ADMIN_FALLBACK_LABEL

  const names: string[] = []
  for (const person of people) {
    if (person.pending) continue
    const isAdmin = person.portalRole === 'admin' || !!person.isPrimary
    if (!isAdmin) continue
    const name = (person.name ?? '').trim()
    if (!name) continue
    if (!names.includes(name)) names.push(name)
    if (names.length === MAX_NAMES) break
  }

  if (names.length === 0) return PORTAL_ADMIN_FALLBACK_LABEL
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

/**
 * WHY a client was refused their org's money surface. /api/portal/invoices (and
 * its [id] sibling) answers 403 from four separate gates and three of them
 * currently send the same bare `{ error: 'Forbidden' }` body, so the page used
 * to say "ask your organisation admin" to people who ARE the org admin.
 *
 *   member_seat      the contact is not a workspace admin of their own org
 *                    (lib/portal-access.ts isOrgAdmin). The common case.
 *   feature_disabled requirePortalFeature denied the org the invoices feature.
 *   no_org           getPortalAuth resolved no D1 organisation for this login.
 */
export type PortalMoneyDenial = 'member_seat' | 'feature_disabled' | 'no_org'

/** The codes a route may send. Keep in step with the portal money routes. */
const DENIAL_BY_CODE: Record<string, PortalMoneyDenial> = {
  not_org_admin: 'member_seat',
  feature_disabled: 'feature_disabled',
  no_org: 'no_org',
}

/** The body the portal routes already send for an unlinked login, verbatim. */
const NO_ORG_MESSAGE = 'No organisation found for this user'

/**
 * Classify a 403 body from a portal money route.
 *
 * Reads an explicit `code` first, so the routes can be given machine-readable
 * denials later without touching this call site, and falls back to the one
 * message that is already distinguishable today. Anything unrecognised reads as
 * `member_seat`, which is what a bare `Forbidden` means on the current routes,
 * so the classifier can never make the page less accurate than it was.
 *
 * Pure and total: never throws, whatever JSON (or non-JSON) the route returned.
 */
export function portalMoneyDenial(info: unknown): PortalMoneyDenial {
  if (typeof info === 'object' && info !== null) {
    const body = info as { code?: unknown; error?: unknown }
    if (typeof body.code === 'string' && body.code in DENIAL_BY_CODE) {
      return DENIAL_BY_CODE[body.code]
    }
    if (body.error === NO_ORG_MESSAGE) return 'no_org'
  }
  return 'member_seat'
}

/** Title and body for the restricted invoices state. Copy only, never a gate. */
export interface PortalDenialCopy {
  title: string
  description: string
}

/** Said in every variant, so no seat thinks the whole portal is broken. */
const UNAFFECTED = 'Your requests, files and services are unaffected.'

/**
 * The honest sentence for each denial. `askWho` is only spent on the member
 * seat: for a feature-disabled workspace the reader may BE the org admin, and
 * for an unlinked login there is no org to name anyone from, so both send the
 * reader to Tahi Studio instead.
 */
export function portalInvoiceDenialCopy(
  denial: PortalMoneyDenial,
  askWho: string,
): PortalDenialCopy {
  if (denial === 'feature_disabled') {
    return {
      title: 'Billing is switched off for your workspace',
      description: `Contact Tahi Studio if you need an invoice. ${UNAFFECTED}`,
    }
  }
  if (denial === 'no_org') {
    return {
      title: 'Your login is not linked to a workspace yet',
      description: `Contact Tahi Studio so they can connect your account. ${UNAFFECTED}`,
    }
  }
  return {
    title: 'Invoices are visible to your organisation admin',
    description: `Ask ${askWho} if you need one. ${UNAFFECTED}`,
  }
}
