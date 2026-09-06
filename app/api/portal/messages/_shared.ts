/**
 * app/api/portal/messages/_shared.ts
 *
 * The gate every /api/portal/messages route runs before it reads anything.
 *
 * It is not `definePortalRoute` for one reason: MCP parity (CLAUDE.md rule 14).
 * The worker's `portal_*` tools authenticate with TAHI_API_TOKEN, which
 * `getRequestAuth` resolves to userId 'api-service' carrying the TAHI org id,
 * and every portal helper refuses the Tahi org by design. So the service token
 * gets one narrow branch: it must NAME the client org explicitly, in `?orgId=`
 * or in the body, exactly the way an admin names a target org on
 * /api/uploads/confirm. A human caller can never take that branch, and the
 * token is already trusted for the whole admin surface.
 *
 * Everything else is the standard portal boilerplate, in the standard order:
 *   getPortalAuth  ->  refuse the Tahi org  ->  requirePortalFeature('messages')
 *   ->  (writes) refuse a read-only impersonation preview.
 *
 * The feature key is the EXISTING `messages` node in lib/feature-tree.ts, so
 * Liam turns the whole surface on and off per client from /permissions without
 * a second switch to keep in sync.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPortalAuth } from '@/lib/server-auth'
import { requirePortalFeature } from '@/lib/require-feature'
import { contactIdentityWhere } from '@/lib/portal-identity'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import type { InboxViewer } from '@/lib/messages-store'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export const MESSAGES_FEATURE_KEY = 'messages'

export interface PortalMessagesContext {
  database: DrizzleDB
  orgId: string
  userId: string
  impersonating: boolean
  viewer: InboxViewer
  /** The contact's display name, so a write does not re-read the row the gate
   *  already resolved just to sign an email with it. */
  contactName: string | null
}

export type PortalMessagesGate =
  | { ok: false; response: NextResponse }
  | { ok: true; ctx: PortalMessagesContext }

function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

/**
 * Resolve the caller, the client org they are reading, and the two ids their
 * unread cursors live under.
 *
 * `serviceOrgId` is the org named by an MCP call; it is ignored for anybody
 * who is not the service token.
 */
export async function gatePortalMessages(
  req: NextRequest,
  opts: { write: boolean; serviceOrgId?: string | null } = { write: false },
): Promise<PortalMessagesGate> {
  const { orgId, userId, impersonating, clerkOrgId, contactId: previewContactId } =
    await getPortalAuth(req)
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // MCP parity branch. Nothing else can reach it: 'api-service' is minted only
  // for a verified TAHI_API_TOKEN (lib/server-auth.ts).
  const isService = userId === 'api-service'
  const named = opts.serviceOrgId?.trim() || null
  const targetOrgId = isService ? named : orgId

  if (!userId || !targetOrgId) return { ok: false, response: forbidden() }
  if (!isService && (!orgId || orgId === tahiOrgId)) return { ok: false, response: forbidden() }
  if (isService && targetOrgId === tahiOrgId) return { ok: false, response: forbidden() }

  const featureDenied = await requirePortalFeature(
    { userId, orgId: targetOrgId, clerkOrgId },
    MESSAGES_FEATURE_KEY,
  )
  if (featureDenied) return { ok: false, response: featureDenied }

  // A Tahi admin previewing a client portal reads, and only reads. The preview
  // is a lens on somebody else's inbox, so a reply from inside it would be
  // posted in their name.
  if (opts.write && impersonating) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Read-only in client view' }, { status: 403 }),
    }
  }

  const database = (await db()) as DrizzleDB

  // The contact row is resolved on BOTH the login and the org: one person can
  // be a contact at two client orgs on the same Clerk account, and an
  // unscoped lookup would pick whichever row came back first (CLAUDE.md
  // rule 12).
  //
  // In Client view the login is the operator's and matches nothing here, so
  // the preview read the client's inbox as nobody: their own replies looked
  // like somebody else's and the brand scope below opened to every brand.
  // `previewContactId` (lib/portal-identity.ts) is the seat being previewed.
  // Only READS are affected: a write in a preview is refused above, in both
  // modes, before this runs.
  //
  // Never for the service token, whose org comes from `?orgId=` rather than
  // from the preview cookie. A seat resolved for one org must not be applied
  // to a lookup scoped to another, however unlikely the cookie is to be there.
  const [contact] = await database
    .select({ id: schema.contacts.id, name: schema.contacts.name })
    .from(schema.contacts)
    .where(contactIdentityWhere(targetOrgId, userId, isService ? null : previewContactId))
    .limit(1)

  return {
    ok: true,
    ctx: {
      database,
      orgId: targetOrgId,
      userId,
      impersonating: !!impersonating,
      contactName: contact?.name?.trim() || null,
      viewer: {
        clerkUserId: userId,
        domainId: contact?.id ?? null,
        userType: 'contact',
      },
    },
  }
}

/** The org an MCP call named, from the query string. */
export function serviceOrgFromQuery(req: NextRequest): string | null {
  return new URL(req.url).searchParams.get('orgId')
}
