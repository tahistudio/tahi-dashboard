import { sql, type SQLWrapper } from 'drizzle-orm'
import { safeIds } from '@/app/api/admin/_scoping/org-scope'

/** Repeated org fences share D1's 100-bind budget, so use validated literals. */
export function orgLiteralInScope(column: SQLWrapper, orgIds: readonly string[], opts: { includeNull?: boolean } = {}) {
  const ids = safeIds(orgIds)
  const filter = ids.length
    ? sql`${column} IN (${sql.raw(ids.map(id => `'${id}'`).join(','))})`
    : sql`0 = 1`
  return opts.includeNull ? sql`(${filter} OR ${column} IS NULL)` : filter
}
