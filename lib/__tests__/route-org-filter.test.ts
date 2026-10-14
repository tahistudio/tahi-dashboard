import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core'
import { orgLiteralInScope } from '@/lib/route-org-filter'

describe('repeated admin org SQL fences', () => {
  it('uses no bind budget even when several source fences share one query', () => {
    const orgs = Array.from({ length: 120 }, (_, index) => `org-${index}`)
    const condition = sql`${orgLiteralInScope(sql`requests.org_id`, orgs)} AND ${orgLiteralInScope(sql`tasks.org_id`, orgs)}`
    const query = new SQLiteSyncDialect().sqlToQuery(condition)
    expect(query.params).toEqual([])
    expect(query.sql).toContain("'org-119'")
    expect(query.sql).toContain('tasks.org_id IN')
  })

  it('rejects unsafe ids and fails closed instead of interpolating SQL input', () => {
    const query = new SQLiteSyncDialect().sqlToQuery(orgLiteralInScope(sql`org_id`, ["x' OR 1=1 --", 'bad id', 'org-safe']))
    expect(query.sql).toBe("org_id IN ('org-safe')")
    expect(query.params).toEqual([])
    expect(new SQLiteSyncDialect().sqlToQuery(orgLiteralInScope(sql`org_id`, ["x'"])).sql).toBe('0 = 1')
  })

  it('includes org-less studio work only when explicitly requested', () => {
    expect(new SQLiteSyncDialect().sqlToQuery(orgLiteralInScope(sql`org_id`, [], { includeNull: true })).sql).toBe('(0 = 1 OR org_id IS NULL)')
  })
})
