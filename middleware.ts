import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import {
  EXIT_PREVIEW_PARAM,
  IMPERSONATE_ORG_COOKIE,
  resolvePreviewOrgId,
} from '@/lib/preview-cookie'

// Public routes : no auth needed. The app serves at the domain root (no
// basePath), so a logged-out signer hitting /p/contract/<token> is never
// bounced to /sign-in.
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/demo(.*)',
  '/api/webhooks/(.*)',
  '/api/case-study/(.*)',
  '/api/admin/docs/seed(.*)',
  // Scheduled-trigger endpoints — they authenticate themselves via
  // x-cron-secret in the route handler (Decision #043). Clerk's middleware
  // doesn't know about that header so must let the request through.
  '/api/admin/ai/briefing/cron(.*)',
  // The other scheduled targets in .github/workflows/dashboard-crons.yml.
  // Each handler checks x-cron-secret (or Bearer) itself and otherwise falls
  // back to requiring a Tahi admin session, so an unauthenticated call without
  // the secret is refused by the route, not by Clerk. Only the scheduled
  // routes are listed; the rest of /api/admin/cron stays behind Clerk.
  '/api/admin/cron/pre-call-digest(.*)',
  '/api/admin/cron/auto-promote-calls(.*)',
  '/api/admin/cron/leads-ai(.*)',
  '/api/admin/cron/sync-xero(.*)',
  '/api/admin/cron/sync-stripe(.*)',
  '/api/admin/cron/daily-summary(.*)',
  '/api/admin/cron/affiliate-reactivation(.*)',
  '/api/admin/cron/snapshot-metrics(.*)',
  '/api/admin/cron/finance-anomaly-scan(.*)',
  '/api/admin/cron/content-auto-backfill(.*)',
  '/api/admin/cron/content-gap-hunt(.*)',
  '/api/admin/cron/schema-watchdog(.*)',
  '/api/admin/cron/indexing-reverser(.*)',
  '/api/admin/cron/publish-scheduled(.*)',
  '/api/admin/integrations/google/sync-calendar(.*)',
  '/api/admin/integrations/google/sync-drive-transcripts(.*)',
  '/api/admin/integrations/airwallex/sync(.*)',
  '/api/admin/overview/brief/refresh(.*)',
  // OAuth callbacks from third-party providers (Google, Xero, etc.) need
  // to bypass Clerk middleware because the cross-origin redirect from
  // accounts.google.com / login.xero.com loses the Clerk session cookie
  // in some browser SameSite + cookie-prefix combinations. The route
  // handler still validates: the single-use authorisation code is bound
  // to our registered redirect_uri, and the token exchange would fail
  // for a forged request. After successful exchange, the handler
  // redirects back to /settings#<service>?connected=1 which IS Clerk-
  // protected, so the user has to be signed in to actually see results.
  '/api/admin/integrations/google/callback(.*)',
  '/api/admin/integrations/xero/callback(.*)',
  // Public-share routes for schedules / proposals / contracts. Token-based
  // access — the route handler validates the token before returning data.
  // Pages live under /p/<resource>/<token>; their data APIs under /api/public.
  '/p/(.*)',
  '/api/public/(.*)',
  // External-client review form. The email CTA flow lands here via
  // /api/public/review/respond, which redirects to /review/<token>; the token
  // is validated by the /api/public/review data routes, so the page itself
  // must not sit behind the sign-in wall.
  '/review/(.*)',
  // The PWA offline fallback. public/sw.js precaches '/offline' at install; a
  // signed-out fetch of a protected route answers with a redirect to /sign-in,
  // and Cache.addAll REJECTS a redirect, so leaving it behind the wall could
  // fail the install and leave the people most likely to need the fallback
  // without one. The page itself shows no data.
  '/offline',
])

// Admin-only routes : if a client hits these, redirect them to /requests.
//
// /billing is deliberately NOT here. app/(dashboard)/billing/page.tsx renders
// an audience branch (<BillingContent isAdmin>) whose client half is a real
// portal surface: plan, invoices and the Stripe customer portal, all fed by
// org-scoped /api/portal/* routes. Clients are linked there from the overview
// CTA map, the tracks upgrade button and every 'subscription' notification, so
// a blanket matcher here bounced them off a page that works. The admin half is
// still gated by requirePageFeature('billing') inside the page.
const isAdminOnlyRoute = createRouteMatcher([
  '/clients(.*)',
  '/reports(.*)',
  '/time(.*)',
  '/team(.*)',
  '/docs(.*)',
])

// Client-only routes : if admin hits these, they get redirected to /requests
const isClientOnlyRoute = createRouteMatcher([
  '/files(.*)',
  '/services(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  // Dev-only: auto-auth the Ship Studio preview wrapper, which loads the local
  // dev server but can't complete Clerk's browser sign-in. The wrapper marks
  // its page loads with ?shipstudio=1 and/or runs headless Chrome; we persist
  // that to a cookie and inject x-ship-studio so the server auth helpers see it
  // on the same request, then let it through without auth.protect(). HARD-GATED
  // to development: Next inlines NODE_ENV at build time, so this whole block is
  // dead-code-eliminated from the production Cloudflare bundle and can never run
  // on a deployed environment.
  if (process.env.NODE_ENV !== 'production') {
    // Explicit ?shipstudio=1 (or the cookie it sets) only. The User-Agent
    // triggers (HeadlessChrome, Edg/) were removed: 'Edg/' matches every
    // Microsoft Edge user, so the bypass would fire for normal Edge browsers
    // on any non-prod exposure. Prod build strips this whole block.
    const isStudio =
      req.nextUrl.searchParams.get('shipstudio') === '1' ||
      req.cookies.get('tahi-ship-studio')?.value === '1'
    if (isStudio) {
      const headers = new Headers(req.headers)
      headers.set('x-ship-studio', '1')
      // Bare root → send the wrapper straight to the dashboard. The cloned URL
      // keeps ?shipstudio=1 so the redirect target is still recognised.
      if (req.nextUrl.pathname === '/') {
        const url = req.nextUrl.clone()
        url.pathname = '/overview'
        const redir = NextResponse.redirect(url)
        redir.cookies.set('tahi-ship-studio', '1', { path: '/', sameSite: 'lax' })
        return redir
      }
      const res = NextResponse.next({ request: { headers } })
      res.cookies.set('tahi-ship-studio', '1', { path: '/', sameSite: 'lax' })
      return res
    }
  }

  // Allow public routes without auth
  if (isPublicRoute(req)) return NextResponse.next()

  // Service-to-service Bearer bypass for /api/*. DO NOT REMOVE without a
  // migration plan: the worker MCP connector (workers/mcp-server, the owner's
  // live Claude connector) calls portal.tahi.studio/api/admin/* with
  // `Authorization: Bearer TAHI_API_TOKEN` and no Clerk session, and
  // assertCronAuth also accepts `Bearer TAHI_CRON_SECRET`. Clerk treats a
  // non-Clerk Bearer as unauthenticated, so auth.protect() would 404 those
  // callers before the route handler could validate the token (verified live
  // 2026-08-18: junk Bearer reaches the handler and gets its 403; the same
  // request without a Bearer is 404'd here). This bypass grants nothing by
  // itself: every /api route must still self-authenticate via
  // getRequestAuth() / assertCronAuth(), which validate the token server-side.
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ') && req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Onboarding / welcome entry: persist the invite token from the link into a
  // cookie so it survives the Clerk sign-in -> sign-up round-trip. The redirect
  // query param is dropped twice on that journey (the auth footer "Sign up"
  // link is static, and the org-creation task hands off to the configured
  // after-sign-up URL), which would otherwise strand an invited client in the
  // self-serve chooser instead of their pre-set flow. The onboarding page
  // recovers the token from this cookie when the URL no longer carries it, and
  // accept-invite clears it once consumed. We resolve auth and the redirect
  // here (rather than auth.protect()) so the cookie can ride the response.
  {
    const p = req.nextUrl.pathname
    if (p.startsWith('/onboarding') || p.startsWith('/welcome')) {
      const linkToken = req.nextUrl.searchParams.get('token')
      const { userId } = await auth()
      let res: NextResponse
      if (!userId) {
        const target = p + (req.nextUrl.search || '')
        const url = req.nextUrl.clone()
        url.pathname = '/sign-in'
        url.search = ''
        url.searchParams.set('redirect_url', target)
        res = NextResponse.redirect(url)
      } else {
        res = NextResponse.next()
      }
      if (linkToken) {
        res.cookies.set('tahi-invite-token', linkToken, {
          path: '/',
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60, // 1 hour: long enough to finish sign-up, short-lived after
        })
      }
      return res
    }
  }

  // Bare domain root: redirect to the right home at the edge. The page-level
  // RSC redirect renders Next's 404 in the OpenNext external-middleware setup,
  // so we resolve it here where NextResponse.redirect is reliable.
  if (req.nextUrl.pathname === '/') {
    const { userId } = await auth()
    const url = req.nextUrl.clone()
    url.pathname = userId ? '/overview' : '/sign-in'
    return NextResponse.redirect(url)
  }

  // Require Clerk auth for everything else
  await auth.protect()

  const { orgId } = await auth()
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  const isAdmin = tahiOrgId && orgId === tahiOrgId

  // Approved-client gate. A signed-in user with NO active org is a lead (e.g.
  // someone who just signed up or submitted a project enquiry), not a
  // provisioned client or teammate. Confine them to the onboarding flow; never
  // let them reach the dashboard shell. Admins/teammates live in the Tahi org
  // and clients have their own org, so both carry an orgId. Page routes only —
  // API routes self-guard (portal routes already 403 a null/Tahi org), and the
  // onboarding/welcome flow must stay reachable for a no-org lead.
  const path = req.nextUrl.pathname
  const inOnboarding = path.startsWith('/onboarding') || path.startsWith('/welcome')
  if (!orgId && !inOnboarding && !path.startsWith('/api/')) {
    const url = req.nextUrl.clone()
    url.pathname = '/onboarding'
    return NextResponse.redirect(url)
  }

  // Escape hatch, first, before any gate can bounce it. Append ?exit-preview=1
  // to ANY url to drop Client view and land on that same page as yourself. The
  // normal way out is the Exit preview button, which renders from the dashboard
  // shell: exactly the thing that is not painting when a shell bug or a stale
  // cookie has an operator stuck. This runs in the middleware, so it works when
  // nothing else does. Same clearing contract as clearImpersonateOrgCookie in
  // components/tahi/impersonation-banner.tsx.
  if (req.nextUrl.searchParams.get(EXIT_PREVIEW_PARAM) === '1') {
    const url = req.nextUrl.clone()
    url.searchParams.delete(EXIT_PREVIEW_PARAM)
    const res = NextResponse.redirect(url)
    res.cookies.set(IMPERSONATE_ORG_COOKIE, '', { path: '/', maxAge: 0, sameSite: 'lax' })
    return res
  }

  // Client view (the tahi-impersonate-org cookie) is a PREVIEW of the portal,
  // not an admin audience: while it is on, an operator must leave an admin-only
  // route the same way the previewed client would. Every studio-only page
  // resolves this in its own page.tsx via getViewAudience(); the check also
  // lives here because the /clients tree (list, detail, brands, contacts) is the
  // widest leak a preview can hit, one Back press from entering it, and one
  // matcher covers the whole subtree.
  //
  // resolvePreviewOrgId is the SAME rule getViewAudience() applies server-side
  // (lib/preview-cookie.ts): only a Tahi session may preview, and only a value
  // that could name an org counts. Reading the cookie raw here, as this used
  // to, gave the middleware its own second definition, under which a client's
  // forged cookie and an admin's half-written one both counted as a preview.
  const previewingClient = resolvePreviewOrgId(
    Boolean(isAdmin),
    req.cookies.get(IMPERSONATE_ORG_COOKIE)?.value,
  ) !== null

  // Client (or a Client-view preview) hitting an admin-only route → /requests
  // Use req.nextUrl.clone() so Next.js adds the basePath (/dashboard) automatically
  if (isAdminOnlyRoute(req) && (!isAdmin || previewingClient)) {
    const url = req.nextUrl.clone()
    url.pathname = '/requests'
    return NextResponse.redirect(url)
  }

  // Admin hitting a client-only route → send to /requests, unless they are
  // previewing the portal as a client (the impersonation cookie names the org
  // the portal routes answer for), in which case the client page renders.
  if (isClientOnlyRoute(req) && isAdmin && !previewingClient) {
    const url = req.nextUrl.clone()
    url.pathname = '/requests'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
