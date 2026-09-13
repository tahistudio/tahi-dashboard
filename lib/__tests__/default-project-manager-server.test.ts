/**
 * Unit tests for lib/default-project-manager-server.ts assignDefaultProjectManager.
 *
 * "project manager for all clients, and is the default for all new ones...
 * by type of project/retainer." This is the writer: it reads
 * studio.defaultProjectManagerId.retainer or .project, and writes the same
 * team_member_access + team_member_access_orgs rows PUT
 * /api/admin/clients/{id}/pm writes, ONLY when the org does not already carry
 * a project_manager rule from any source.
 *
 * The stub is keyed by table reference (same idiom as
 * lib/__tests__/access-scoping-resolve.test.ts): select().from(table) reads
 * the queue this test configured for that exact schema table, where()/limit()
 * are no-ops on the pre-filtered rows, and the chain is thenable.
 */
import { describe, it, expect } from 'vitest'
import { assignDefaultProjectManager } from '@/lib/default-project-manager-server'
import { schema } from '@/db/d1'

type Row = Record<string, unknown>
type StubDb = Parameters<typeof assignDefaultProjectManager>[0]

interface State {
  settingsRows: Row[]
  teamMemberAccessOrgsRows: Row[]
  teamMemberAccessRows: Row[]
  teamMembersRows: Row[]
  inserted: Array<{ table: unknown; values: Row }>
}

function emptyState(): State {
  return {
    settingsRows: [],
    teamMemberAccessOrgsRows: [],
    teamMemberAccessRows: [],
    teamMembersRows: [],
    inserted: [],
  }
}

function makeDb(state: State): StubDb {
  function chainFor(rows: Row[]) {
    const node = {
      where: () => node,
      limit: () => node,
      then: (onOk: (r: Row[]) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(rows).then(onOk, onErr),
    }
    return node
  }
  return {
    select: () => ({
      from: (table: unknown) => {
        if (table === schema.settings) return chainFor(state.settingsRows)
        if (table === schema.teamMemberAccessOrgs) return chainFor(state.teamMemberAccessOrgsRows)
        if (table === schema.teamMemberAccess) return chainFor(state.teamMemberAccessRows)
        if (table === schema.teamMembers) return chainFor(state.teamMembersRows)
        return chainFor([])
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Row) => {
        state.inserted.push({ table, values })
        return Promise.resolve(undefined)
      },
    }),
  } as unknown as StubDb
}

describe('assignDefaultProjectManager', () => {
  it('retainer default: writes the project_manager rule from studio.defaultProjectManagerId.retainer', async () => {
    const state = emptyState()
    state.settingsRows = [{ value: 'tm_liam' }]
    state.teamMembersRows = [{ id: 'tm_liam' }]

    await assignDefaultProjectManager(makeDb(state), 'org_acme', 'retainer')

    expect(state.inserted).toHaveLength(2)
    const accessInsert = state.inserted.find((row) => row.table === schema.teamMemberAccess)
    const orgInsert = state.inserted.find((row) => row.table === schema.teamMemberAccessOrgs)
    expect(accessInsert?.values).toMatchObject({
      teamMemberId: 'tm_liam',
      role: 'project_manager',
      scopeType: 'specific_clients',
      trackType: 'all',
    })
    expect(orgInsert?.values).toMatchObject({ orgId: 'org_acme' })
    expect(orgInsert?.values.accessId).toBe(accessInsert?.values.id)
  })

  it('project default: writes the project_manager rule from studio.defaultProjectManagerId.project', async () => {
    const state = emptyState()
    state.settingsRows = [{ value: 'tm_staci' }]
    state.teamMembersRows = [{ id: 'tm_staci' }]

    await assignDefaultProjectManager(makeDb(state), 'org_launch', 'project')

    expect(state.inserted).toHaveLength(2)
    const accessInsert = state.inserted.find((row) => row.table === schema.teamMemberAccess)
    expect(accessInsert?.values).toMatchObject({ teamMemberId: 'tm_staci', role: 'project_manager' })
  })

  it('both empty: no setting configured for either engagement type writes nothing', async () => {
    const state = emptyState()
    // state.settingsRows stays [] for both calls below.

    await assignDefaultProjectManager(makeDb(state), 'org_acme', 'retainer')
    await assignDefaultProjectManager(makeDb(state), 'org_acme', 'project')

    expect(state.inserted).toEqual([])
  })

  it('unknown member id: the setting names a team member who no longer exists, so it is skipped exactly like an empty setting', async () => {
    const state = emptyState()
    state.settingsRows = [{ value: 'tm_deleted' }]
    state.teamMembersRows = [] // no row for tm_deleted

    await assignDefaultProjectManager(makeDb(state), 'org_acme', 'retainer')

    expect(state.inserted).toEqual([])
  })

  it('idempotent: a second call for the same org writes nothing more, even with the same default still configured', async () => {
    const state = emptyState()
    state.settingsRows = [{ value: 'tm_liam' }]
    state.teamMembersRows = [{ id: 'tm_liam' }]
    const db = makeDb(state)

    await assignDefaultProjectManager(db, 'org_acme', 'retainer')
    expect(state.inserted).toHaveLength(2)

    // Simulate the rule this call just wrote now being visible, the same way
    // a real D1 read would see it on the very next call.
    const accessInsert = state.inserted.find((row) => row.table === schema.teamMemberAccess)
    const accessId = (accessInsert?.values as { id: string }).id
    state.teamMemberAccessOrgsRows = [{ accessId }]
    state.teamMemberAccessRows = [{ id: accessId }]

    await assignDefaultProjectManager(db, 'org_acme', 'retainer')
    expect(state.inserted).toHaveLength(2)
  })

  it('idempotent against a MANUALLY assigned PM too: an existing project_manager rule from any source blocks the default', async () => {
    const state = emptyState()
    state.settingsRows = [{ value: 'tm_liam' }]
    state.teamMembersRows = [{ id: 'tm_liam' }]
    // A human already assigned a PM via PUT /api/admin/clients/{id}/pm.
    state.teamMemberAccessOrgsRows = [{ accessId: 'access_manual' }]
    state.teamMemberAccessRows = [{ id: 'access_manual' }]

    await assignDefaultProjectManager(makeDb(state), 'org_acme', 'retainer')

    expect(state.inserted).toEqual([])
  })

  it('never throws when the database itself fails: client creation must never break over this', async () => {
    const throwingDb = {
      select: () => {
        throw new Error('D1_ERROR: network connection lost')
      },
    } as unknown as StubDb

    await expect(assignDefaultProjectManager(throwingDb, 'org_acme', 'retainer')).resolves.toBeUndefined()
  })
})
