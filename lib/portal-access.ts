/**
 * lib/portal-access.ts
 *
 * THE single answer to "is this client person an admin of their own
 * workspace?". Every portal surface that separates the owner's bar from a
 * plain member seat resolves it here, on both sides:
 *
 *   read  - invoices, subscription amounts, payment surfaces
 *           (app/api/portal/invoices, .../subscription, .../checkout,
 *           .../billing/session, app/api/onboarding/complete), plus the nav
 *           and the settings sub-nav via lib/permissions.ts
 *   write - brands, organisation settings, the people roster, teammate
 *           invites, and retainer change requests
 *           (app/api/portal/brands, .../organisation, .../people,
 *           .../invites, .../subscription/change-request)
 *
 * THE RULE. A contact is a workspace admin when contacts.portalRole is
 * 'admin', or when they are the org's primary contact. The second clause is
 * not generosity, it is the only thing that keeps a fresh owner working:
 * `portal_role` is NOT NULL DEFAULT 'member' (db/schema.ts), and the flows that
 * create a workspace owner historically inserted the row without naming a role,
 * so the column reads 'member' for the person who owns the place. Migration
 * 0081 backfilled existing rows to 'admin' where is_primary = 1, and the three
 * creation paths patched since stamp 'admin' at insert time, but there is no
 * "unset" value left to test for: an owner created before those fixes is
 * indistinguishable from a member except by is_primary. Reading the column
 * alone is what locked a fresh owner out of inviting teammates and editing
 * their own org settings.
 *
 * The reach of the fallback is deliberately narrow. is_primary is one row per
 * org, set by the studio and never by the person it names, so it cannot be
 * self-granted; a contractor invited as a member is is_primary = 0 and stays
 * denied. No contact row at all = denied.
 */

import { schema } from '@/db/d1'
import { and, eq } from 'drizzle-orm'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export interface PortalContactRoleRow {
  portalRole: string | null
  isPrimary: boolean | number | null
}

/** Pure decision: explicit admin role, or primary-contact fallback. */
export function isPortalAdminContact(
  contact: PortalContactRoleRow | null | undefined,
): boolean {
  if (!contact) return false
  if (contact.portalRole === 'admin') return true
  return !!contact.isPrimary
}

/**
 * The same decision expressed as the role the portal acts on, for callers that
 * carry a role rather than a boolean (ResolvedAccess.portalRole, which drives
 * the client nav). A missing contact row resolves to 'member', which every gate
 * refuses.
 */
export function resolvePortalRole(
  contact: PortalContactRoleRow | null | undefined,
): 'admin' | 'member' {
  return isPortalAdminContact(contact) ? 'admin' : 'member'
}

/**
 * Is this Clerk user a workspace admin of the given D1 org?
 * Matches the caller to their contact row via clerkUserId (linked at
 * provision time for owners and at accept-invite for teammates).
 */
export async function isOrgAdmin(
  drizzle: Drizzle,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const [contact] = await drizzle
    .select({
      portalRole: schema.contacts.portalRole,
      isPrimary: schema.contacts.isPrimary,
    })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.orgId, orgId), eq(schema.contacts.clerkUserId, userId)))
    .limit(1)
  return isPortalAdminContact(contact)
}
