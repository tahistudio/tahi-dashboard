/**
 * lib/portal-access.ts
 *
 * Client-portal workspace-admin gating for financial data. The owner's bar:
 * invoices, subscription amounts, and payment surfaces are visible only to
 * admins of their own org, never to plain member seats (e.g. a contractor
 * invited as a member).
 *
 * The explicit signal is contacts.portalRole === 'admin', but that column is
 * NOT reliably populated for primary contacts: the admin client-create flow
 * (app/api/admin/clients) and the self-serve provision flow
 * (app/api/portal/provision) both insert the primary contact WITHOUT a
 * portalRole, so it defaults to 'member'. Only migration 0081 backfilled
 * existing rows to admin where is_primary = 1. To avoid locking a freshly
 * provisioned owner out of their own invoices, the org's primary contact is
 * treated as a workspace admin as a fallback. No contact row at all = denied.
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
