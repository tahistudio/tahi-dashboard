/**
 * lib/service-catalogue.ts
 *
 * The shared vocabulary for the services catalogue's audience (migration
 * 0097). Two routes, the studio editor and the worker MCP tools all have to
 * agree on what "hidden" means, and a string compared in four places drifts,
 * so it is spelled once here.
 *
 * Two independent axes, deliberately:
 *
 *   orgId       WHO may see the row. null = a global row every client sees.
 *               Set = private to that one organisation, which is the only way
 *               a per-client retainer name can exist without leaking to every
 *               other client.
 *   visibility  WHETHER anyone may. 'hidden' takes a row out of the portal
 *               even when it is global.
 *
 * A route file cannot export these itself: Next's App Router only accepts HTTP
 * method exports and route config from a route.ts, and tsc will not catch the
 * mistake (next build will).
 */

/** The `visibility` column's whole vocabulary. */
export const SERVICE_VISIBILITIES = ['public', 'hidden'] as const

export type ServiceVisibility = (typeof SERVICE_VISIBILITIES)[number]

export function isServiceVisibility(value: unknown): value is ServiceVisibility {
  return typeof value === 'string' && (SERVICE_VISIBILITIES as readonly string[]).includes(value)
}

/**
 * Read a client-supplied `visibility` for a write.
 *
 *   undefined -> `fallback` (create defaults to 'public'; an update leaves the
 *                stored value alone by passing the row's current one)
 *   a known value -> itself
 *   anything else -> null, which the caller must answer 400 on rather than
 *                    guessing. Guessing 'public' on a typo would publish a row
 *                    the studio meant to hide.
 */
export function readServiceVisibility(
  value: unknown,
  fallback: ServiceVisibility,
): ServiceVisibility | null {
  if (value === undefined || value === null) return fallback
  return isServiceVisibility(value) ? value : null
}
