import { describe, it, expect } from 'vitest'

/**
 * T161 - Team member access scoping logic tests.
 *
 * Scoping rules:
 *   - Admins (TAHI_ORG_ID) bypass all scoping
 *   - Deny by default for all other team members
 *   - Scope types: 'all_clients', 'plan_type', 'specific_clients'
 *   - Track type: 'all', 'small', 'large'
 */

interface AccessRule {
  role: 'project_manager' | 'task_handler' | 'viewer'
  scopeType: 'all_clients' | 'plan_type' | 'specific_clients'
  planType: string | null
  trackType: 'all' | 'small' | 'large'
  orgIds: string[]
}

interface OrgInfo {
  id: string
  planType: string | null
}

function canAccessOrg(
  rules: AccessRule[],
  org: OrgInfo,
  isTahiAdmin: boolean,
): boolean {
  if (isTahiAdmin) return true
  if (rules.length === 0) return false

  return rules.some(rule => {
    switch (rule.scopeType) {
      case 'all_clients':
        return true
      case 'plan_type':
        return rule.planType !== null && org.planType === rule.planType
      case 'specific_clients':
        return rule.orgIds.includes(org.id)
      default:
        return false
    }
  })
}

function filterOrgs(
  rules: AccessRule[],
  orgs: OrgInfo[],
  isTahiAdmin: boolean,
): OrgInfo[] {
  return orgs.filter(org => canAccessOrg(rules, org, isTahiAdmin))
}

function getHighestRole(rules: AccessRule[]): string | null {
  const priority = { project_manager: 3, task_handler: 2, viewer: 1 }
  let highest: string | null = null
  let highestPriority = 0
  for (const rule of rules) {
    const p = priority[rule.role] ?? 0
    if (p > highestPriority) {
      highestPriority = p
      highest = rule.role
    }
  }
  return highest
}

describe('canAccessOrg', () => {
  it('always allows Tahi admin', () => {
    const result = canAccessOrg([], { id: 'org-1', planType: 'maintain' }, true)
    expect(result).toBe(true)
  })

  it('denies by default when no rules', () => {
    const result = canAccessOrg([], { id: 'org-1', planType: 'maintain' }, false)
    expect(result).toBe(false)
  })

  it('allows all_clients scope', () => {
    const rules: AccessRule[] = [{
      role: 'viewer',
      scopeType: 'all_clients',
      planType: null,
      trackType: 'all',
      orgIds: [],
    }]
    const result = canAccessOrg(rules, { id: 'org-1', planType: 'scale' }, false)
    expect(result).toBe(true)
  })

  it('allows plan_type match', () => {
    const rules: AccessRule[] = [{
      role: 'task_handler',
      scopeType: 'plan_type',
      planType: 'maintain',
      trackType: 'all',
      orgIds: [],
    }]
    expect(canAccessOrg(rules, { id: 'org-1', planType: 'maintain' }, false)).toBe(true)
    expect(canAccessOrg(rules, { id: 'org-2', planType: 'scale' }, false)).toBe(false)
  })

  it('allows specific_clients match', () => {
    const rules: AccessRule[] = [{
      role: 'project_manager',
      scopeType: 'specific_clients',
      planType: null,
      trackType: 'all',
      orgIds: ['org-1', 'org-3'],
    }]
    expect(canAccessOrg(rules, { id: 'org-1', planType: null }, false)).toBe(true)
    expect(canAccessOrg(rules, { id: 'org-2', planType: null }, false)).toBe(false)
    expect(canAccessOrg(rules, { id: 'org-3', planType: null }, false)).toBe(true)
  })

  it('allows if any rule matches (multiple rules)', () => {
    const rules: AccessRule[] = [
      {
        role: 'viewer',
        scopeType: 'plan_type',
        planType: 'maintain',
        trackType: 'all',
        orgIds: [],
      },
      {
        role: 'task_handler',
        scopeType: 'specific_clients',
        planType: null,
        trackType: 'all',
        orgIds: ['org-5'],
      },
    ]
    expect(canAccessOrg(rules, { id: 'org-5', planType: 'scale' }, false)).toBe(true)
  })
})

describe('filterOrgs', () => {
  const orgs: OrgInfo[] = [
    { id: 'org-1', planType: 'maintain' },
    { id: 'org-2', planType: 'scale' },
    { id: 'org-3', planType: 'maintain' },
    { id: 'org-4', planType: null },
  ]

  it('returns all orgs for Tahi admin', () => {
    const result = filterOrgs([], orgs, true)
    expect(result).toHaveLength(4)
  })

  it('returns empty for no rules', () => {
    const result = filterOrgs([], orgs, false)
    expect(result).toHaveLength(0)
  })

  it('filters by plan type', () => {
    const rules: AccessRule[] = [{
      role: 'viewer',
      scopeType: 'plan_type',
      planType: 'maintain',
      trackType: 'all',
      orgIds: [],
    }]
    const result = filterOrgs(rules, orgs, false)
    expect(result).toHaveLength(2)
    expect(result.map(o => o.id)).toEqual(['org-1', 'org-3'])
  })
})

describe('getHighestRole', () => {
  it('returns null for empty rules', () => {
    expect(getHighestRole([])).toBeNull()
  })

  it('returns project_manager as highest', () => {
    const rules: AccessRule[] = [
      { role: 'viewer', scopeType: 'all_clients', planType: null, trackType: 'all', orgIds: [] },
      { role: 'project_manager', scopeType: 'all_clients', planType: null, trackType: 'all', orgIds: [] },
    ]
    expect(getHighestRole(rules)).toBe('project_manager')
  })

  it('returns task_handler when no PM rule', () => {
    const rules: AccessRule[] = [
      { role: 'viewer', scopeType: 'all_clients', planType: null, trackType: 'all', orgIds: [] },
      { role: 'task_handler', scopeType: 'all_clients', planType: null, trackType: 'all', orgIds: [] },
    ]
    expect(getHighestRole(rules)).toBe('task_handler')
  })
})
