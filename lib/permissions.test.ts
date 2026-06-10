import { describe, it, expect } from 'vitest'
import { decideFeature, type ResolvedAccess, type Effect } from '@/lib/permissions'

// Build a ResolvedAccess for a given level. `overrides` is a plain object for brevity.
function access(
  level: ResolvedAccess['level'],
  opts: {
    overrides?: Record<string, Effect>
    viewableResources?: string[] | null
    audience?: ResolvedAccess['audience']
  } = {},
): ResolvedAccess {
  const audience = opts.audience ?? (level === 'client' ? 'client' : 'team')
  return {
    userId: 'u', orgId: 'o', level, audience,
    isSuperAdmin: level === 'super_admin',
    isAdmin: level === 'super_admin' || level === 'admin',
    canManagePermissions: level === 'super_admin' || level === 'admin',
    viewableResources: opts.viewableResources === undefined ? null : (opts.viewableResources ? new Set(opts.viewableResources) : null),
    overrides: new Map(Object.entries(opts.overrides ?? {})),
  }
}

describe('decideFeature — levels', () => {
  it('super_admin sees every team feature, even with a deny override (un-lockable)', () => {
    const a = access('super_admin', { overrides: { requests: 'deny', tasks: 'deny' } })
    expect(decideFeature(a, 'requests')).toBe(true)
    expect(decideFeature(a, 'tasks')).toBe(true)
    expect(decideFeature(a, 'settings.permissions')).toBe(true)
  })

  it('admin sees team features by default, but a deny override hides one', () => {
    const a = access('admin')
    expect(decideFeature(a, 'tasks')).toBe(true)
    expect(decideFeature(a, 'financial_reports')).toBe(true)
    const denied = access('admin', { overrides: { financial_reports: 'deny' } })
    expect(decideFeature(denied, 'financial_reports')).toBe(false)
  })

  it('client sees client-audience features by default but NOT team-only ones', () => {
    const a = access('client')
    expect(decideFeature(a, 'requests')).toBe(true)   // shared audience
    expect(decideFeature(a, 'invoices')).toBe(true)   // shared
    expect(decideFeature(a, 'tasks')).toBe(false)     // team-only
    expect(decideFeature(a, 'financial_reports')).toBe(false) // team-only
    expect(decideFeature(a, 'team')).toBe(false)      // team-only
  })

  it('per-org deny hides a feature from a client', () => {
    const a = access('client', { overrides: { invoices: 'deny' } })
    expect(decideFeature(a, 'invoices')).toBe(false)
    expect(decideFeature(a, 'requests')).toBe(true)
  })

  it('team_member only sees features their role can .view (role baseline)', () => {
    // A task_handler-style role: can view requests + tasks, not invoices/deals.
    const a = access('team_member', { viewableResources: ['requests', 'tasks', 'time_entries', 'docs'] })
    expect(decideFeature(a, 'requests')).toBe(true)
    expect(decideFeature(a, 'tasks')).toBe(true)
    expect(decideFeature(a, 'invoices')).toBe(false) // no invoices.view
    expect(decideFeature(a, 'deals')).toBe(false)    // no deals.view
  })

  it('team_member: an allow override grants a feature the role baseline would deny', () => {
    const a = access('team_member', { viewableResources: ['requests'], overrides: { deals: 'allow' } })
    expect(decideFeature(a, 'deals')).toBe(true)
  })

  it('team_member: ungated features (no resource mapping) are allowed by default', () => {
    const a = access('team_member', { viewableResources: ['requests'] })
    // 'overview' and 'messages' have no FEATURE_RESOURCE mapping.
    expect(decideFeature(a, 'overview')).toBe(true)
    expect(decideFeature(a, 'messages')).toBe(true)
  })
})

describe('decideFeature — ancestry cascade', () => {
  it('denying a parent cascades to a child with no own rule', () => {
    const a = access('admin', { overrides: { requests: 'deny' } })
    expect(decideFeature(a, 'requests')).toBe(false)
    expect(decideFeature(a, 'requests.board')).toBe(false)       // inherits parent deny
    expect(decideFeature(a, 'requests.bulk_actions')).toBe(false)
  })

  it('a child-specific rule beats the parent (most-specific wins)', () => {
    const a = access('admin', { overrides: { requests: 'deny', 'requests.board': 'allow' } })
    expect(decideFeature(a, 'requests')).toBe(false)
    expect(decideFeature(a, 'requests.board')).toBe(true) // own allow beats parent deny
  })
})

describe('decideFeature — edges', () => {
  it('unknown feature keys are not gated (allow)', () => {
    const a = access('client')
    expect(decideFeature(a, 'some.unknown.key')).toBe(true)
  })

  it('a team-only sub-feature is denied to clients even with an allow override', () => {
    // requests.bulk_actions is team-only; audience check precedes overrides.
    const a = access('client', { overrides: { 'requests.bulk_actions': 'allow' } })
    expect(decideFeature(a, 'requests.bulk_actions')).toBe(false)
  })
})
