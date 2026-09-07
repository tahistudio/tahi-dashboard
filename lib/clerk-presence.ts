/**
 * lib/clerk-presence.ts
 *
 * The one place that asks Clerk whether a stored id still names anything, and
 * the one place that removes a Clerk organisation.
 *
 * D1 keeps a clerk_org_id on an organisation and a clerk_user_id on a contact,
 * and both are read as proof that a real person can sign in. They are not: the
 * founder can delete the organisation and the user in the Clerk dashboard and
 * leave those columns naming a login nobody can use. Refusing a delete over
 * one of those is refusing over nothing, so every refusal resting on a Clerk
 * id asks here first.
 *
 * 404 is 'gone'. ANY other failure is 'unknown', and every caller treats
 * unknown as a refusal: fail closed, never delete on a guess.
 *
 * It lives outside lib/org-lifecycle on purpose: nothing in that folder may
 * import Clerk, a mailer or a route, and a static test holds that true. The
 * lifecycle module takes these functions as arguments instead.
 */

import { clerkClient } from '@clerk/nextjs/server'
import type { ClerkExistence, ClerkOrgDeleter, ClerkPresence } from '@/lib/org-lifecycle'

/** True for the one Clerk error that means "there is nothing there". */
function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const status = (error as { status?: unknown }).status
  if (status === 404) return true
  const errors = (error as { errors?: unknown }).errors
  if (Array.isArray(errors)) {
    return errors.some((entry) => {
      const code = (entry as { code?: unknown })?.code
      return code === 'resource_not_found' || code === 'organization_not_found'
    })
  }
  return false
}

/**
 * Does this id still name something in Clerk? Cached per instance, so one
 * request asks Clerk once per id however many refusals consult it.
 */
export function createClerkPresence(): ClerkPresence {
  const cache = new Map<string, ClerkExistence>()

  async function probe(key: string, run: () => Promise<unknown>): Promise<ClerkExistence> {
    const cached = cache.get(key)
    if (cached) return cached
    let result: ClerkExistence
    try {
      await run()
      result = 'exists'
    } catch (error) {
      result = isNotFound(error) ? 'gone' : 'unknown'
    }
    cache.set(key, result)
    return result
  }

  return {
    organisationExists: (clerkOrgId) => probe(`org:${clerkOrgId}`, async () => {
      const clerk = await clerkClient()
      return clerk.organizations.getOrganization({ organizationId: clerkOrgId })
    }),
    userExists: (clerkUserId) => probe(`user:${clerkUserId}`, async () => {
      const clerk = await clerkClient()
      return clerk.users.getUser(clerkUserId)
    }),
  }
}

/**
 * Remove one Clerk organisation. A 404 is success: the workspace the operator
 * wanted gone does not exist, which is the state they asked for, and a repeat
 * after a half-finished run must not stall on it.
 */
export const deleteClerkOrganisation: ClerkOrgDeleter = async (clerkOrgId) => {
  const clerk = await clerkClient()
  try {
    await clerk.organizations.deleteOrganization(clerkOrgId)
    return 'deleted'
  } catch (error) {
    if (isNotFound(error)) return 'already_gone'
    throw error
  }
}
