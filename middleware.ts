import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Public routes : no auth needed.
// Next.js strips the basePath (/dashboard) before middleware sees the path,
// so these are app-relative paths (e.g. '/sign-in' not '/dashboard/sign-in').
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/demo(.*)',
  '/api/webhooks/(.*)',
  '/api/case-study/(.*)',
  '/api/admin/docs/seed(.*)',
])

// Admin-only routes : if a client hits these, redirect them to /requests
const isAdminOnlyRoute = createRouteMatcher([
  '/clients(.*)',
  '/billing(.*)',
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
  // Allow public routes without auth
  if (isPublicRoute(req)) return NextResponse.next()

  // Allow Bearer token auth for API routes (MCP server, service-to-service)
  // The actual token validation happens in getRequestAuth() in the route handler
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ') && req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Require Clerk auth for everything else
  await auth.protect()

  const { orgId } = await auth()
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  const isAdmin = tahiOrgId && orgId === tahiOrgId

  // Client hitting an admin-only route → send to /requests
  // Use req.nextUrl.clone() so Next.js adds the basePath (/dashboard) automatically
  if (isAdminOnlyRoute(req) && !isAdmin) {
    const url = req.nextUrl.clone()
    url.pathname = '/requests'
    return NextResponse.redirect(url)
  }

  // Admin hitting a client-only route → send to /requests
  if (isClientOnlyRoute(req) && isAdmin) {
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
