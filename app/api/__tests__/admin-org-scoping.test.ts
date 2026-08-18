/**
 * Unit tests for the pure org-scoping decisions shared by the deals,
 * conversations, calls, time and announcements admin routes.
 *
 * These are deliberately database-free: the SQL builders are inspected through
 * drizzle's own SQL objects so the D1 bound-parameter cap and the fail-closed
 * behaviour can be asserted without a live D1.
 */
import { describe, it, expect } from 'vitest'
import { Column, Param, SQL } from 'drizzle-orm'
import { schema } from '@/db/d1'
import type { OrgScope } from '@/lib/access-scope'
import {
  MAX_BOUND_IDS,
  areAllOrgsInScope,
  columnInIds,
  isOrgInScope,
  orgColumnInScope,
  safeIds,
} from '@/app/api/admin/_scoping/org-scope'
import {
  canReadAnnouncement,
  canWriteAnnouncement,
  parseTargetIds,
} from '@/app/api/admin/announcements/_access'

const ALL: OrgScope = { kind: 'all' }
const NONE: OrgScope = { kind: 'none' }
const SOME: OrgScope = { kind: 'some', orgIds: ['org-a', 'org-b'] }

// ---------------------------------------------------------------------------
// SQL inspection: walk a drizzle SQL tree and collect columns / params / text
// ---------------------------------------------------------------------------
type Collected = { cols: string[]; params: unknown[]; text: string }

function walk(node: unknown, out: Collected): void {
  if (node instanceof SQL) {
    for (const chunk of node.queryChunks) walk(chunk, out)
    return
  }
  if (node instanceof Column) {
    out.cols.push(node.name)
    return
  }
  if (node instanceof Param) {
    out.params.push(node.value)
    return
  }
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out)
    return
  }
  if (node && typeof node === 'object' && 'value' in node) {
    const value = (node as { value: unknown }).value
    if (Array.isArray(value)) out.text += value.join('')
  }
}

function inspect(sqlNode: SQL): Collected {
  const out: Collected = { cols: [], params: [], text: '' }
  walk(sqlNode, out)
  return out
}

// ---------------------------------------------------------------------------
// isOrgInScope
// ---------------------------------------------------------------------------
describe('isOrgInScope', () => {
  it('lets an unrestricted caller through for any org', () => {
    expect(isOrgInScope(ALL, 'org-z')).toBe(true)
    expect(isOrgInScope(ALL, null, 'deny')).toBe(true)
    expect(isOrgInScope(ALL, null, 'allow')).toBe(true)
  })

  it('filters a scoped caller to their orgs', () => {
    expect(isOrgInScope(SOME, 'org-a')).toBe(true)
    expect(isOrgInScope(SOME, 'org-z')).toBe(false)
  })

  it('shows an empty scope nothing, never everything', () => {
    expect(isOrgInScope(NONE, 'org-a')).toBe(false)
    expect(isOrgInScope(NONE, 'org-z')).toBe(false)
  })

  describe('null org rules', () => {
    it('deny hides unassigned rows from every restricted caller', () => {
      expect(isOrgInScope(SOME, null, 'deny')).toBe(false)
      expect(isOrgInScope(NONE, null, 'deny')).toBe(false)
    })

    it('allow-if-any-scope keeps unlinked deals on a scoped board but not for an empty scope', () => {
      expect(isOrgInScope(SOME, null, 'allow-if-any-scope')).toBe(true)
      expect(isOrgInScope(NONE, null, 'allow-if-any-scope')).toBe(false)
    })

    it('allow keeps Tahi-internal conversations readable, participation being the real gate', () => {
      expect(isOrgInScope(SOME, null, 'allow')).toBe(true)
      expect(isOrgInScope(NONE, null, 'allow')).toBe(true)
    })

    it('treats undefined like null', () => {
      expect(isOrgInScope(SOME, undefined, 'allow-if-any-scope')).toBe(true)
      expect(isOrgInScope(SOME, undefined, 'deny')).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// areAllOrgsInScope
// ---------------------------------------------------------------------------
describe('areAllOrgsInScope', () => {
  it('requires every org, not just one', () => {
    expect(areAllOrgsInScope(SOME, ['org-a'])).toBe(true)
    expect(areAllOrgsInScope(SOME, ['org-a', 'org-b'])).toBe(true)
    expect(areAllOrgsInScope(SOME, ['org-a', 'org-z'])).toBe(false)
  })

  it('never reads an empty list as permission to target everyone', () => {
    expect(areAllOrgsInScope(SOME, [])).toBe(false)
    expect(areAllOrgsInScope(NONE, [])).toBe(false)
    expect(areAllOrgsInScope(ALL, [])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// columnInIds / orgColumnInScope
// ---------------------------------------------------------------------------
describe('columnInIds', () => {
  it('binds ids as parameters while under the D1 cap', () => {
    const out = inspect(columnInIds(schema.deals.orgId, ['org-a', 'org-b']))
    expect(out.cols).toContain('org_id')
    expect(out.params).toEqual(['org-a', 'org-b'])
    expect(out.text).not.toContain("'org-a'")
  })

  it('inlines ids as literals past the D1 bound-parameter cap', () => {
    const many = Array.from({ length: MAX_BOUND_IDS + 5 }, (_, i) => `org-${i}`)
    const out = inspect(columnInIds(schema.timeEntries.orgId, many))
    expect(out.params).toHaveLength(0)
    expect(out.text).toContain("'org-0'")
    expect(out.text).toContain(`'org-${MAX_BOUND_IDS + 4}'`)
  })

  it('drops ids that could not have come from our own D1', () => {
    expect(safeIds(["org-a", "bad'id", 'ok_1', 'a b'])).toEqual(['org-a', 'ok_1'])
    const many = [
      ...Array.from({ length: MAX_BOUND_IDS + 1 }, (_, i) => `org-${i}`),
      "'; drop table deals; --",
    ]
    const out = inspect(columnInIds(schema.deals.orgId, many))
    expect(out.text).not.toContain('drop table')
  })

  it('is never-true for an empty id list', () => {
    const out = inspect(columnInIds(schema.deals.orgId, []))
    expect(out.text).toContain('1 = 0')
    expect(out.cols).toHaveLength(0)
  })

  it('optionally admits rows whose org column is null', () => {
    const withNull = inspect(orgColumnInScope(schema.deals.orgId, ['org-a'], { includeNull: true }))
    expect(withNull.text).toContain('is null')
    const withoutNull = inspect(orgColumnInScope(schema.scheduledCalls.orgId, ['org-a']))
    expect(withoutNull.text).not.toContain('is null')
  })
})

// ---------------------------------------------------------------------------
// Announcement targeting
// ---------------------------------------------------------------------------
describe('announcement targeting', () => {
  it('parses stored target ids and tolerates junk', () => {
    expect(parseTargetIds('["org-a","org-b"]')).toEqual(['org-a', 'org-b'])
    expect(parseTargetIds(null)).toBeNull()
    expect(parseTargetIds('not json')).toBeNull()
    expect(parseTargetIds('{"a":1}')).toBeNull()
    expect(parseTargetIds('["org-a",7]')).toEqual(['org-a'])
  })

  it('lets an unrestricted caller keep every targeting option', () => {
    expect(canWriteAnnouncement(ALL, { targetType: 'all', targetIds: null })).toBe(true)
    expect(canWriteAnnouncement(ALL, { targetType: 'plan_type', targetIds: null })).toBe(true)
    expect(canWriteAnnouncement(ALL, { targetType: 'org', targetIds: ['org-z'] })).toBe(true)
  })

  it('refuses a scoped caller any blast that reaches past their clients', () => {
    expect(canWriteAnnouncement(SOME, { targetType: 'all', targetIds: null })).toBe(false)
    expect(canWriteAnnouncement(SOME, { targetType: 'plan_type', targetIds: null })).toBe(false)
    expect(canWriteAnnouncement(SOME, { targetType: 'org', targetIds: ['org-a', 'org-z'] })).toBe(false)
    expect(canWriteAnnouncement(SOME, { targetType: 'org', targetIds: ['org-a'] })).toBe(true)
  })

  it('refuses every write for an empty scope', () => {
    expect(canWriteAnnouncement(NONE, { targetType: 'org', targetIds: ['org-a'] })).toBe(false)
    expect(canWriteAnnouncement(NONE, { targetType: 'all', targetIds: null })).toBe(false)
  })

  it('keeps studio-wide announcements readable but hides other clients org blasts', () => {
    expect(canReadAnnouncement(SOME, { targetType: 'all', targetIds: null })).toBe(true)
    expect(canReadAnnouncement(NONE, { targetType: 'all', targetIds: null })).toBe(true)
    expect(canReadAnnouncement(SOME, { targetType: 'org', targetIds: ['org-b'] })).toBe(true)
    expect(canReadAnnouncement(SOME, { targetType: 'org', targetIds: ['org-z'] })).toBe(false)
    expect(canReadAnnouncement(NONE, { targetType: 'org', targetIds: ['org-a'] })).toBe(false)
    expect(canReadAnnouncement(ALL, { targetType: 'org', targetIds: ['org-z'] })).toBe(true)
  })
})
