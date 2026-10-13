import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { getRequestAuth } from '@/lib/server-auth'
import { resolvePermissions, type ResolvedAccess } from '@/lib/permissions'
import { permissionSqlite } from './helpers/permission-sqlite'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn(),
  isTahiAdmin: (orgId: string | null) => orgId === 'org_tahi',
}))
vi.mock('@/lib/permissions', async original => ({
  ...await original<typeof import('@/lib/permissions')>(), resolvePermissions: vi.fn(),
}))

import { DELETE as removeSection } from '@/app/api/admin/schedules/[id]/sections/[sectionId]/route'
import { POST as addRow } from '@/app/api/admin/schedules/[id]/rows/route'

let fixture: ReturnType<typeof permissionSqlite>
let access: ResolvedAccess
const context = (id = 'schedule-a') => ({ params: Promise.resolve({ id }) })
const sectionContext = (sectionId: string, id = 'schedule-a') => ({ params: Promise.resolve({ id, sectionId }) })
const request = (method: string, body?: Record<string, unknown>) => new NextRequest('http://localhost/api/admin/schedules/schedule-a/rows', {
  method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
})
const writes = () => fixture.queries.filter(query => /^(?:insert|update|delete)\b/i.test(query))

beforeEach(() => {
  vi.clearAllMocks()
  fixture = permissionSqlite([
    schema.projectSchedules, schema.scheduleSections, schema.scheduleRows,
    schema.organisations, schema.teamMembers, schema.roles, schema.teamMemberRoles,
    schema.teamMemberAccess, schema.teamMemberAccessOrgs,
  ])
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  vi.mocked(getRequestAuth).mockResolvedValue({ userId: 'member', orgId: 'org_tahi', sessionId: 'session' })
  access = {
    userId: 'member', orgId: 'org_tahi', level: 'team_member', audience: 'team',
    isSuperAdmin: false, isAdmin: false, canManagePermissions: false,
    viewableResources: new Set(['schedules']), overrides: new Map(),
  }
  vi.mocked(resolvePermissions).mockImplementation(async () => access)
  fixture.insert(schema.teamMembers, { id: 'tm', clerk_user_id: 'member', role: 'member' })
  fixture.insert(schema.roles, { id: 'role', name: 'designer' })
  fixture.insert(schema.teamMemberRoles, { id: 'assignment', team_member_id: 'tm', role_id: 'role' })
  fixture.insert(schema.teamMemberAccess, { id: 'scope', team_member_id: 'tm', scope_type: 'specific_clients' })
  fixture.insert(schema.teamMemberAccessOrgs, { access_id: 'scope', org_id: 'org-a' })
  for (const id of ['a', 'b']) {
    fixture.insert(schema.organisations, { id: `org-${id}`, name: `Client ${id}` })
    fixture.insert(schema.projectSchedules, { id: `schedule-${id}`, org_id: `org-${id}`, title: `Schedule ${id}`, updated_at: 'before' })
    fixture.insert(schema.scheduleSections, { id: `section-${id}`, schedule_id: `schedule-${id}`, type: 'gantt', position: 0 })
    fixture.insert(schema.scheduleRows, { id: `row-${id}`, schedule_id: `schedule-${id}`, section_id: `section-${id}`, row_type: 'task', label: 'Work', position: 0 })
  }
  fixture.queries.length = 0
})

afterEach(() => fixture.close())

describe('schedule section and row boundaries using real SQLite route queries', () => {
  it('does not cascade another schedule section through an accessible schedule URL', async () => {
    const sections = fixture.rows(schema.scheduleSections)
    const rows = fixture.rows(schema.scheduleRows)
    const response = await removeSection(request('DELETE'), sectionContext('section-b'))
    expect(response.status).toBe(200)
    expect(fixture.rows(schema.scheduleSections)).toEqual(sections)
    expect(fixture.rows(schema.scheduleRows)).toEqual(rows)
    expect(fixture.errors).toEqual([])
  })

  it('deletes an accessible section and only the rows of its own schedule', async () => {
    fixture.insert(schema.scheduleRows, { id: 'foreign-row', schedule_id: 'schedule-b', section_id: 'section-a', row_type: 'task', label: 'Legacy foreign link' })
    const response = await removeSection(request('DELETE'), sectionContext('section-a'))
    expect(response.status).toBe(200)
    expect(fixture.rows(schema.scheduleSections).map(row => row.id)).toEqual(['section-b'])
    expect(fixture.rows(schema.scheduleRows).map(row => row.id)).toEqual(['row-b', 'foreign-row'])
    expect(fixture.errors).toEqual([])
  })

  it.each(['section-b', 'missing', 'text-a'])('rejects row insertion into foreign, missing or non-gantt section %s without writes', async sectionId => {
    fixture.insert(schema.scheduleSections, { id: 'text-a', schedule_id: 'schedule-a', type: 'text' })
    const rows = fixture.rows(schema.scheduleRows)
    const response = await addRow(request('POST', { sectionId, rowType: 'task', label: 'New work' }), context())
    expect(response.status).toBe(400)
    expect(fixture.rows(schema.scheduleRows)).toEqual(rows)
    expect(writes()).toEqual([])
    expect(fixture.errors).toEqual([])
  })

  it.each([true, false])('adds a row to a section of the accessible schedule with explicit section=%s', async explicit => {
    const response = await addRow(request('POST', { ...(explicit ? { sectionId: 'section-a' } : {}), rowType: 'task', label: 'New work' }), context())
    expect(response.status).toBe(201)
    const body = await response.json() as { id: string }
    expect(fixture.rows(schema.scheduleRows).find(row => row.id === body.id)).toMatchObject({ schedule_id: 'schedule-a', section_id: 'section-a', label: 'New work', position: 1 })
    expect(fixture.errors).toEqual([])
  })

  it.each(['delete', 'insert'])('retains the existing schedule org guard on %s', async operation => {
    const response = operation === 'delete'
      ? await removeSection(request('DELETE'), sectionContext('section-b', 'schedule-b'))
      : await addRow(request('POST', { sectionId: 'section-b', rowType: 'task', label: 'Private' }), context('schedule-b'))
    expect(response.status).toBe(403)
    expect(writes()).toEqual([])
  })

  it.each(['delete', 'insert'])('retains the existing feature guard on %s', async operation => {
    access.overrides.set('schedules', 'deny')
    const response = operation === 'delete'
      ? await removeSection(request('DELETE'), sectionContext('section-a'))
      : await addRow(request('POST', { sectionId: 'section-a', rowType: 'task', label: 'Denied' }), context())
    expect(response.status).toBe(403)
    expect(writes()).toEqual([])
  })
})
