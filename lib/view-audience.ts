/**
 * lib/view-audience.ts: which audience a server component should render for.
 *
 * `getServerAuth()` answers "who is signed in": while a Tahi operator previews
 * the portal with Client view, their Clerk org is STILL the Tahi org, so every
 * `const isAdmin = orgId === NEXT_PUBLIC_TAHI_ORG_ID` in a page.tsx stays true
 * and the studio surface renders inside the client shell. Only components that
 * call `useImpersonation()` flipped, which is why the preview leaked other
 * clients' names, plans and money into a screen meant to show one client their
 * own workspace.
 *
 * The signal the operator's browser already carries is the `tahi-impersonate-org`
 * cookie (set by <ImpersonationBanner>, read server-side by `getPortalAuth` so
 * portal APIs answer for the previewed org). This helper reads BOTH, so a page
 * can branch or redirect exactly the way it would for a real client:
 *
 *   const { userId, isAdmin, isPreviewingClient } = await getViewAudience()
 *   if (!userId) redirect('/sign-in')
 *   if (!isAdmin || isPreviewingClient) redirect('/overview')   // studio-only page
 *
 *   // or, where a client branch already exists:
 *   return <Content isAdmin={isAdmin && !isPreviewingClient} />
 *
 * This is preview FIDELITY, not tenancy: a real client never had access to
 * these pages (they are redirected here and 403'd by every admin API). Nothing
 * below grants anything; it only takes the studio surface away from a preview.
 */

import { cookies } from 'next/headers'
import { getServerAuth } from '@/lib/server-auth'
import { IMPERSONATE_ORG_COOKIE, resolvePreviewOrgId } from '@/lib/preview-cookie'

/**
 * Re-exported so a page needing the cookie name does not have to know where
 * the rules live. The rules themselves are in lib/preview-cookie.ts, which the
 * middleware imports too: one definition of previewing, not two.
 */
export { IMPERSONATE_ORG_COOKIE }

export interface ViewAudience {
  /** Signed-in Clerk user, or null when there is no session. */
  userId: string | null
  /** The session's Clerk org id, unchanged by any preview. */
  orgId: string | null
  /** The session belongs to the Tahi Studio org. */
  isAdmin: boolean
  /** A Tahi session currently previewing the portal as one client. */
  isPreviewingClient: boolean
  /** D1 organisations.id being previewed, else null. */
  previewOrgId: string | null
  /**
   * Render for the client audience: either a real client session, or a studio
   * session inside Client view. The one flag a page should branch on.
   */
  isClientAudience: boolean
}

export interface ViewAudienceInput {
  userId: string | null
  orgId: string | null
  tahiOrgId: string | null | undefined
  /** Raw `tahi-impersonate-org` cookie value, if present. */
  impersonateOrgId: string | null | undefined
}

/**
 * Pure resolver, exported so the rules are testable without Clerk or cookies.
 *
 * Only the Tahi org may preview, and only a value that could name an org
 * counts: both rules come from lib/preview-cookie.ts, which the middleware
 * uses as well, so a client who forges the cookie gains nothing and a stale or
 * malformed one is not a preview of anything.
 */
export function resolveViewAudience(input: ViewAudienceInput): ViewAudience {
  const { userId, orgId, tahiOrgId } = input
  const isAdmin = !!tahiOrgId && orgId === tahiOrgId
  const previewOrgId = resolvePreviewOrgId(isAdmin, input.impersonateOrgId)
  const isPreviewingClient = previewOrgId !== null
  return {
    userId,
    orgId,
    isAdmin,
    isPreviewingClient,
    previewOrgId,
    isClientAudience: !isAdmin || isPreviewingClient,
  }
}

/**
 * Server-component entry point. Reads the Clerk session and the Client view
 * cookie in one go; safe to call from any page.tsx or layout.
 */
export async function getViewAudience(): Promise<ViewAudience> {
  const { userId, orgId } = await getServerAuth()
  let impersonateOrgId: string | null = null
  try {
    // Raw on purpose: resolvePreviewOrgId owns the decoding, so the middleware
    // and this path cannot disagree about what a percent-encoded value means.
    impersonateOrgId = (await cookies()).get(IMPERSONATE_ORG_COOKIE)?.value ?? null
  } catch {
    // No cookie store (static render): treat as no preview.
    impersonateOrgId = null
  }
  return resolveViewAudience({
    userId,
    orgId,
    tahiOrgId: process.env.NEXT_PUBLIC_TAHI_ORG_ID,
    impersonateOrgId,
  })
}
