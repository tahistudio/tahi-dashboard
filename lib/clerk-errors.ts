/**
 * lib/clerk-errors.ts
 *
 * Pure classifier for "Clerk says there is nothing there" versus every other
 * failure. Extracted out of lib/clerk-presence.ts so any caller that needs to
 * tell a gone-already 404 apart from a genuine outage can do it the same way,
 * without importing Clerk itself: this file has no clerkClient import and no
 * side effects, so it is trivially unit-testable in isolation.
 *
 * Used by:
 *   - lib/clerk-presence.ts (organisation / user existence probes)
 *   - app/api/portal/people/route.ts DELETE (removing a teammate whose
 *     contact row carries a clerkUserId, but who Clerk no longer counts as an
 *     organisation member: signed up outside the invite flow and never
 *     accepted membership, removed by hand in the Clerk dashboard, etc)
 *
 * 404 status, or a Clerk error-body code of 'resource_not_found',
 * 'organization_not_found', or 'organization_membership_not_found', all count.
 * Anything else is NOT a not-found: callers must treat it as a genuine
 * failure and fail closed rather than guess that the removal already happened.
 */
export function isClerkNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  if (status === 404) return true
  const errors = (error as { errors?: unknown }).errors
  if (Array.isArray(errors)) {
    return errors.some((entry) => {
      const code = (entry as { code?: unknown })?.code
      return (
        code === 'resource_not_found' ||
        code === 'organization_not_found' ||
        code === 'organization_membership_not_found'
      )
    })
  }
  return false
}
