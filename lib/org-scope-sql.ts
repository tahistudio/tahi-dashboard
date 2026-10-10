import { sql, or, isNull, type SQL } from 'drizzle-orm'
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { OrgScope } from '@/lib/access-scope'

/** Filter before aggregates and limits, with one binding for any scope size. */
export function orgScopeSql(scope: OrgScope, column: SQLiteColumn | SQL, includeNull = false): SQL | undefined {
  if (scope.kind === 'all') return undefined
  const allowed = scope.kind === 'none' ? sql`0 = 1` : sql`${column} IN (SELECT value FROM json_each(${JSON.stringify(scope.orgIds)}))`
  return includeNull ? or(allowed, isNull(column)) : allowed
}
