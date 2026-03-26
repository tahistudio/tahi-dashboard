import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Public routes — no auth needed
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/portal/accept-invite(.*)',
  '/demo(.*)',
  '/api/webhooks/(.*)',
  '/api/case-study/(.*)',
])

// Admin-only routes — requires Tahi org membership
const isAdminRoute = createRouteMatcher([
  '/admin(.*)',
  '/api/admin/(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  // Allow public routes
  if (isPublicRoute(req)) {
    return NextResponse.next()
  }

  // Protect all other routes
  await auth.protect()

  // For admin routes, validate Tahi org membership
  if (isAdminRoute(req)) {
    const { orgId } = await auth()
    const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID

    if (!tahiOrgId || orgId !== tahiOrgId) {
      // Not Tahi team — redirect to portal
      return NextResponse.redirect(new URL('/portal', req.url))
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
}
