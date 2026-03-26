import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Public routes — no auth needed
// Note: basePath (/dashboard) is handled by Next.js, these are app-relative paths
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/demo(.*)',
  '/api/webhooks/(.*)',
  '/api/case-study/(.*)',
])

// Admin-only routes — if a client hits these, redirect them to /requests
const isAdminOnlyRoute = createRouteMatcher([
  '/clients(.*)',
  '/billing(.*)',
  '/reports(.*)',
  '/time(.*)',
  '/team(.*)',
  '/docs(.*)',
])

// Client-only routes — if admin hits these, they get redirected to /requests
const isClientOnlyRoute = createRouteMatcher([
  '/files(.*)',
  '/services(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  // Allow public routes without auth
  if (isPublicRoute(req)) return NextResponse.next()

  // Require auth for everything else
  await auth.protect()

  const { orgId } = await auth()
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  const isAdmin = tahiOrgId && orgId === tahiOrgId

  // Client hitting an admin-only route → send to /requests
  if (isAdminOnlyRoute(req) && !isAdmin) {
    return NextResponse.redirect(new URL('/requests', req.url))
  }

  // Admin hitting a client-only route → send to /requests
  if (isClientOnlyRoute(req) && isAdmin) {
    return NextResponse.redirect(new URL('/requests', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
