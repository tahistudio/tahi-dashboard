/**
 * lib/portal-identity.ts: which contacts row a portal READ is answering for.
 *
 * Every portal route used to build that identity the same way, inline:
 *
 *   and(eq(contacts.orgId, orgId), eq(contacts.clerkUserId, userId))
 *
 * which is right for a real client and wrong for a studio preview. In Client
 * view (and in act mode) `getPortalAuth` swaps the ORG to the previewed client
 * but leaves `userId` as the operator's own Clerk id, and no client org has a
 * contacts row for a Tahi login. So every one of those reads resolved to no
 * contact: /api/portal/profile answered `contact: null, isAdmin: false`, which
 * hid People and Organisation from the preview, and the brand scoping,
 * own-message detection and unread cursors underneath it all answered for
 * nobody. The preview showed a portal no client would ever see.
 *
 * The two halves live here so the write path and the read path cannot drift:
 *
 *   - `resolvePreviewContactId` is the CHOOSER, lifted out of
 *     lib/server-auth.ts `resolveActingIdentity` (where it ran for acting
 *     writes only) so a read stands in the same seat a write would be recorded
 *     against: the org's primary contact, falling back to any contact, and null
 *     for an org with nobody in it.
 *   - `contactIdentityWhere` is the PREDICATE those reads now share. Given a
 *     preview seat it matches that row by id; given none it matches the
 *     caller's own row by login, exactly as before.
 *
 * SCOPE, DELIBERATELY. Nothing here authorises anything. A preview seat is only
 * ever resolved for a session `getPortalAuth` already proved is the Tahi org
 * looking at one client, the org filter stays on every query, and no write gate
 * moves: `refusePreviewWrite` still refuses in read-only preview and act mode
 * still attributes its rows to the studio member, never to the seat named here.
 */

import { schema } from '@/db/d1'
import { and, desc, eq, type SQL } from 'drizzle-orm'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * The seat a studio preview of `orgId` stands in.
 *
 * Primary contact first, because that is the person whose portal the studio
 * means to be looking at, and because the primary contact is a workspace admin
 * by definition (lib/portal-access.ts), so the preview shows the full surface
 * rather than a member's subset. Any other contact is the fallback for an org
 * whose primary flag was never set; null means the org has no people yet, which
 * is a legitimate answer and never an error.
 *
 * Fails to null rather than throwing: a D1 hiccup must leave the preview as a
 * preview with no resolved seat, never break the request it is decorating.
 */
export async function resolvePreviewContactId(
  drizzle: Drizzle,
  orgId: string,
): Promise<string | null> {
  try {
    const [contact] = await drizzle
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(eq(schema.contacts.orgId, orgId))
      .orderBy(desc(schema.contacts.isPrimary))
      .limit(1)
    return contact?.id ?? null
  } catch {
    return null
  }
}

/**
 * Match the contacts row this request is answering for, inside one org.
 *
 * `previewContactId` is `getPortalAuth().contactId`, which is set only while a
 * studio session previews a client. Absent (every real client session) this is
 * byte for byte the predicate the routes already carried, so a client read is
 * unchanged.
 *
 * The org filter is not optional and is applied on BOTH branches: one person
 * can be a contact at two client orgs on the same Clerk account, and an
 * unscoped lookup would pick whichever row came back first (CLAUDE.md rule 12).
 */
export function contactIdentityWhere(
  orgId: string,
  userId: string,
  previewContactId?: string | null,
): SQL | undefined {
  const seat = previewContactId
    ? eq(schema.contacts.id, previewContactId)
    : eq(schema.contacts.clerkUserId, userId)
  return and(eq(schema.contacts.orgId, orgId), seat)
}
