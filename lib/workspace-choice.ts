/**
 * lib/workspace-choice.ts
 *
 * "Which workspace am I opening?", as a pure function.
 *
 * THE BUG THIS EXISTS FOR. A Clerk session carries an ACTIVE organisation, not
 * a list of memberships. Someone who accepts an organisation invitation and
 * then signs in fresh (Google, in the reported case) holds the membership but
 * has no active org until something calls setActive. The middleware read that
 * empty orgId as "no organisation at all" and sent the person to /onboarding,
 * which is the lead flow: a brand new co-founder of the studio was asked to
 * onboard as a client.
 *
 * So the no-org branch stops meaning "lead" and starts meaning "we do not know
 * yet". /continue resolves it against the real membership list and this
 * module holds the decision, free of Clerk and React so it can be tested.
 *
 * Kept deliberately dumb: it never fetches, never redirects, never touches
 * Clerk. The caller supplies what it already knows and acts on the verdict.
 */

/** One organisation the signed-in user belongs to. */
export interface WorkspaceMembership {
  /** Clerk organisation id. */
  organizationId: string
  /** Organisation display name, for the picker. */
  name: string
  /** Clerk role key ("org:admin", "org:member", ...). Display only. */
  role?: string | null
}

export interface WorkspaceChoiceInput {
  /** The org already active on the session, if any. */
  activeOrgId: string | null | undefined
  /** Every organisation the user is a member of. */
  memberships: WorkspaceMembership[]
  /** NEXT_PUBLIC_TAHI_ORG_ID. Null when unset (local mis-config). */
  tahiOrgId: string | null | undefined
}

export type WorkspaceChoice =
  /** Session already has an org: go straight to the requested destination. */
  | { action: 'redirect' }
  /** Set this organisation active, then go to the destination. */
  | { action: 'activate'; organizationId: string }
  /** Several candidates and no rule to pick one: ask the person. */
  | { action: 'pick' }
  /** No membership anywhere: a genuine lead, send them to /onboarding. */
  | { action: 'onboarding' }

/**
 * Resolve the workspace to open.
 *
 * Order matters:
 *   1. An active org wins outright. Never re-pick for a settled session.
 *   2. The Tahi org wins over any client org the same person may also sit in.
 *      Studio people (Liam, Staci) are the ones most likely to hold both, and
 *      their home is the studio.
 *   3. Exactly one membership activates itself, which is the whole point for a
 *      client seat: one org, no question asked, straight into their portal.
 *   4. Several, none of them Tahi: ask.
 *   5. None: the only case that is really a lead.
 */
export function resolveWorkspaceChoice(input: WorkspaceChoiceInput): WorkspaceChoice {
  const { activeOrgId, memberships, tahiOrgId } = input

  if (activeOrgId) return { action: 'redirect' }
  if (!memberships || memberships.length === 0) return { action: 'onboarding' }

  if (tahiOrgId) {
    const tahi = memberships.find(m => m.organizationId === tahiOrgId)
    if (tahi) return { action: 'activate', organizationId: tahi.organizationId }
  }

  if (memberships.length === 1) {
    return { action: 'activate', organizationId: memberships[0].organizationId }
  }

  return { action: 'pick' }
}

/** Where the chooser sends someone once a workspace is settled. */
export const DEFAULT_WORKSPACE_DESTINATION = '/overview'

/** The chooser's own path, so no caller has to spell it twice. */
export const CHOOSE_WORKSPACE_PATH = '/continue'

/**
 * Make a `next` param safe to redirect to.
 *
 * Same-origin, path-only, and never the chooser itself (which would loop).
 * Anything else falls back to /overview. Protocol-relative ("//evil.com") and
 * backslash-prefixed forms are rejected explicitly: both are read as a host by
 * some clients.
 */
export function safeNextPath(
  next: string | null | undefined,
  fallback: string = DEFAULT_WORKSPACE_DESTINATION,
): string {
  if (!next) return fallback
  if (!next.startsWith('/')) return fallback
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback
  const path = next.split('?')[0].split('#')[0]
  if (path === CHOOSE_WORKSPACE_PATH || path.startsWith(`${CHOOSE_WORKSPACE_PATH}/`)) {
    return fallback
  }
  return next
}

/**
 * Paths a signed-in user with no active org may reach without being sent to the
 * chooser first. The onboarding and welcome flows are the destinations the
 * chooser itself hands off to, and the chooser cannot bounce to itself.
 */
const NO_ORG_ALLOWED_PREFIXES = ['/onboarding', '/welcome', CHOOSE_WORKSPACE_PATH, '/api/']

/**
 * The middleware's half of the fix: where does a no-org PAGE request go?
 *
 * Returns null to let the request through (an allowed path, or an API route,
 * which self-guards), otherwise the chooser path plus the original location as
 * `next` so nobody loses where they were headed.
 */
export function resolveNoOrgRedirect(
  pathname: string,
  search = '',
): string | null {
  if (NO_ORG_ALLOWED_PREFIXES.some(p => pathname === p || pathname.startsWith(p))) {
    return null
  }
  const next = pathname + (search || '')
  return `${CHOOSE_WORKSPACE_PATH}?next=${encodeURIComponent(next)}`
}
