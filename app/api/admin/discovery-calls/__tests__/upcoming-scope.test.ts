/**
 * Unit tests for the pure org-scoping decision behind
 * GET /api/admin/discovery-calls/upcoming (audit T1.19: the teammate home
 * "Today's calls" card must not leak studio-wide sales calls to a scoped
 * team member).
 *
 * Only the pure helper is exercised here; the privileged bypasses (owner /
 * super_admin / admin / MCP token -> { kind: 'all' }) are resolved upstream
 * by scopedOrgIds and covered by its own suite. The invariant proven here:
 * { kind: 'all' } never filters, so owner behaviour is unchanged.
 */
import { describe, it, expect } from 'vitest'
import type { OrgScope } from '@/lib/access-scope'
import {
  keepUpcomingCallForScope,
  type ParentOrgIndex,
  type UpcomingCallLinkage,
} from '@/app/api/admin/discovery-calls/upcoming/scope-upcoming'

const NO_PARENTS: ParentOrgIndex = {
  dealOrgById: new Map(),
  requestOrgById: new Map(),
  taskOrgById: new Map(),
}

function call(partial: Partial<UpcomingCallLinkage>): UpcomingCallLinkage {
  return { orgId: null, dealId: null, requestId: null, taskId: null, ...partial }
}

const SOME: OrgScope = { kind: 'some', orgIds: ['org_a', 'org_b'] }

describe('keepUpcomingCallForScope', () => {
  it('never filters an unrestricted caller (owner / admin behaviour unchanged)', () => {
    const all: OrgScope = { kind: 'all' }
    expect(keepUpcomingCallForScope(all, call({ orgId: 'org_z' }), NO_PARENTS)).toBe(true)
    expect(keepUpcomingCallForScope(all, call({ dealId: 'deal_1' }), NO_PARENTS)).toBe(true)
    expect(keepUpcomingCallForScope(all, call({}), NO_PARENTS)).toBe(true)
  })

  it('shows nothing to a deny-by-default caller', () => {
    const none: OrgScope = { kind: 'none' }
    expect(keepUpcomingCallForScope(none, call({ orgId: 'org_a' }), NO_PARENTS)).toBe(false)
    expect(keepUpcomingCallForScope(none, call({}), NO_PARENTS)).toBe(false)
  })

  it('checks a direct orgId against the scope', () => {
    expect(keepUpcomingCallForScope(SOME, call({ orgId: 'org_a' }), NO_PARENTS)).toBe(true)
    expect(keepUpcomingCallForScope(SOME, call({ orgId: 'org_z' }), NO_PARENTS)).toBe(false)
  })

  it('resolves a null-org call through its linked deal', () => {
    const parents: ParentOrgIndex = {
      ...NO_PARENTS,
      dealOrgById: new Map([
        ['deal_in', 'org_a'],
        ['deal_out', 'org_z'],
      ]),
    }
    expect(keepUpcomingCallForScope(SOME, call({ dealId: 'deal_in' }), parents)).toBe(true)
    expect(keepUpcomingCallForScope(SOME, call({ dealId: 'deal_out' }), parents)).toBe(false)
  })

  it('resolves a null-org call through its linked request or task', () => {
    const parents: ParentOrgIndex = {
      dealOrgById: new Map(),
      requestOrgById: new Map([['req_out', 'org_z']]),
      taskOrgById: new Map([['task_in', 'org_b']]),
    }
    expect(keepUpcomingCallForScope(SOME, call({ requestId: 'req_out' }), parents)).toBe(false)
    expect(keepUpcomingCallForScope(SOME, call({ taskId: 'task_in' }), parents)).toBe(true)
  })

  it('fails closed on multi-parent calls when any resolved org is out of scope', () => {
    const parents: ParentOrgIndex = {
      dealOrgById: new Map([['deal_in', 'org_a']]),
      requestOrgById: new Map([['req_out', 'org_z']]),
      taskOrgById: new Map(),
    }
    expect(
      keepUpcomingCallForScope(SOME, call({ dealId: 'deal_in', requestId: 'req_out' }), parents),
    ).toBe(false)
  })

  it('keeps pre-client calls (no client linkage) visible to anyone holding a scope', () => {
    // Lead-only call, and a call whose parent ids resolve to nothing (row
    // deleted, or an orgless deal): no client data reachable, same rule as
    // calls/index unassigned rows.
    expect(keepUpcomingCallForScope(SOME, call({}), NO_PARENTS)).toBe(true)
    expect(keepUpcomingCallForScope(SOME, call({ dealId: 'deal_gone' }), NO_PARENTS)).toBe(true)
    const orglessDeal: ParentOrgIndex = { ...NO_PARENTS, dealOrgById: new Map([['deal_open', null]]) }
    expect(keepUpcomingCallForScope(SOME, call({ dealId: 'deal_open' }), orglessDeal)).toBe(true)
  })
})
