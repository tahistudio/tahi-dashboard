/**
 * lib/studio-project-manager.ts - the one studio-wide "who is everyone's
 * project manager" rule.
 *
 * WHY THIS EXISTS
 * Liam, walking the client onboarding flow as a dummy client: "make Liam
 * Miller as the project manager for everyone no matter what. in the future
 * we'll add more. right now not." Three surfaces each named a lead or a PM
 * through their own per-client lookup (the onboarding lead card, the portal
 * team card's first row, the kickoff booking host), and none of them agreed
 * with each other once a real per-client assignment existed. This is the one
 * settings key and the one resolution order all three now share.
 *
 * settings key: studio.projectManagerId (a team_members id)
 *
 *   SET    -> that member is the lead / project manager shown to EVERY
 *             client, full stop. The org's own per-client assignment never
 *             gets a look-in while this is set.
 *   UNSET  -> today's behaviour, unchanged: the org's own per-client
 *             assignment, then whatever this caller used as its own last
 *             resort (the studio's default owner, the first super_admin, or
 *             nothing at all).
 *
 * An id that no longer resolves to a real team member (deleted, or simply
 * wrong) is treated exactly like an unset setting: it falls through to the
 * per-client assignment rather than leaving a client with no lead at all.
 * Nothing here ever hardcodes a person - resolveProjectManager returns null
 * when nothing resolves, and the literal fallback (DEFAULT_STUDIO_LEAD, or
 * an honestly empty "Your team" card) stays with the caller, exactly as it
 * was before this rule existed.
 *
 * Pure: no D1 handle, no fetch. Each of the three call sites supplies its own
 * small D1-backed functions for the three steps, which is what keeps this
 * module testable with plain mocks and lets each surface keep its own
 * pre-existing fallback shape (a full StudioLead literal for onboarding, a
 * roster row for the portal team card, a nullable host for the kickoff
 * booking) without this module having to know about any of them.
 */

/** The settings key. A team_members id, or empty/absent to defer to today's
 *  per-client behaviour. */
export const STUDIO_PROJECT_MANAGER_SETTING_KEY = 'studio.projectManagerId'

export interface ProjectManagerDeps<T> {
  /**
   * The studio-wide override, already resolved to a real team member (or
   * null when the setting is empty, unreadable, or names somebody who no
   * longer exists). Implementations read STUDIO_PROJECT_MANAGER_SETTING_KEY
   * and look the id up themselves; this module never touches D1.
   */
  findStudioOverride: () => Promise<T | null>
  /**
   * The org's own per-client assignment. Never called when orgRef is
   * null/undefined (a client with no workspace yet has nothing to look up).
   */
  findPerClientPm: (orgRef: string) => Promise<T | null>
  /**
   * Whatever this caller uses as its own last resort once the override and
   * the per-client assignment have both come up empty: the studio's default
   * owner setting, the first super_admin, or a no-op that answers null when
   * the caller has no further fallback of its own (the kickoff host, today).
   */
  findFallback: () => Promise<T | null>
}

/**
 * Resolve who is shown as the lead / project manager for a client.
 *
 * Order: studio override, then the org's own per-client assignment, then the
 * caller's own fallback. Never throws: any one dependency failing degrades
 * one step down the order rather than breaking the surface that called it.
 */
export async function resolveProjectManager<T>(
  deps: ProjectManagerDeps<T>,
  orgRef: string | null | undefined,
): Promise<T | null> {
  try {
    const override = await deps.findStudioOverride()
    if (override) return override
  } catch {
    // fall through to the per-client assignment
  }

  if (orgRef) {
    try {
      const pm = await deps.findPerClientPm(orgRef)
      if (pm) return pm
    } catch {
      // fall through to the caller's own fallback
    }
  }

  try {
    return await deps.findFallback()
  } catch {
    return null
  }
}

/**
 * Validate a write to studio.projectManagerId.
 *
 * Deliberately permissive about WHICH id: resolveProjectManager already
 * treats an id that does not resolve to a real member as unset, so a stale
 * or mistyped id can never strand a client with no lead, only fall through to
 * the org's own assignment. The only thing rejected here is a value that
 * looks "set" to a careless reader of the settings table while actually
 * being blank.
 */
export function validateStudioProjectManagerSetting(
  value: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (value == null || value === '') return { ok: true }
  if (!value.trim()) {
    return {
      ok: false,
      error: `${STUDIO_PROJECT_MANAGER_SETTING_KEY} must be empty (to fall back to per-client assignments) or a team member id, not blank whitespace.`,
    }
  }
  return { ok: true }
}
