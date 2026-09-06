/**
 * lib/onboarding-lead.ts - who the client is told their studio lead is.
 *
 * WHY THIS EXISTS
 * app/(onboarding)/onboarding/page.tsx hardcoded "Liam Miller" for every
 * client, on the one screen whose whole job is to make the engagement feel
 * personally held. It was marked SEAM in the source, so this is that seam being
 * closed rather than a change of intent: the client should see the person who
 * is actually assigned to them.
 *
 * RESOLUTION ORDER (most specific first)
 *   1. The org's assigned PM. Assignment lives in `team_member_access`: a
 *      `project_manager` rule whose `team_member_access_orgs` link names this
 *      org. That is the same record GET /api/admin/clients/[id]/pm reads and
 *      the MCP `assign_client_pm` tool writes, so the onboarding screen and the
 *      client detail page can never name two different people.
 *   2. The first super_admin on the roster, ordered oldest first so the answer
 *      is stable rather than whatever the query planner returned today.
 *   3. DEFAULT_STUDIO_LEAD, the literal that was there before. Reached only on
 *      an unseeded or unreachable database; keeping it means the screen can
 *      never render a nameless card.
 *
 * Pure: takes its I/O through `StudioLeadDeps` so the ordering above is
 * testable without D1, the same split as lib/team-link.ts. The D1 wiring is
 * lib/onboarding-lead-server.ts.
 */

/** Shape the onboarding screen renders (matches OnboardingLead). */
export interface StudioLead {
  name: string
  first: string
  role: string
  initials: string
  img?: string
}

/** The row either lookup returns. */
export interface StudioLeadCandidate {
  id: string
  name: string
  email: string
  avatarUrl: string | null
}

export interface StudioLeadDeps {
  /** The project_manager assigned to this org, or null. */
  findPmForOrg: (orgRef: string) => Promise<StudioLeadCandidate | null>
  /** The oldest active super_admin on the roster, or null. */
  findFirstSuperAdmin: () => Promise<StudioLeadCandidate | null>
}

/** The label under the name. Unchanged from the hardcoded version. */
export const STUDIO_LEAD_ROLE = 'Your studio lead'

/**
 * Last-resort lead. Identical to the literal this module replaced, so an
 * unseeded environment renders exactly what it rendered before.
 */
export const DEFAULT_STUDIO_LEAD: StudioLead = {
  name: 'Liam Miller',
  first: 'Liam',
  role: STUDIO_LEAD_ROLE,
  initials: 'LM',
  img: '/liam-profile.jpg',
}

/**
 * Local portraits, keyed by roster email.
 *
 * `team_members.avatarUrl` wins whenever it is set. This map only covers the
 * studio portraits that ship as static assets in /public and have no uploaded
 * equivalent yet, which is why resolving Liam keeps his photo instead of
 * silently downgrading the card to initials. Delete an entry the day that
 * person has an avatarUrl.
 */
const LOCAL_PORTRAITS: Readonly<Record<string, string>> = {
  'business@tahi.studio': '/liam-profile.jpg',
}

/** "Liam Miller" -> "LM". Single-word names give one letter. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const letters = parts.slice(0, 2).map(p => p[0])
  return letters.join('').toUpperCase()
}

/** Turn a roster row into the card the onboarding screen renders. */
export function leadFromCandidate(candidate: StudioLeadCandidate): StudioLead {
  const name = candidate.name.trim() || candidate.email
  const img = candidate.avatarUrl?.trim() || LOCAL_PORTRAITS[candidate.email.trim().toLowerCase()]
  return {
    name,
    first: name.split(/\s+/)[0],
    role: STUDIO_LEAD_ROLE,
    initials: initialsFor(name),
    ...(img ? { img } : {}),
  }
}

/**
 * Resolve the studio lead for a client.
 *
 * @param orgRef The organisation the client is being onboarded into. Accepts
 *   either the D1 `organisations.id` or the Clerk org id; the server deps
 *   resolve both. Null when the client has no workspace yet (self-serve
 *   signup), which skips straight to the super_admin fallback.
 *
 * Never throws: a lookup that fails degrades one step down the order rather
 * than breaking the onboarding screen.
 */
export async function resolveStudioLead(
  deps: StudioLeadDeps,
  orgRef: string | null | undefined,
): Promise<StudioLead> {
  if (orgRef) {
    try {
      const pm = await deps.findPmForOrg(orgRef)
      if (pm) return leadFromCandidate(pm)
    } catch {
      // fall through to the roster fallback
    }
  }

  try {
    const owner = await deps.findFirstSuperAdmin()
    if (owner) return leadFromCandidate(owner)
  } catch {
    // fall through to the literal
  }

  return DEFAULT_STUDIO_LEAD
}
