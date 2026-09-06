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
 *   - A preview is READ-ONLY unless a second cookie says otherwise, and even
 *     then the cookie is only a request: lib/server-auth.ts proves the session
 *     is a super admin before Act as client is granted.
 *
 * Deliberately free of next/headers, Clerk and D1 so the middleware can import
 * it without dragging the server-auth stack into the edge bundle.
 */

/** Cookie <ImpersonationBanner> writes when Client view is switched on. */
export const IMPERSONATE_ORG_COOKIE = 'tahi-impersonate-org'

/**
 * Cookie that turns Client view from a lens into a hand ("Act as client").
 *
 * A SECOND cookie rather than a value folded into the org cookie, for two
 * reasons. The org cookie's shape check above must keep judging one thing (does
 * this name an org), and a mode must not be able to survive a client switch or
 * a half-written org value: clearing the org cookie without clearing this one
 * would leave an operator armed with no target, and the reverse would leave a
 * target armed with no operator intent.
 *
 * INTENT, NEVER AUTHORITY. The banner writes it from JavaScript, so anything
 * with a console can forge it. `getPortalAuth` re-derives the right to act from
 * the roles table on every request (super_admin only, and only for a session
 * that is already the Tahi org), so a forged value buys nothing.
 */
export const IMPERSONATE_MODE_COOKIE = 'tahi-impersonate-mode'

/**
 * `view` is the historical, read-only Client view. `act` is Act as client:
 * writes land in the client's workspace, attributed to the studio member who
 * made them and recorded in the audit log.
 */
export type PreviewMode = 'view' | 'act'

/** The one value that means "writes are real". Anything else is a lens. */
export const ACT_MODE_VALUE = 'act'

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
 * Decode a raw mode cookie. Fails to `view`, which is the read-only side, so
 * junk, a truncated write, a stale value from an older build and a missing
 * cookie all land on the mode that cannot change anything. Only the exact
 * literal `act` counts.
 */
export function readPreviewMode(raw: string | null | undefined): PreviewMode {
  if (!raw) return 'view'
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  return decoded.trim() === ACT_MODE_VALUE ? 'act' : 'view'
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
