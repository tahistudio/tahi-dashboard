/**
 * lib/preview-cookie.ts: ONE definition of "this session is previewing a
 * client", shared by the middleware and by lib/view-audience.ts.
 *
 * They used to disagree. The middleware bounced /clients, /reports, /time,
 * /team and /docs whenever the tahi-impersonate-org cookie was merely present,
 * with no session check and no validation, while resolveViewAudience ignored
 * the same cookie for anyone outside the Tahi org. Harmless while both ended
 * at the same redirect, but two rules for one question drift, and the
 * middleware's half turned a stale or junk cookie into a lockout: the way out
 * was an Exit preview button that renders from the dashboard shell, which is
 * exactly what is not rendering when something in that shell is broken.
 *
 * The rules, in one place:
 *   - Only a Tahi session may preview. Any other session ignores the cookie
 *     outright, so a client who forges one gains nothing.
 *   - The value must look like an org id. A blank, malformed or oversized
 *     cookie is no preview at all, rather than a preview of nothing.
 *
 * Deliberately free of next/headers, Clerk and D1 so the middleware can import
 * it without dragging the server-auth stack into the edge bundle.
 */

/** Cookie <ImpersonationBanner> writes when Client view is switched on. */
export const IMPERSONATE_ORG_COOKIE = 'tahi-impersonate-org'

/**
 * Query param that clears the cookie from the middleware, before any page
 * renders. The escape hatch for a preview whose shell will not paint.
 */
export const EXIT_PREVIEW_PARAM = 'exit-preview'

/**
 * An `organisations.id` (a UUID) or, for a pre-link legacy row, the Clerk org
 * id used as the primary key (`org_...`). Both are opaque ids of bounded
 * length, so the shape check is deliberately about SHAPE, not existence: it
 * costs no query and it rejects the junk (empty strings, paths, whole JSON
 * blobs) that a hand-edited or half-written cookie leaves behind.
 */
const ORG_ID_SHAPE = /^[A-Za-z0-9_-]{8,64}$/

/** Decode a raw cookie value and keep it only if it could name an org. */
export function readPreviewOrgId(raw: string | null | undefined): string | null {
  if (!raw) return null
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // Malformed percent-encoding: judge the raw value instead of throwing.
    decoded = raw
  }
  const trimmed = decoded.trim()
  return ORG_ID_SHAPE.test(trimmed) ? trimmed : null
}

/**
 * The org this session is previewing, or null. The single answer both the
 * middleware and every server component branch on.
 */
export function resolvePreviewOrgId(
  isAdmin: boolean,
  rawCookie: string | null | undefined,
): string | null {
  if (!isAdmin) return null
  return readPreviewOrgId(rawCookie)
}
