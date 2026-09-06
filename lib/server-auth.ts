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
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { desc, eq } from 'drizzle-orm'
import {
  IMPERSONATE_MODE_COOKIE,
  IMPERSONATE_ORG_COOKIE,
  readPreviewMode,
  resolvePreviewOrgId,
} from '@/lib/preview-cookie'
import { resolveActEligibility } from '@/lib/acting-eligibility'

export interface RequestAuthResult {
  userId: string | null
  orgId: string | null
  sessionId: string | null
}

/**
 * Who is standing in the client's shoes, while Act as client is armed.
 *
 * Every field names the STUDIO side of the write. There is deliberately no
 * "the contact we are pretending to be": attributing a row to a named client
 * person would forge that person, which is the exact thing this mode is built
 * to avoid. `contactId` is carried for the audit metadata only (which seat the
 * banner was pointed at) and must never become an author id.
 */
export interface ActingAsIdentity {
  /** Clerk user id of the studio member acting. The audit row's actorId. */
  adminUserId: string
  /** Their `team_members.id`. The value written to authorId / submittedById. */
  adminTeamMemberId: string
  /** Their display name, for the notification bodies that name a human. */
  adminName: string
  /** D1 `organisations.id` being acted in (same value as auth.orgId). */
  orgId: string
  /** Seat the banner named, for audit context only. Never an author id. */
  contactId: string | null
}

export type PortalAuthResult = RequestAuthResult & {
  clerkOrgId: string | null
  /**
   * A Tahi session is looking through a client's lens. Stays TRUE in act mode:
   * every hand-rolled `if (impersonating) 403` in the portal tree keeps
   * refusing until that route is deliberately opened via lib/acting-as.ts.
   */
  impersonating: boolean
  /**
   * Act as client is armed AND proven: a super admin with a team_members row.
   * The only flag a write route may open on. Optional so the ~15 route test
   * suites that build a portal auth by hand keep compiling; absent means no.
   */
  canWriteAsClient?: boolean
  /** Set exactly when canWriteAsClient is true. */
  actingAs?: ActingAsIdentity | null
}

// --- Dev-only Ship Studio preview auto-auth ---------------------------------
// The Ship Studio design wrapper loads the LOCAL dev server but can't complete
// Clerk's browser sign-in. Middleware tags wrapper requests (?shipstudio=1 /
// headless Chrome) with the x-ship-studio header + tahi-ship-studio cookie. In
// DEVELOPMENT ONLY we treat those as the Tahi admin so the dashboard renders.
// HARD-GATED to NODE_ENV !== 'production': Next inlines NODE_ENV at build time,
// so this branch is dead-code-eliminated from the production Cloudflare bundle
// and can never run on a deployed environment.
const SHIP_STUDIO_USER_ID = 'user_3BUxI1ofUJFOqt6AujKPVjfE7wN'

function shipStudioIdentity(): RequestAuthResult {
  return {
    userId: SHIP_STUDIO_USER_ID,
    orgId: process.env.NEXT_PUBLIC_TAHI_ORG_ID ?? null,
    sessionId: 'ship-studio-preview',
  }
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
 * Hosts allowed as the session JWT's azp (authorized party). The deployed
 * host comes from NEXT_PUBLIC_APP_URL, which deploy.yml bakes per
 * environment (prod: https://portal.tahi.studio, staging:
 * https://staging.tahi.studio), so both deployed environments are covered
 * without listing dev hosts. localhost and the retired preview hosts are
 * appended ONLY on non-production builds (Next inlines NODE_ENV at build
 * time, so they are absent from any deployed bundle).
 */
function getAuthorizedParties(): string[] {
  const parties = [
    process.env.NEXT_PUBLIC_APP_URL,
    'https://portal.tahi.studio',
  ]
  if (process.env.NODE_ENV !== 'production') {
    parties.push(
      'http://localhost:3000',
      'https://staging.tahi.studio',
      'https://tahi-dashboard-staging.business-ccd.workers.dev',
      'https://tahi-test-dashboard.webflow.io',
    )
  }
  return Array.from(new Set(parties.filter(Boolean) as string[]))
}

/**
 * Get auth state from an API route's NextRequest.
 * Falls back to direct cookie authentication if clerkMiddleware headers
 * were not forwarded from the edge middleware worker.
 */
export async function getRequestAuth(req: NextRequest): Promise<RequestAuthResult> {
  // Dev-only Ship Studio preview bypass (see note above; prod build strips this).
  // Triggered ONLY by the explicit ?shipstudio=1 signal (persisted to the
  // tahi-ship-studio cookie + x-ship-studio header by middleware). The old
  // User-Agent triggers (HeadlessChrome, Edg/) were removed: 'Edg/' matches
  // every Microsoft Edge user, so on any non-prod exposure a normal Edge
  // browser would silently authenticate as the Tahi admin.
  if (process.env.NODE_ENV !== 'production') {
    if (
      req.headers.get('x-ship-studio') === '1' ||
      req.cookies.get('tahi-ship-studio')?.value === '1'
    ) {
      return shipStudioIdentity()
    }
  }

  // API key auth: for MCP server and service-to-service calls
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ') && process.env.TAHI_API_TOKEN) {
    const token = authHeader.slice(7)
    if (token === process.env.TAHI_API_TOKEN) {
      return {
        userId: 'api-service',
        orgId: process.env.NEXT_PUBLIC_TAHI_ORG_ID ?? null,
        sessionId: null,
      }
    }
  }

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
    const authState = await clerk.authenticateRequest(req, {
      authorizedParties: getAuthorizedParties(),
    })

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
 * Prove the right to act as a client, or return null.
 *
 * Three things must all hold, and each is re-derived here on every acting
 * request rather than trusted from the browser. The first two are
 * `resolveActEligibility` (super_admin from the roles table, plus a
 * `team_members` row to attribute the write to), shared with the route that
 * arms the mode so the two can never disagree; the third is a resolvable
 * preview org, already established by the caller.
 *
 * Fails CLOSED on any error: a D1 hiccup downgrades the session to the
 * read-only preview it was before, which refuses every write.
 */
async function resolveActingIdentity(
  userId: string | null,
  clerkOrgId: string,
  targetOrgId: string,
): Promise<ActingAsIdentity | null> {
  if (!userId) return null
  try {
    const database = await db()
    const drizzle = database as ReturnType<typeof import('drizzle-orm/d1').drizzle>

    const verdict = await resolveActEligibility(drizzle, userId, clerkOrgId)
    if (!verdict.ok || !verdict.member) return null
    const member = verdict.member

    // The org's primary seat, for the audit metadata only: "this happened in
    // the workspace whose main contact is X". The banner's own contact pick
    // never reaches the server (it lives in sessionStorage), so primary-first
    // is the closest honest answer. A missing row records "no named seat" and
    // must never block the write or stand in as an author.
    let contactId: string | null = null
    try {
      const [contact] = await drizzle
        .select({ id: schema.contacts.id })
        .from(schema.contacts)
        .where(eq(schema.contacts.orgId, targetOrgId))
        .orderBy(desc(schema.contacts.isPrimary))
        .limit(1)
      contactId = contact?.id ?? null
    } catch {
      contactId = null
    }

    return {
      adminUserId: userId,
      adminTeamMemberId: member.id,
      adminName: member.name?.trim() || 'Tahi Studio',
      orgId: targetOrgId,
      contactId,
    }
  } catch {
    return null
  }
}

/**
 * Portal auth with Clerk-org -> D1-org resolution and admin "Client view"
 * impersonation.
 *
 * A real client signs in through a Clerk organization; the matching D1
 * `organisations` row is found via its `clerkOrgId` column (set when onboarding
 * provisions the client). This helper returns the *D1 org id* as `orgId`, so
 * every portal route keeps scoping by `organisations.id` and its foreign keys
 * unchanged, and also exposes the raw `clerkOrgId` for the few routes that call
 * Clerk organization APIs (e.g. teammate invites).
 *
 * Until onboarding links a Clerk org to a D1 row, `orgId` is null and portal
 * routes 403 (the client has no provisioned workspace yet) - this is the
 * correct access gate, not a bug.
 *
 * When a Tahi admin previews the client experience (Client view), the browser
 * carries a `tahi-impersonate-org` cookie naming the D1 org to view. ONLY the
 * admin org may use it; a non-impersonating admin keeps the Tahi org id as
 * `orgId` so an endpoint's existing "reject the admin org" guard is unchanged.
 *
 * The cookie is read through lib/preview-cookie.ts, the same rule the
 * middleware and getViewAudience() use, rather than by hand here. This is the
 * reader that actually SCOPES data, so a third definition of "previewing" is
 * the one that matters: while this file honoured any truthy value, a junk
 * cookie was "not previewing" to the shell (which rendered the studio, with
 * /clients reachable) and a preview of a non-existent org to every portal API
 * underneath it.
 *
 * ACT AS CLIENT. A second cookie (tahi-impersonate-mode) turns the lens into a
 * hand. It grants nothing on its own: `resolveActingIdentity` below re-proves
 * super_admin from the roles table and finds the acting person's team_members
 * row on every request that could write. Reads skip it entirely, because no
 * GET handler consumes the result. Crucially `impersonating` STAYS TRUE either
 * way, so the ~21 routes that hand-roll `if (impersonating) 403` keep refusing
 * until a route is deliberately opened through lib/acting-as.ts. Default deny
 * survives the feature.
 */
export async function getPortalAuth(req: NextRequest): Promise<PortalAuthResult> {
  const result = await getRequestAuth(req)
  const clerkOrgId = result.orgId
  const tahiOrgId = process.env.NEXT_PUBLIC_TAHI_ORG_ID

  // Tahi admin. Client view carries the target D1 org id in a cookie. The
  // literal `true` is this branch's own condition: only a Tahi session reaches
  // here, which is the first half of the shared rule.
  if (clerkOrgId && tahiOrgId && clerkOrgId === tahiOrgId) {
    const target = resolvePreviewOrgId(true, req.cookies.get(IMPERSONATE_ORG_COOKIE)?.value)
    if (target) {
      // Paid only when the browser asks to act AND the request could actually
      // write. Nothing reads `actingAs` on a GET: `refusePreviewWrite` and
      // `actingIdentity` are called from POST / PATCH / PUT handlers only, and
      // the resolution is not free (resolvePermissions alone is a roster read,
      // a roles join and two feature_visibility reads, then the seat select on
      // top). The client overview fans out about ten portal GETs in parallel,
      // so charging every one of them for an answer no reader consumes made
      // simply LOOKING at a client in act mode cost roughly seventy queries.
      // HEAD rides with GET because Next serves it from the GET handler.
      const isRead = req.method === 'GET' || req.method === 'HEAD'
      const wantsAct =
        !isRead && readPreviewMode(req.cookies.get(IMPERSONATE_MODE_COOKIE)?.value) === 'act'
      const actingAs = wantsAct
        ? await resolveActingIdentity(result.userId, clerkOrgId, target)
        : null
      if (actingAs) {
        return {
          ...result,
          orgId: target,
          clerkOrgId,
          impersonating: true,
          canWriteAsClient: true,
          actingAs,
        }
      }
      return { ...result, orgId: target, clerkOrgId, impersonating: true }
    }
    // Non-impersonating admin: leave orgId as the Tahi org so portal routes
    // (which 403 the admin org) behave exactly as before.
    return { ...result, clerkOrgId, impersonating: false }
  }

  // Real client: resolve their Clerk org to the linked D1 organisation.
  let d1OrgId: string | null = null
  if (clerkOrgId) {
    try {
      const database = await db()
      const [org] = await database
        .select({ id: schema.organisations.id })
        .from(schema.organisations)
        .where(eq(schema.organisations.clerkOrgId, clerkOrgId))
        .limit(1)
      d1OrgId = org?.id ?? null
      if (!d1OrgId) {
        // Back-compat: a pre-existing org may use the Clerk org id AS its D1
        // primary key (the old implicit assumption). Fall back to that so we
        // never regress an already-working client while the link is adopted.
        const [legacy] = await database
          .select({ id: schema.organisations.id })
          .from(schema.organisations)
          .where(eq(schema.organisations.id, clerkOrgId))
          .limit(1)
        d1OrgId = legacy?.id ?? null
      }
    } catch {
      d1OrgId = null
    }
  }

  return { ...result, orgId: d1OrgId, clerkOrgId, impersonating: false }
}

/**
 * Get auth state inside a Server Component / page.tsx.
 * Builds a synthetic Request from next/headers cookies so @clerk/backend
 * can validate the session JWT directly : no middleware signal needed.
 */
export async function getServerAuth(): Promise<RequestAuthResult> {
  // Dev-only Ship Studio preview bypass (see note above; prod build strips this).
  // Explicit ?shipstudio=1 signal only; the over-broad UA triggers were removed
  // (see getRequestAuth above for why 'Edg/' was dangerous).
  if (process.env.NODE_ENV !== 'production') {
    const hdrs = await headers()
    const cookieStore = await cookies()
    if (
      hdrs.get('x-ship-studio') === '1' ||
      cookieStore.get('tahi-ship-studio')?.value === '1'
    ) {
      return shipStudioIdentity()
    }
  }

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
    const authState = await clerk.authenticateRequest(syntheticReq, {
      authorizedParties: getAuthorizedParties(),
    })

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
