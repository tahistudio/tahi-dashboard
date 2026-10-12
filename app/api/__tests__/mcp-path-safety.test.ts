/**
 * workers/mcp-server/src/path-safety.ts: tool arguments cannot steer a
 * dashboard call to another route (security review H1).
 */
import { describe, it, expect } from 'vitest'
import { assertSafeIdArgs, assertSafePath } from '../../../workers/mcp-server/src/path-safety'

describe('assertSafeIdArgs', () => {
  it('accepts real id shapes', () => {
    expect(() => assertSafeIdArgs({
      taskId: '3f2b9c1e-1111-4a2b-9c3d-1234567890ab', stripeInvoiceId: 'in_1PabcXYZ', userId: 'user_2abc',
      organizationId: 123, ids: ['a-1', 'b_2'], request_id: 'r1', parentRequestId: null, orgId: '',
    })).not.toThrow()
  })

  it.each(['../invoices/X', '..', 'a/b', 'x?y', 'x#y', '%2e%2e', 'a\\b', 'a b', 'x'.repeat(129)])('refuses %s in an id argument', (bad) => {
    expect(() => assertSafeIdArgs({ taskId: bad })).toThrow('taskId is not a valid id')
    expect(() => assertSafeIdArgs({ id: bad })).toThrow()
    expect(() => assertSafeIdArgs({ request_id: bad })).toThrow()
    expect(() => assertSafeIdArgs({ taskIds: ['ok', bad] })).toThrow()
  })

  it('lets boolean flags named like ids through (merge_client keepSurvivorIds)', () => {
    expect(() => assertSafeIdArgs({ keepSurvivorIds: true, sourceOrgId: 'o1' })).not.toThrow()
    expect(() => assertSafeIdArgs({ keepSurvivorIds: false })).not.toThrow()
  })

  it('leaves non-id arguments alone (bodies may hold any text)', () => {
    expect(() => assertSafeIdArgs({ note: '../anything?', title: 'a/b' })).not.toThrow()
  })
})

describe('assertSafePath', () => {
  const base = 'https://portal.tahi.studio'

  it('accepts ordinary paths with a code-built query', () => {
    expect(() => assertSafePath(base, '/api/admin/tasks/abc/subtasks')).not.toThrow()
    expect(() => assertSafePath(base, '/api/admin/timers?confirmed=true')).not.toThrow()
    expect(() => assertSafePath('https://x.manyrequests.com/api/v1', '/clients/12')).not.toThrow()
  })

  it.each([
    '/api/admin/tasks/../invoices/INV1',
    '/api/admin/tasks/%2e%2e/settings',
    '/api/admin/tasks/%2E%2E/settings',
    '/api/admin/tasks/./x',
    '/api/uploads\\..\\admin',
    '/api/admin/tasks/x#frag',
    'api/admin/tasks',
  ])('refuses %s', (path) => {
    expect(() => assertSafePath(base, path)).toThrow('Refused')
  })
})
