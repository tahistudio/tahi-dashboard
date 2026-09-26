/**
 * lib/submitter-brand.ts
 *
 * Which brand a request a client files lands under.
 *
 * A brand-linked contact only ever sees requests whose brand is one of theirs
 * (the portal list filters on it, and the client notification audience
 * applies the same rule), so filing without a brand hides the request from
 * the person who filed it and takes their reply and delivery emails with it.
 * A submitter who holds any link therefore always gets one written.
 *
 * Shared by the two doors a client files through: the portal's POST
 * /api/portal/requests, and a client's own Slack draft when it is approved
 * (lib/task-suggestions.ts applyRequestSuggestion). One rule, so the request
 * a client files in Slack is visible to them in the portal exactly as one
 * filed there would be.
 */

import { asc, eq } from 'drizzle-orm'
import { schema } from '@/db/d1'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** How many brand links are read for one submitter. Far past any real client. */
export const BRAND_LINK_LIMIT = 50

/**
 * The brand for a request this contact files.
 *
 * `asked` is the dialog's answer once it grows a picker, and is honoured only
 * when it is one of this submitter's own links: an arbitrary id on the body
 * must never stamp another client's brand onto this row. Otherwise the first
 * link wins, ordered so the same person filing twice lands on the same brand.
 *
 * Null means the submitter holds no links at all, which is the org-wide row:
 * visible to every contact at the org who is likewise unlinked, and invisible
 * to brand-scoped ones, in the list and in the inbox alike.
 *
 * The caller still has to check the brand belongs to the org it files under
 * (createRequestRecord does); a link is a contact's, not a tenant check.
 *
 * Never throws: a brand lookup failure costs the brand, not the request.
 */
export async function resolveSubmitterBrandId(
  drizzle: Drizzle,
  contactId: string,
  asked: string | null = null,
): Promise<string | null> {
  try {
    const links = await drizzle
      .select({ brandId: schema.brandContacts.brandId })
      .from(schema.brandContacts)
      .where(eq(schema.brandContacts.contactId, contactId))
      .orderBy(asc(schema.brandContacts.createdAt), asc(schema.brandContacts.brandId))
      .limit(BRAND_LINK_LIMIT)
    const ids = links.map((l) => l.brandId).filter((b): b is string => !!b)
    if (ids.length === 0) return null
    if (asked && ids.includes(asked)) return asked
    return ids[0]
  } catch {
    return null
  }
}
