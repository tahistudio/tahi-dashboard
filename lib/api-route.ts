/**
 * lib/api-route.ts
 *
 * Thin, opt-in higher-order wrappers that reproduce the auth boilerplate every
 * API route repeats by hand. They run the standard guard, return the exact same
 * 403 JSON on failure, forward the resolved auth context (plus the Next route
 * context for dynamic [id] params) to the handler, and catch any thrown error
 * into a uniform 500 JSON.
 *
 * These are a convenience, not a policy change: the guards, payloads, and status
 * codes match the existing routes verbatim (see app/api/admin/* and
 * app/api/portal/*). They do NOT auto-parse the request body (routes parse it
 * themselves, some defensively and some not) and do NOT enforce per-org access
 * scoping (CLAUDE.md rule 11) - the handler still calls `scopedOrgIds` /
 * `requireAccessToOrg` itself, using the `userId` these wrappers forward.
 *
 * The one behaviour these add on top of the raw routes is the catch-all 500:
 * an unhandled throw becomes `{ error: 'Internal server error' }, { status: 500 }`
 * instead of bubbling to Next's default 500 page. This is intentional and
 * consistent (routes that already try/catch keep their own richer messages).
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  getRequestAuth,
  getPortalAuth,
  isTahiAdmin,
  type RequestAuthResult,
} from '@/lib/server-auth'

/** The resolved portal auth context, including org resolution + impersonation. */
export type PortalAuthResult = Awaited<ReturnType<typeof getPortalAuth>>

/**
 * The Next 15 route-handler second argument. `params` is a Promise the handler
 * must await. Parameterised so `[id]` routes can type it as
 * `AdminRouteHandler<{ id: string }>` and static routes leave it as the default.
 */
export interface RouteContext<P = Record<string, string>> {
  params: Promise<P>
}

type AdminRouteHandler<P> = (
  req: NextRequest,
  auth: RequestAuthResult,
  ctx: RouteContext<P>,
) => Promise<Response> | Response

type PortalRouteHandler<P> = (
  req: NextRequest,
  auth: PortalAuthResult,
  ctx: RouteContext<P>,
) => Promise<Response> | Response

interface PortalRouteOptions {
  /**
   * Require a resolved `userId` (default true). Checkout is the one write route
   * that tolerates a null userId, so it passes `{ requireUser: false }`.
   */
  requireUser?: boolean
}

function toInternalError(scope: string, err: unknown): NextResponse {
  console.error(`[${scope}] unhandled error`, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/**
 * Guard an admin/service API route: runs `getRequestAuth`, rejects non-Tahi
 * callers with the standard 403, and forwards the full auth result plus the Next
 * route context to the handler. Reproduces the canonical admin boilerplate.
 *
 *   // app/api/admin/widgets/[id]/route.ts
 *   import { defineAdminRoute } from '@/lib/api-route'
 *
 *   export const GET = defineAdminRoute<{ id: string }>(async (req, auth, ctx) => {
 *     const { id } = await ctx.params
 *     const database = await db()
 *     const [row] = await database.select().from(schema.widgets)
 *       .where(eq(schema.widgets.id, id)).limit(1)
 *     // auth.userId is available for scopedOrgIds / requireAccessToOrg (rule 11)
 *     return NextResponse.json({ widget: row ?? null })
 *   })
 */
export function defineAdminRoute<P = Record<string, string>>(
  handler: AdminRouteHandler<P>,
): (req: NextRequest, ctx: RouteContext<P>) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const auth = await getRequestAuth(req)
      if (!isTahiAdmin(auth.orgId)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      return await handler(req, auth, ctx)
    } catch (err) {
      return toInternalError('defineAdminRoute', err)
    }
  }
}

/**
 * Guard a read-only portal API route: runs `getPortalAuth`, rejects the Tahi
 * admin org and unresolved/anonymous callers with the standard 403, and forwards
 * the full portal auth result (resolved D1 `orgId`, `clerkOrgId`, `impersonating`)
 * to the handler. Reproduces the canonical portal read boilerplate.
 *
 *   // app/api/portal/widgets/route.ts
 *   import { definePortalRoute } from '@/lib/api-route'
 *
 *   export const GET = definePortalRoute(async (req, auth) => {
 *     const database = await db()
 *     const rows = await database.select().from(schema.widgets)
 *       .where(eq(schema.widgets.orgId, auth.orgId!))   // orgId is the D1 org id
 *     return NextResponse.json({ widgets: rows })
 *   })
 */
export function definePortalRoute<P = Record<string, string>>(
  handler: PortalRouteHandler<P>,
  { requireUser = true }: PortalRouteOptions = {},
): (req: NextRequest, ctx: RouteContext<P>) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const auth = await getPortalAuth(req)
      if (
        !auth.orgId ||
        auth.orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID ||
        (requireUser && !auth.userId)
      ) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      return await handler(req, auth, ctx)
    } catch (err) {
      return toInternalError('definePortalRoute', err)
    }
  }
}

/**
 * Guard a portal WRITE API route: everything `definePortalRoute` does, plus the
 * read-only impersonation block (a Tahi admin previewing a client's portal must
 * never trigger a real write). Reproduces the canonical portal write boilerplate.
 *
 *   // app/api/portal/widgets/route.ts
 *   import { definePortalWriteRoute } from '@/lib/api-route'
 *
 *   export const POST = definePortalWriteRoute(async (req, auth) => {
 *     const body = await req.json() as { name?: string }   // parse it yourself
 *     if (!body.name?.trim()) {
 *       return NextResponse.json({ error: 'Name is required' }, { status: 400 })
 *     }
 *     const database = await db()
 *     const id = crypto.randomUUID()
 *     await database.insert(schema.widgets).values({ id, orgId: auth.orgId!, name: body.name })
 *     return NextResponse.json({ id })
 *   })
 *
 *   // checkout is the one write route that allows a null userId:
 *   export const POST = definePortalWriteRoute(handler, { requireUser: false })
 */
export function definePortalWriteRoute<P = Record<string, string>>(
  handler: PortalRouteHandler<P>,
  { requireUser = true }: PortalRouteOptions = {},
): (req: NextRequest, ctx: RouteContext<P>) => Promise<Response> {
  return async (req, ctx) => {
    try {
      const auth = await getPortalAuth(req)
      if (
        !auth.orgId ||
        auth.orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID ||
        (requireUser && !auth.userId)
      ) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (auth.impersonating) {
        return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
      }
      return await handler(req, auth, ctx)
    } catch (err) {
      return toInternalError('definePortalWriteRoute', err)
    }
  }
}
