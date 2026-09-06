/**
 * POST/GET /api/admin/impersonate/exit : drop Client view, no shell required.
 *
 * The normal way out of a preview is the Exit preview button in
 * <ImpersonationBanner>, which renders from the dashboard layout. That is the
 * one thing guaranteed to be missing when a shell bug, a stale cookie or a
 * half-written one leaves an operator previewing a client with no way back:
 * the studio-only routes bounce them and the button that would fix it never
 * paints. This route clears the cookie with nothing but the middleware in
 * front of it.
 *
 * There is a second hatch that needs no url of its own: append
 * `?exit-preview=1` to any page (middleware.ts, EXIT_PREVIEW_PARAM).
 *
 * No admin check on purpose. The only thing this touches is a cookie in the
 * caller's own browser, and refusing to clear it for the sessions that are not
 * supposed to hold one would be exactly backwards.
 */

import { NextRequest, NextResponse } from 'next/server'
import { IMPERSONATE_ORG_COOKIE } from '@/lib/preview-cookie'

/** Same contract as clearImpersonateOrgCookie in the banner: path=/, expired. */
function clear(res: NextResponse): NextResponse {
  res.cookies.set(IMPERSONATE_ORG_COOKIE, '', { path: '/', maxAge: 0, sameSite: 'lax' })
  return res
}

/**
 * Typed by hand in the url bar: land somewhere the studio can work from.
 * `?next=` takes a bare same-origin path only (no scheme, no host, no
 * protocol-relative `//`, no query), so it cannot be pointed anywhere else.
 */
export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get('next')
  const safeNext = requested && /^\/[A-Za-z0-9][A-Za-z0-9\-_/]*$/.test(requested)
    ? requested
    : '/clients'
  const url = req.nextUrl.clone()
  url.pathname = safeNext
  url.search = ''
  return clear(NextResponse.redirect(url))
}

export async function POST() {
  return clear(NextResponse.json({ ok: true, previewing: false }))
}
