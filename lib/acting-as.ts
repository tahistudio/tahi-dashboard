/**
 * lib/acting-as.ts: the one place a portal write decides whether Client view is
 * allowed to touch it.
 *
 * Before this, every portal write hand-rolled the same three lines:
 *
 *   if (impersonating) {
 *     return NextResponse.json({ error: 'Read-only in client view' }, { status: 403 })
 *   }
 *
 * copied into ~21 handlers. Act as client cannot be a change to `impersonating`
 * itself, because that would open all 21 at once, including the ones that spend
 * a client's money and the ones that email a real client address through Clerk
 * and Stripe. So `impersonating` stays true in both modes and this helper is the
 * ONLY thing that can let a write through: a route opts in, one at a time, by
 * asking for `allowActing` and then attributing the row it writes.
 *
 * The refusal is byte-identical to the copies it replaces, on purpose. The
 * string "Read-only in client view" is asserted in roughly fifteen route test
 * suites and read by the portal UI, so a route that is not opened behaves
 * exactly as it did.
 *
 * ATTRIBUTION IS NOT OPTIONAL. Every value this module hands a route names the
 * STUDIO person doing the work (`team_members.id`, authorType 'team_member').
 * Nothing here will ever give a route a client contact id to write as an author:
 * a row that claims a named client said something they did not say is the exact
 * harm Act as client exists to avoid, and it is the harm the audit row cannot
 * undo afterwards.
 */

import { NextResponse } from 'next/server'
import type { DB } from '@/db/d1'
import { logAuditStrict } from '@/lib/audit'
import type { ActingAsIdentity, PortalAuthResult } from '@/lib/server-auth'

/**
 * Prefix on every audit action written from this mode.
 *
 * On the ACTION rather than the entityType so both questions stay answerable
 * off the existing indexes: `idx_audit_entity` still answers "everything that
 * happened to this request", and `action LIKE 'acting_as_client.%'` answers
 * "everything the studio did while standing in a client's shoes".
 */
export const ACTING_AUDIT_PREFIX = 'acting_as_client.'

/** The refusal the whole portal tree already speaks. Do not reword it. */
export const READ_ONLY_MESSAGE = 'Read-only in client view'

export interface RefuseOptions {
  /**
   * This route has been reviewed and may be reached in act mode. Absent or
   * false means the route keeps refusing in BOTH modes, which is the default
   * for anything that spends money, invites a person, or sends mail out of
   * band through Clerk or Stripe.
   */
  allowActing?: boolean
}

/**
 * Refuse a portal write made through Client view, or return null to let it run.
 *
 * Returns null for a normal client session (nothing to refuse), and for a
 * studio session only when the route opted in AND `getPortalAuth` proved the
 * session may act (super admin, with a team_members row).
 */
export function refusePreviewWrite(
  auth: Pick<PortalAuthResult, 'impersonating' | 'canWriteAsClient' | 'actingAs'>,
  { allowActing = false }: RefuseOptions = {},
): NextResponse | null {
  if (!auth.impersonating) return null
  if (allowActing && auth.canWriteAsClient === true && auth.actingAs) return null
  return NextResponse.json({ error: READ_ONLY_MESSAGE }, { status: 403 })
}

/**
 * The acting identity for a request that got past `refusePreviewWrite`, or null
 * when this is an ordinary client writing for themselves.
 *
 * Both halves are checked rather than trusting `actingAs` alone, so a partially
 * built auth object out of a test factory cannot look like a grant.
 */
export function actingIdentity(
  auth: Pick<PortalAuthResult, 'canWriteAsClient' | 'actingAs'>,
): ActingAsIdentity | null {
  if (auth.canWriteAsClient !== true) return null
  return auth.actingAs ?? null
}

/**
 * Who to write into an author / submitter / creator column, and what to call
 * that value. A client writing for themselves keeps the historical pair; the
 * studio acting for them is recorded as the studio, because it was.
 *
 * `contactId` is the client's own contacts row (already resolved by the route,
 * which needs it for its own reasons) and is used ONLY on the non-acting path.
 */
export function authorFor(
  acting: ActingAsIdentity | null,
  fallbackId: string,
): { id: string; type: 'team_member' | 'contact' } {
  if (acting) return { id: acting.adminTeamMemberId, type: 'team_member' }
  return { id: fallbackId, type: 'contact' }
}

/**
 * A parenthetical for the bell and email bodies that name a person, so the
 * studio never reads "From Acme" about something the studio typed itself.
 * Empty string when nobody is acting, so a caller can concatenate blind.
 */
export function actingByline(acting: ActingAsIdentity | null, verb = 'filed'): string {
  if (!acting) return ''
  return ` (${verb} by ${acting.adminName} at Tahi Studio)`
}

export interface ActingWriteRecord {
  /**
   * What happened, in the vocabulary of the surface: 'request.created',
   * 'message.posted', 'review.submitted'. Prefixed with
   * ACTING_AUDIT_PREFIX before it is stored.
   */
  verb: string
  entityType: string
  entityId: string | null
  /** The route as a person would name it, e.g. 'POST /api/portal/requests'. */
  route: string
  /** Anything else worth keeping. Merged into the metadata JSON. */
  extra?: Record<string, unknown>
}

/**
 * Record one acting write. No-op when `acting` is null, so a route calls it
 * unconditionally and the ordinary client path pays nothing.
 *
 * AWAITED AND ALLOWED TO THROW, unlike the rest of the audit call sites and
 * unlike the best-effort notification blocks these routes wrap in try/catch.
 * The record is the entire reason this mode is safe to hand to a person: a
 * write that lands without one is the failure this feature exists to prevent,
 * so the caller must let the request fail rather than answer 201 to an
 * unrecorded change in someone else's workspace.
 *
 * `actorId` is the acting person's CLERK user id, not their team_members id.
 * That is the convention every other logAudit call site uses, and the audit
 * viewer resolves actor names by joining team_members.clerk_user_id, so a
 * team_members id here would render as an unnamed row. The team member id
 * (the value actually written into the author columns) rides in the metadata.
 */
export async function recordActingWrite(
  database: DB,
  acting: ActingAsIdentity | null,
  record: ActingWriteRecord,
): Promise<void> {
  if (!acting) return
  await logAuditStrict(database, {
    action: `${ACTING_AUDIT_PREFIX}${record.verb}`,
    userId: acting.adminUserId,
    userType: 'team_member',
    entityType: record.entityType,
    entityId: record.entityId,
    metadata: {
      mode: 'act',
      route: record.route,
      orgId: acting.orgId,
      adminTeamMemberId: acting.adminTeamMemberId,
      adminName: acting.adminName,
      contactId: acting.contactId,
      ...record.extra,
    },
  })
}
