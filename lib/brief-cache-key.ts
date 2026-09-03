/**
 * lib/brief-cache-key.ts
 *
 * Which settings row the daily overview brief is cached under.
 *
 * computeBrief is scope-aware: it gates each section on the caller's feature
 * permissions and filters client, request and invoice rows to the orgs the
 * caller may see. The cache was not. One global settings key held whatever the
 * last caller computed, so a team member scoped to one client could read the
 * owner's brief (client names, overdue invoice amounts, overnight payments for
 * every other client), and a scoped member who recomputed first on a stale
 * morning left the owner reading their narrowed brief for the rest of the day.
 *
 * The key now carries the scope that produced the brief. The unrestricted
 * owner brief keeps the plain key, so the morning cron still warms the cache
 * the owner reads; every narrower scope gets its own row, and the two can
 * never overwrite each other.
 */

import { resolveAccessScoping } from '@/lib/access-scoping'
import { resolvePermissions, can } from '@/lib/permissions'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The feature gates computeBrief reads. A brief is only the same brief when
 *  the same set of these was granted. */
export const BRIEF_FEATURES: readonly string[] = [
  'invoices',
  'contracts',
  'calls',
  'requests',
  'messages',
]

/** Marks "no org filter at all" so it cannot collide with a real org id. */
const UNRESTRICTED = '*'

/**
 * A stable, order-independent description of the scope a brief was computed
 * under: the orgs it could see, and the brief features that were granted.
 */
export function briefScopeFingerprint(
  allowedOrgIds: string[] | null,
  allowedFeatures: readonly string[],
): string {
  const orgs = allowedOrgIds === null
    ? UNRESTRICTED
    : [...allowedOrgIds].sort().join(',')
  const features = [...allowedFeatures].sort().join(',')
  return `${orgs}|${features}`
}

/** The fingerprint of a caller who sees everything: the owner, and the cron. */
export function unrestrictedFingerprint(): string {
  return briefScopeFingerprint(null, BRIEF_FEATURES)
}

/**
 * FNV-1a, 32 bit, hex. Short and deterministic, which is all the key needs;
 * it is a cache discriminator, never a secret.
 */
export function hashScope(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * The settings key for a fingerprint. The unrestricted owner scope keeps the
 * base key (so the existing cached row and the cron stay valid); anything
 * narrower is suffixed with its hash.
 */
export function briefCacheKeyForFingerprint(baseKey: string, fingerprint: string): string {
  return fingerprint === unrestrictedFingerprint()
    ? baseKey
    : `${baseKey}:${hashScope(fingerprint)}`
}

/**
 * Resolve the cache key for a live caller. Runs the same two resolvers
 * computeBrief runs, so the key and the brief always describe the same scope.
 */
export async function resolveBriefCacheKey(
  drizzle: D1,
  auth: { userId: string | null; orgId: string | null },
  baseKey: string,
): Promise<string> {
  const access = await resolvePermissions(drizzle, auth)
  const features = BRIEF_FEATURES.filter((feature) => can(access, feature))
  const allowedOrgs = await resolveAccessScoping(drizzle, auth.userId)
  return briefCacheKeyForFingerprint(baseKey, briefScopeFingerprint(allowedOrgs, features))
}
