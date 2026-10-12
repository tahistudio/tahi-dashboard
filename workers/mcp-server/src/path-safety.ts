/**
 * Keeps tool arguments from steering a dashboard call to a different route.
 *
 * Dispatchers build paths like `/api/admin/tasks/${taskId}/subtasks`. Without
 * a check, `taskId: "../invoices/X/send-email?"` normalises to
 * `/api/admin/invoices/X/send-email`, and the call runs with the full-admin
 * service token whatever the session's profile allowed (security review H1).
 * Two independent layers, both applied to every profile:
 *
 *   1. assertSafeIdArgs: every argument NAMED like an id (id, *Id, *_id and
 *      their plurals) must look like one. Real ids are UUIDs, Stripe, Clerk
 *      or ManyRequests ids: letters, digits, underscore and hyphen.
 *   2. assertSafePath: the finished path may not carry dot segments, encoded
 *      dots, backslashes or fragments, and must survive URL normalisation
 *      unchanged, so nothing that slips past layer 1 can climb the tree.
 *
 * Pure, so app/api/__tests__/mcp-path-safety.test.ts covers it.
 */

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const ID_KEY = /(^id$|^ids$|Id$|Ids$|_id$|_ids$)/

function invalidId(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isInteger(value) || value < 0
  if (typeof value !== 'string') return true
  return !ID_PATTERN.test(value)
}

/**
 * Throw when an id-named argument does not look like an id. Empty and null
 * values pass (the dispatchers already treat them as absent); arrays are
 * checked item by item.
 */
export function assertSafeIdArgs(args: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(args)) {
    if (!ID_KEY.test(key)) continue
    if (value === undefined || value === null || value === '') continue
    // A flag that shares the naming (merge_client's keepSurvivorIds) never
    // reaches a path.
    if (typeof value === 'boolean') continue
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (invalidId(item)) {
        throw new Error(`${key} is not a valid id (letters, digits, underscore and hyphen only)`)
      }
    }
  }
}

/**
 * Throw unless `path` (absolute path, optional query) reaches exactly the
 * route it spells. `base` is the origin it will be joined to.
 */
export function assertSafePath(base: string, path: string): void {
  if (!path.startsWith('/')) throw new Error('Refused: path must be absolute')
  if (/\.\.|%2e|\\|#/i.test(path)) throw new Error('Refused: path contains a dot segment or an encoded character')
  const queryAt = path.indexOf('?')
  const rawPath = queryAt === -1 ? path : path.slice(0, queryAt)
  if (rawPath.split('/').some((segment) => segment === '.')) throw new Error('Refused: path contains a dot segment')
  const url = new URL(`${base.replace(/\/+$/, '')}${path}`)
  const basePath = new URL(base).pathname.replace(/\/+$/, '')
  if (url.pathname !== `${basePath}${rawPath}`) throw new Error('Refused: path does not normalise to itself')
}
