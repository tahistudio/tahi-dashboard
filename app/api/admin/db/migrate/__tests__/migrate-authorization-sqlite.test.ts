import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { permissionSqlite } from '@/app/api/__tests__/helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
// Only the verified session boundary is replaced. Permission resolution,
// current role joins, the migration handlers and all SQL execute for real.
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => Boolean(process.env.NEXT_PUBLIC_TAHI_ORG_ID && orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID),
}))

import { GET, POST } from '../route'

let fixture: ReturnType<typeof permissionSqlite>
const surfaces = ['GET list', 'GET run', 'POST run'] as const
type Surface = typeof surfaces[number]

function requestFor(surface: Surface): NextRequest {
  return new NextRequest(`http://localhost/api/admin/db/migrate${surface === 'GET run' ? '?run=0111' : ''}`, {
    method: surface === 'POST run' ? 'POST' : 'GET',
    ...(surface === 'POST run' ? {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '0111', userId: 'api-service', isSuperAdmin: true }),
    } : {}),
  })
}

function invoke(surface: Surface, request = requestFor(surface)) {
  return surface === 'POST run' ? POST(request) : GET(request)
}

function asUser(userId: string | null, orgId: string | null = 'tahi-org') {
  vi.mocked(getRequestAuth).mockResolvedValue({ userId, orgId, sessionId: 'verified-session' })
}

const permissionQueries = () => fixture.queries.filter(query => /\b(?:team_members|team_member_roles|roles|role_permissions|permissions|feature_visibility)\b/.test(query))
const businessQueries = () => fixture.queries.filter(query => !/^select\b/i.test(query))

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('NEXT_PUBLIC_TAHI_ORG_ID', 'tahi-org')
  fixture = permissionSqlite([
    schema.teamMembers, schema.roles, schema.teamMemberRoles,
    schema.permissions, schema.rolePermissions, schema.featureVisibility,
  ], [
    `CREATE TABLE task_suggestions (id TEXT PRIMARY KEY, applied_task_id TEXT, applied_request_id TEXT, org_id TEXT, status TEXT, decided_at TEXT)`,
    `INSERT INTO task_suggestions (id, status) VALUES ('preserve-me', 'pending')`,
  ])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  for (const user of ['roleless', 'admin', 'revoked', 'founder']) {
    // A stale legacy admin flag never substitutes for a current super role.
    fixture.insert(schema.teamMembers, { id: `tm-${user}`, clerk_user_id: user, role: 'admin' })
  }
  fixture.insert(schema.roles, { id: 'role-founder', name: 'super_admin' })
  fixture.insert(schema.roles, { id: 'role-admin', name: 'admin' })
  fixture.insert(schema.teamMemberRoles, { id: 'grant-founder', team_member_id: 'tm-founder', role_id: 'role-founder', ended_at: null })
  fixture.insert(schema.teamMemberRoles, { id: 'grant-admin', team_member_id: 'tm-admin', role_id: 'role-admin', ended_at: null })
  fixture.insert(schema.teamMemberRoles, { id: 'grant-revoked', team_member_id: 'tm-revoked', role_id: 'role-founder', ended_at: '2026-10-10T00:00:00Z' })
})

afterEach(() => { fixture.close(); vi.unstubAllEnvs() })

describe.each(surfaces)('migration authorization through %s', surface => {
  it.each(['roleless', 'admin', 'revoked', 'unknown'])('denies %s before listing, parsing the body or executing business SQL', async userId => {
    asUser(userId)
    const request = requestFor(surface)
    const parse = vi.spyOn(request, 'json')
    const response = await invoke(surface, request)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
    expect(parse).not.toHaveBeenCalled()
    expect(permissionQueries().length).toBeGreaterThan(0)
    expect(businessQueries()).toEqual([])
    expect(fixture.rows(schema.taskSuggestions)).toEqual([{ id: 'preserve-me', applied_task_id: null, applied_request_id: null, org_id: null, status: 'pending', decided_at: null }])
  })

  it.each([
    { userId: 'founder', orgId: 'client-org' },
    { userId: 'api-service', orgId: 'client-org' },
    { userId: 'api-service', orgId: null },
    { userId: null, orgId: 'tahi-org' },
  ])('denies identity $userId at $orgId before any database access', async ({ userId, orgId }) => {
    asUser(userId, orgId)
    expect((await invoke(surface)).status).toBe(403)
    expect(db).not.toHaveBeenCalled()
    expect(fixture.queries).toEqual([])
  })

  it('does not treat the unseeded ordinary-admin fallback as a super admin', async () => {
    await fixture.database.delete(schema.teamMemberRoles)
    fixture.queries.length = 0
    asUser('roleless')
    expect((await invoke(surface)).status).toBe(403)
    expect(permissionQueries().length).toBeGreaterThan(0)
    expect(businessQueries()).toEqual([])
  })

  it.each(['team_members', 'roles', 'feature_visibility'])('fails closed if the real permission lookup cannot read %s', async table => {
    await fixture.database.run(sql.raw(`DROP TABLE ${table}`))
    fixture.queries.length = 0
    asUser('founder')
    expect((await invoke(surface)).status).toBe(403)
    expect(businessQueries()).toEqual([])
    expect(fixture.errors.length).toBeGreaterThan(0)
  })

  it('fails closed when the permission database is unavailable', async () => {
    asUser('founder')
    vi.mocked(db).mockRejectedValueOnce(new Error('Permission database unavailable'))
    expect((await invoke(surface)).status).toBe(403)
    expect(db).toHaveBeenCalledTimes(1)
    expect(fixture.queries).toEqual([])
  })

  it.each(['founder', 'api-service'])('allows the verified %s contract', async userId => {
    asUser(userId)
    if (userId === 'api-service') {
      // The service grant works without any permission tables or roster row.
      for (const table of ['team_members', 'team_member_roles', 'roles', 'feature_visibility']) {
        await fixture.database.run(sql.raw(`DROP TABLE ${table}`))
      }
      fixture.queries.length = 0
    }
    const response = await invoke(surface)
    expect(response.status).toBe(200)
    const body = await response.json()
    if (surface === 'GET list') {
      expect(body).toMatchObject({ migrations: expect.arrayContaining([expect.objectContaining({ name: '0111', statementCount: 9 })]) })
      expect(businessQueries()).toEqual([])
    } else {
      expect(body).toEqual({ results: [{ name: '0111', status: 'applied', statementCount: 9, skippedAlreadyExists: 0 }] })
      expect(businessQueries()).toHaveLength(9)
    }
    if (userId === 'api-service') expect(permissionQueries()).toEqual([])
    else expect(permissionQueries().length).toBeGreaterThan(0)
  })

  it('re-reads a founder role after revocation instead of caching the previous grant', async () => {
    asUser('founder')
    expect((await GET(requestFor('GET list'))).status).toBe(200)
    await fixture.database.update(schema.teamMemberRoles).set({ endedAt: '2026-10-11T00:00:00Z' })
      .where(eq(schema.teamMemberRoles.id, 'grant-founder'))
    fixture.queries.length = 0
    expect((await invoke(surface)).status).toBe(403)
    expect(permissionQueries().length).toBeGreaterThan(0)
    expect(businessQueries()).toEqual([])
  })
})
