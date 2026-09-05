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
