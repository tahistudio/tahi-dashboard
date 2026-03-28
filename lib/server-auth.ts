/**
 * server-auth.ts
 *
 * Auth helpers for both API route handlers and Server Components.
 *
 * Webflow Cloud requires `middleware.external: true` in open-next.config.ts,
 * which means Clerk's clerkMiddleware() runs in a SEPARATE Cloudflare Worker
 * from the server RSC/API worker.  The `auth()` function from @clerk/nextjs/server
 * relies on request-context headers injected by clerkMiddleware : but those headers
 * are NOT reliably forwarded from the middleware worker to the server worker.
 *
 * This module provides:
 *   - `getRequestAuth(req)`  : for API route handlers (accepts NextRequest)
 *   - `getServerAuth()`      : for Server Components (reads cookies via next/headers)
 *
 * Both helpers:
 *   1. Try the standard `auth()` first (fast path; works if headers ARE forwarded)
 *   2. Fall back to @clerk/backend authenticateRequest() which validates the
 *      Clerk session JWT directly from cookies : no middleware signal needed.
 *
 * Usage in API routes:
 *   const { userId, orgId } = await getRequestAuth(req)
 *   if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 *
 * Usage in Server Components / page.tsx:
 *   const { userId, orgId } = await getServerAuth()
 *   if (!userId) redirect('/sign-in')
 */

import { auth } from '@clerk/nextjs/server'
import { createClerkClient } from '@clerk/backend'
import { cookies, headers } from 'next/headers'
import type { NextRequest } from 'next/server'

export interface RequestAuthResult {
  userId: string | null
  orgId: string | null
  sessionId: string | null
}

let _clerk: ReturnType<typeof createClerkClient> | null = null
function getClerkClient() {
  if (!_clerk) {
    _clerk = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY!,
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    })
  }
  return _clerk
}

/**
 * Get auth state from an API route's NextRequest.
 * Falls back to direct cookie authentication if clerkMiddleware headers
 * were not forwarded from the edge middleware worker.
 */
export async function getRequestAuth(req: NextRequest): Promise<RequestAuthResult> {
  // Fast path: try the standard auth() : works when middleware headers ARE forwarded
  try {
    const a = await auth()
    if (a.userId) {
      return {
        userId: a.userId,
        orgId: a.orgId ?? null,
        sessionId: a.sessionId ?? null,
      }
    }
  } catch {
    // auth() threw : middleware headers not forwarded; fall through to direct auth
  }

  // Fallback: validate directly from the Clerk session cookie
  try {
    const clerk = getClerkClient()
    const authorizedParties = [
      process.env.NEXT_PUBLIC_APP_URL,
      'https://tahi-test-dashboard.webflow.io',
      'http://localhost:3000',
    ].filter(Boolean) as string[]

    const authState = await clerk.authenticateRequest(req, { authorizedParties })

    if (!authState.isSignedIn) {
      return { userId: null, orgId: null, sessionId: null }
    }

    const result = authState.toAuth()
    return {
      userId: result.userId ?? null,
      orgId: result.orgId ?? null,
      sessionId: result.sessionId ?? null,
    }
  } catch {
    return { userId: null, orgId: null, sessionId: null }
  }
}

/**
 * Get auth state inside a Server Component / page.tsx.
 * Builds a synthetic Request from next/headers cookies so @clerk/backend
 * can validate the session JWT directly : no middleware signal needed.
 */
export async function getServerAuth(): Promise<RequestAuthResult> {
  // Fast path: try the standard auth() : works when middleware headers ARE forwarded
  try {
    const a = await auth()
    if (a.userId) {
      return {
        userId: a.userId,
        orgId: a.orgId ?? null,
        sessionId: a.sessionId ?? null,
      }
    }
  } catch {
    // auth() threw : fall through to direct auth
  }

  // Fallback: build a synthetic Request from next/headers and validate via @clerk/backend
  try {
    const cookieStore = await cookies()
    const headerStore = await headers()

    const cookieString = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ')
    const host = headerStore.get('host') ?? 'localhost'
    const proto = headerStore.get('x-forwarded-proto') ?? 'https'

    const syntheticReq = new Request(`${proto}://${host}/`, {
      headers: {
        cookie: cookieString,
        host,
      },
    })

    const clerk = getClerkClient()
    const authorizedParties = [
      process.env.NEXT_PUBLIC_APP_URL,
      'https://tahi-test-dashboard.webflow.io',
      'http://localhost:3000',
    ].filter(Boolean) as string[]

    const authState = await clerk.authenticateRequest(syntheticReq, { authorizedParties })

    if (!authState.isSignedIn) {
      return { userId: null, orgId: null, sessionId: null }
    }

    const result = authState.toAuth()
    return {
      userId: result.userId ?? null,
      orgId: result.orgId ?? null,
      sessionId: result.sessionId ?? null,
    }
  } catch {
    return { userId: null, orgId: null, sessionId: null }
  }
}

/** Convenience: check admin access (must be in Tahi Studio org). */
export function isTahiAdmin(orgId: string | null): boolean {
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID
  return !!(tahiOrgId && orgId === tahiOrgId)
}
