/**
 * Contact management on the client page: edit, delete, merge.
 *
 * The rules worth pinning are the ones that protect a login and a client's
 * history. The email of a contact that signs in is never rewritten here.
 * A contact with a login, the only primary at an organisation that still
 * has people, and anything referenced anywhere is refused with a reason
 * that names what stands in the way. When someone else is named to take
 * over, every referencing column moves before the row goes.
 *
 * The reference writes are raw SQL, so the fake D1 renders each statement
 * through drizzle's own SQLite dialect and the merge test asserts the
 * rendered UPDATE for every column that can hold a contacts.id. That list
 * is hand-written here, on purpose: it is the claim the module has to meet,
 * not something read back from it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { getTableName, type SQL } from 'drizzle-orm'
import { SQLiteSyncDialect, type AnySQLiteTable } from 'drizzle-orm/sqlite-core'

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: vi.fn().mockResolvedValue({ userId: 'user_admin', orgId: 'org_tahi' }),
  isTahiAdmin: vi.fn((orgId: string | null) => orgId === 'org_tahi'),
}))

vi.mock('@/lib/require-feature', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/require-access', () => ({
  requireAccessToOrg: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/require-permission', () => ({
  requireManagePermissions: vi.fn().mockResolvedValue({ denied: null }),
}))

const captured: {
  audits: Record<string, unknown>[]
  runs: { sql: string; params: unknown[] }[]
  gets: { sql: string; params: unknown[] }[]
  updates: { table: string; set: Record<string, unknown>; where: { sql: string; params: unknown[] } }[]
  deletes: { table: string; where: { sql: string; params: unknown[] } }[]
  order: string[]
} = { audits: [], runs: [], gets: [], updates: [], deletes: [], order: [] }

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockImplementation((_db: unknown, entry: Record<string, unknown>) => {
    captured.audits.push(entry)
    return Promise.resolve(undefined)
  }),
}))

interface ContactRow {
  id: string
  orgId: string
  name: string
  email: string
  phone: string | null
  role: string | null
  isPrimary: boolean
  portalRole: string
  clerkUserId: string | null
  lastLoginAt: string | null
  personId: string | null
  manyrequestsId: string | null
}

/** The fake world the routes read. */
const world: {
  contacts: ContactRow[]
  /** count(*) answers keyed by table name */
  counts: Record<string, number>
  calls: { id: string; attendees: string }[]
} = { contacts: [], counts: {}, calls: [] }

const dialect = new SQLiteSyncDialect()
function render(q: SQL): { sql: string; params: unknown[] } {
  const out = dialect.sqlToQuery(q)
  return { sql: out.sql, params: out.params }
}

function answerSelect(table: string, where: { sql: string; params: unknown[] }): unknown[] {
  if (table === 'contacts') {
    if (where.sql.includes('"contacts"."id" = ?')) {
      return world.contacts.filter(c => c.id === where.params[0])
    }
    if (where.sql.includes('"contacts"."org_id" = ?')) {
      return world.contacts.filter(c => c.orgId === where.params[0])
    }
    return []
  }
  if (table === 'scheduled_calls') {
    const needle = String(where.params[0] ?? '').replace(/%/g, '')
    return world.calls.filter(c => c.attendees.includes(needle))
  }
  return []
}

function thenable<T>(value: T) {
  const p = Promise.resolve(value) as Promise<T> & { limit: () => Promise<T> }
  p.limit = () => p
  return p
}

function makeDb() {
  return {
    select: () => ({
      from: (table: AnySQLiteTable) => {
        const name = getTableName(table)
        return {
          where: (cond: SQL) => thenable(answerSelect(name, render(cond))),
        }
      },
    }),
    update: (table: AnySQLiteTable) => ({
      set: (set: Record<string, unknown>) => ({
        where: (cond: SQL) => {
          const name = getTableName(table)
          captured.updates.push({ table: name, set, where: render(cond) })
          captured.order.push(`update:${name}`)
          return Promise.resolve(undefined)
        },
      }),
    }),
    delete: (table: AnySQLiteTable) => ({
      where: (cond: SQL) => {
        const name = getTableName(table)
        captured.deletes.push({ table: name, where: render(cond) })
        captured.order.push(`delete:${name}`)
        return Promise.resolve(undefined)
      },
    }),
    get: (q: SQL) => {
      const r = render(q)
      captured.gets.push(r)
      const table = /from "([a-z_]+)"/.exec(r.sql)?.[1] ?? ''
      return Promise.resolve({ n: world.counts[table] ?? 0 })
    },
    run: (q: SQL) => {
      const r = render(q)
      captured.runs.push(r)
      captured.order.push(`run:${r.sql.split(' ')[0]}`)
      return Promise.resolve(undefined)
    },
  }
}

vi.mock('@/lib/db', () => ({
  db: vi.fn().mockImplementation(() => Promise.resolve(makeDb())),
}))

import { PATCH, DELETE } from '@/app/api/admin/contacts/[id]/route'
import { POST as merge } from '@/app/api/admin/contacts/[id]/merge/route'
import { GET as references } from '@/app/api/admin/contacts/[id]/references/route'
import { requireAccessToOrg } from '@/lib/require-access'
import { requireManagePermissions } from '@/lib/require-permission'

function contact(over: Partial<ContactRow> & { id: string }): ContactRow {
  return {
    orgId: 'org_acme',
    name: 'Jane Smith',
    email: 'jane@acme.com',
    phone: null,
    role: null,
    isPrimary: false,
    portalRole: 'member',
    clerkUserId: null,
    lastLoginAt: null,
    personId: null,
    manyrequestsId: null,
    ...over,
  }
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

function req(method: string, id: string, body?: unknown, suffix = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/contacts/${id}${suffix}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return await res.json() as Record<string, unknown>
}

/**
 * Every column that can hold a contacts.id, as [table, id column, type column].
 * Hand-written: this is what "every referencing column" means.
 */
const REFERENCING_COLUMNS: Array<[string, string, string | null]> = [
  ['requests', 'submitted_by_id', 'submitted_by_type'],
  ['messages', 'author_id', 'author_type'],
  ['files', 'uploaded_by_id', 'uploaded_by_type'],
  ['tasks', 'assignee_id', 'assignee_type'],
  ['request_steps', 'created_by_id', 'created_by_type'],
  ['request_participants', 'participant_id', 'participant_type'],
  ['conversation_participants', 'participant_id', 'participant_type'],
  ['mentions', 'mentioned_id', 'mentioned_type'],
  ['deal_contacts', 'contact_id', null],
  ['activities', 'contact_id', null],
  ['brand_contacts', 'contact_id', null],
  ['subscriptions', 'billed_contact_id', null],
  ['feature_visibility', 'subject_id', 'subject_type'],
]

/** Junctions where (parent, contact) is unique: the survivor's row wins. */
const UNIQUE_JUNCTIONS = ['request_participants', 'conversation_participants', 'deal_contacts', 'brand_contacts', 'feature_visibility']

function expectRepointed(from: string, to: string) {
  for (const [table, column, type] of REFERENCING_COLUMNS) {
    const expectedSql = type
      ? `update "${table}" set "${column}" = ? where "${column}" = ? and "${type}" = ?`
      : `update "${table}" set "${column}" = ? where "${column}" = ?`
    const hit = captured.runs.find(r => r.sql === expectedSql)
    expect(hit, `${table}.${column} was not re-pointed`).toBeTruthy()
    expect(hit!.params).toEqual(type ? [to, from, 'contact'] : [to, from])
  }
  for (const table of UNIQUE_JUNCTIONS) {
    const collision = captured.runs.find(r => r.sql.startsWith(`delete from "${table}" where`) && r.sql.includes(' in (select '))
    expect(collision, `${table} collisions were not dropped before the re-point`).toBeTruthy()
    expect(collision!.params).toContain(from)
    expect(collision!.params).toContain(to)
    const dropIdx = captured.runs.indexOf(collision!)
    const updateIdx = captured.runs.findIndex(r => r.sql.startsWith(`update "${table}" set`))
    expect(dropIdx).toBeLessThan(updateIdx)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  captured.audits = []
  captured.runs = []
  captured.gets = []
  captured.updates = []
  captured.deletes = []
  captured.order = []
  world.contacts = []
  world.counts = {}
  world.calls = []
  vi.mocked(requireAccessToOrg).mockResolvedValue(null)
  vi.mocked(requireManagePermissions).mockResolvedValue({ denied: null } as never)
})

// ── PATCH ────────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/contacts/[id]', () => {
  it('edits name, phone and role, and records the diff', async () => {
    world.contacts = [contact({ id: 'c_1', role: 'Designer' })]

    const res = await PATCH(req('PATCH', 'c_1', { name: ' Jane Smyth ', phone: '021 555 0100', role: 'Marketing Manager' }), params('c_1'))
    expect(res.status).toBe(200)
    expect((await json(res)).changed).toEqual(['name', 'phone', 'role'])

    expect(captured.updates).toHaveLength(1)
    const [u] = captured.updates
    expect(u.table).toBe('contacts')
    expect(u.set).toMatchObject({ name: 'Jane Smyth', phone: '021 555 0100', role: 'Marketing Manager' })
    expect(u.where.params).toEqual(['c_1'])

    const audit = captured.audits.find(a => a.action === 'contact.updated')
    expect(audit).toBeTruthy()
    expect((audit!.metadata as { changes: Record<string, unknown> }).changes).toMatchObject({
      role: { before: 'Designer', after: 'Marketing Manager' },
    })
  })

  it('refuses a new email on a contact that signs in', async () => {
    world.contacts = [contact({ id: 'c_1', clerkUserId: 'user_jane' })]

    const res = await PATCH(req('PATCH', 'c_1', { email: 'jane.new@acme.com' }), params('c_1'))
    expect(res.status).toBe(409)
    const body = await json(res)
    expect(body.code).toBe('clerk_linked')
    expect(String(body.error)).toContain('signs in')
    expect(captured.updates).toHaveLength(0)
    expect(captured.audits).toHaveLength(0)
  })

  it('treats the same address in a different case as no change on a linked contact', async () => {
    world.contacts = [contact({ id: 'c_1', clerkUserId: 'user_jane', email: 'jane@acme.com' })]

    const res = await PATCH(req('PATCH', 'c_1', { email: 'Jane@Acme.com' }), params('c_1'))
    expect(res.status).toBe(200)
    expect((await json(res)).changed).toEqual([])
    expect(captured.updates).toHaveLength(0)
  })

  it('changes the email of an unlinked contact, lower-cased', async () => {
    world.contacts = [contact({ id: 'c_1' })]
    const res = await PATCH(req('PATCH', 'c_1', { email: 'Jane.Smith@Acme.com' }), params('c_1'))
    expect(res.status).toBe(200)
    expect(captured.updates[0].set.email).toBe('jane.smith@acme.com')
  })

  it('demotes the current primary when another contact is made primary', async () => {
    world.contacts = [contact({ id: 'c_1', isPrimary: true }), contact({ id: 'c_2', email: 'bob@acme.com', name: 'Bob' })]

    const res = await PATCH(req('PATCH', 'c_2', { isPrimary: true }), params('c_2'))
    expect(res.status).toBe(200)
    expect(captured.updates).toHaveLength(2)
    const [demote, promote] = captured.updates
    expect(demote.set).toMatchObject({ isPrimary: false })
    expect(demote.where.sql).toContain('"contacts"."org_id" = ?')
    expect(demote.where.sql).toContain('"contacts"."id" <> ?')
    expect(demote.where.params).toEqual(['org_acme', 'c_2'])
    expect(promote.set).toMatchObject({ isPrimary: true })
    expect(promote.where.params).toEqual(['c_2'])
  })

  it('takes the permissions gate for a portal role change and writes the permission audit row', async () => {
    world.contacts = [contact({ id: 'c_1' })]

    const res = await PATCH(req('PATCH', 'c_1', { portalRole: 'admin' }), params('c_1'))
    expect(res.status).toBe(200)
    expect(requireManagePermissions).toHaveBeenCalledTimes(1)
    expect(captured.updates[0].set).toMatchObject({ portalRole: 'admin' })
    expect(captured.audits.map(a => a.action)).toEqual(['contact.updated', 'permission.portal_role_changed'])
  })

  it('refuses a portal role change the caller may not make', async () => {
    world.contacts = [contact({ id: 'c_1' })]
    vi.mocked(requireManagePermissions).mockResolvedValue({
      denied: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    } as never)

    const res = await PATCH(req('PATCH', 'c_1', { portalRole: 'admin' }), params('c_1'))
    expect(res.status).toBe(403)
    expect(captured.updates).toHaveLength(0)
  })

  it('rejects an unknown portal role and an empty name', async () => {
    world.contacts = [contact({ id: 'c_1' })]
    expect((await PATCH(req('PATCH', 'c_1', { portalRole: 'owner' }), params('c_1'))).status).toBe(400)
    expect((await PATCH(req('PATCH', 'c_1', { name: '   ' }), params('c_1'))).status).toBe(400)
    expect((await PATCH(req('PATCH', 'c_1', { email: 'not-an-email' }), params('c_1'))).status).toBe(400)
  })

  it('is scoped to the clients the caller can see', async () => {
    world.contacts = [contact({ id: 'c_1' })]
    vi.mocked(requireAccessToOrg).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const res = await PATCH(req('PATCH', 'c_1', { name: 'Someone Else' }), params('c_1'))
    expect(res.status).toBe(403)
    expect(requireAccessToOrg).toHaveBeenCalledWith(expect.anything(), 'user_admin', 'org_acme')
    expect(captured.updates).toHaveLength(0)
  })

  it('404s an unknown contact', async () => {
    expect((await PATCH(req('PATCH', 'c_missing', { name: 'X' }), params('c_missing'))).status).toBe(404)
  })
})

// ── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/admin/contacts/[id]', () => {
  it('refuses a contact that signs in', async () => {
    world.contacts = [contact({ id: 'c_1', clerkUserId: 'user_jane' })]

    const res = await DELETE(req('DELETE', 'c_1'), params('c_1'))
    expect(res.status).toBe(409)
    expect((await json(res)).code).toBe('clerk_linked')
    expect(captured.deletes).toHaveLength(0)
    expect(captured.runs).toHaveLength(0)
  })

  it('refuses the only primary at an organisation that still has people', async () => {
    world.contacts = [
      contact({ id: 'c_1', isPrimary: true }),
      contact({ id: 'c_2', name: 'Bob', email: 'bob@acme.com' }),
    ]

    const res = await DELETE(req('DELETE', 'c_1'), params('c_1'))
    expect(res.status).toBe(409)
    const body = await json(res)
    expect(body.code).toBe('only_primary')
    expect(String(body.error)).toContain('make someone else primary first')
    expect(captured.deletes).toHaveLength(0)
  })

  it('lets a lone primary go: nobody is left without an address', async () => {
    world.contacts = [contact({ id: 'c_1', isPrimary: true })]

    const res = await DELETE(req('DELETE', 'c_1'), params('c_1'))
    expect(res.status).toBe(200)
    expect(captured.deletes).toEqual([
      { table: 'contacts', where: { sql: '"contacts"."id" = ?', params: ['c_1'] } },
    ])
  })

  it('refuses a referenced contact and names every reference', async () => {
    world.contacts = [contact({ id: 'c_1' }), contact({ id: 'c_2', name: 'Bob', email: 'bob@acme.com' })]
    world.counts = { requests: 3, messages: 2, scheduled_calls: 1 }

    const res = await DELETE(req('DELETE', 'c_1'), params('c_1'))
    expect(res.status).toBe(409)
    const body = await json(res)
    expect(body.code).toBe('referenced')
    expect(String(body.error)).toContain('3 requests, 2 messages, 1 call')
    expect(body.total).toBe(6)
    expect(captured.deletes).toHaveLength(0)
    expect(captured.runs).toHaveLength(0)
  })

  it('counts every referencing column, with the contact discriminator where the column is polymorphic', async () => {
    world.contacts = [contact({ id: 'c_1' })]

    await DELETE(req('DELETE', 'c_1'), params('c_1'))
    for (const [table, column, type] of REFERENCING_COLUMNS) {
      const expected = type
        ? `select count(*) as n from "${table}" where "${column}" = ? and "${type}" = ?`
        : `select count(*) as n from "${table}" where "${column}" = ?`
      const hit = captured.gets.find(g => g.sql === expected)
      expect(hit, `${table}.${column} was not counted`).toBeTruthy()
      expect(hit!.params).toEqual(type ? ['c_1', 'contact'] : ['c_1'])
    }
    expect(captured.gets.some(g => g.sql === 'select count(*) as n from "scheduled_calls" where "attendees" like ?')).toBe(true)
  })

  it('re-points every reference to reassignTo, moves the primary flag, deletes the row last, and audits what moved', async () => {
    world.contacts = [
      contact({ id: 'c_1', isPrimary: true }),
      contact({ id: 'c_2', name: 'Bob', email: 'bob@acme.com' }),
    ]
    world.counts = Object.fromEntries(REFERENCING_COLUMNS.map(([table]) => [table, 1]))
    world.counts.scheduled_calls = 1
    world.calls = [{ id: 'call_1', attendees: JSON.stringify([{ id: 'c_1', type: 'contact', name: 'Jane', email: 'jane@acme.com' }, { id: 'tm_1', type: 'team_member' }]) }]

    const res = await DELETE(req('DELETE', 'c_1', { reassignTo: 'c_2' }), params('c_1'))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.reassignedTo).toBe('c_2')

    expectRepointed('c_1', 'c_2')

    // The call's attendee list is rewritten, the team member untouched.
    const call = captured.updates.find(u => u.table === 'scheduled_calls')
    expect(call).toBeTruthy()
    expect(JSON.parse(call!.set.attendees as string)).toEqual([
      { id: 'c_2', type: 'contact', name: 'Jane', email: 'jane@acme.com' },
      { id: 'tm_1', type: 'team_member' },
    ])

    const promote = captured.updates.find(u => u.table === 'contacts')
    expect(promote!.set).toMatchObject({ isPrimary: true })
    expect(promote!.where.params).toEqual(['c_2'])

    expect(captured.deletes).toEqual([
      { table: 'contacts', where: { sql: '"contacts"."id" = ?', params: ['c_1'] } },
    ])
    expect(captured.order[captured.order.length - 1]).toBe('delete:contacts')

    const audit = captured.audits.find(a => a.action === 'contact.deleted')
    expect(audit).toBeTruthy()
    const meta = audit!.metadata as { reassignedTo: { id: string }; moved: Record<string, number>; primaryMovedTo: string }
    expect(meta.reassignedTo.id).toBe('c_2')
    expect(meta.primaryMovedTo).toBe('c_2')
    expect(Object.keys(meta.moved)).toHaveLength(REFERENCING_COLUMNS.length + 1)
  })

  it('refuses a reassignTo that is not another contact at the same organisation', async () => {
    world.contacts = [
      contact({ id: 'c_1' }),
      contact({ id: 'c_other', orgId: 'org_other', name: 'Zed', email: 'zed@other.com' }),
    ]
    world.counts = { requests: 1 }

    const res = await DELETE(req('DELETE', 'c_1', { reassignTo: 'c_other' }), params('c_1'))
    expect(res.status).toBe(400)
    expect(captured.runs).toHaveLength(0)
    expect(captured.deletes).toHaveLength(0)

    expect((await DELETE(req('DELETE', 'c_1', { reassignTo: 'c_1' }), params('c_1'))).status).toBe(400)
  })

  it('is scoped to the clients the caller can see', async () => {
    world.contacts = [contact({ id: 'c_1' })]
    vi.mocked(requireAccessToOrg).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await DELETE(req('DELETE', 'c_1'), params('c_1'))).status).toBe(403)
    expect(captured.deletes).toHaveLength(0)
  })
})

// ── MERGE ────────────────────────────────────────────────────────────────────

describe('POST /api/admin/contacts/[id]/merge', () => {
  it('re-points every referencing column, fills the survivor, keeps primary, deletes the duplicate last', async () => {
    world.contacts = [
      contact({ id: 'c_dup', name: 'Jane Smith', email: 'Jane@Acme.com', phone: '021 555 0100', role: 'Designer', isPrimary: true, manyrequestsId: 'mr_9' }),
      contact({ id: 'c_keep', name: 'Jane Smith', email: 'jane@acme.com', role: 'Head of Design' }),
    ]
    world.counts = Object.fromEntries(REFERENCING_COLUMNS.map(([table]) => [table, 2]))
    world.counts.scheduled_calls = 1
    world.calls = [{ id: 'call_1', attendees: JSON.stringify([{ id: 'c_dup', type: 'contact', name: 'Jane', email: 'jane@acme.com' }]) }]

    const res = await merge(req('POST', 'c_dup', { into: 'c_keep' }, '/merge'), params('c_dup'))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.into).toBe('c_keep')
    expect(body.total).toBe(REFERENCING_COLUMNS.length * 2 + 1)

    expectRepointed('c_dup', 'c_keep')

    const call = captured.updates.find(u => u.table === 'scheduled_calls')
    expect(JSON.parse(call!.set.attendees as string)[0].id).toBe('c_keep')

    // The unique ManyRequests id leaves the duplicate before it lands on the survivor.
    const contactUpdates = captured.updates.filter(u => u.table === 'contacts')
    expect(contactUpdates).toHaveLength(2)
    expect(contactUpdates[0].set).toMatchObject({ manyrequestsId: null })
    expect(contactUpdates[0].where.params).toEqual(['c_dup'])
    // The survivor keeps its own role and fills only the blanks; primary carries over.
    expect(contactUpdates[1].where.params).toEqual(['c_keep'])
    expect(contactUpdates[1].set).toMatchObject({ phone: '021 555 0100', manyrequestsId: 'mr_9', isPrimary: true })
    expect(contactUpdates[1].set).not.toHaveProperty('role')
    expect(contactUpdates[1].set).not.toHaveProperty('email')

    expect(captured.deletes).toEqual([
      { table: 'contacts', where: { sql: '"contacts"."id" = ?', params: ['c_dup'] } },
    ])
    expect(captured.order[captured.order.length - 1]).toBe('delete:contacts')

    const audit = captured.audits.find(a => a.action === 'contact.merged')
    expect(audit).toBeTruthy()
    expect(audit!.entityId).toBe('c_keep')
    const meta = audit!.metadata as { from: { id: string }; into: { id: string }; moved: Record<string, number>; filled: string[] }
    expect(meta.from.id).toBe('c_dup')
    expect(meta.into.id).toBe('c_keep')
    expect(meta.moved.requests).toBe(2)
    expect(meta.filled).toEqual(expect.arrayContaining(['phone', 'manyrequestsId', 'isPrimary']))
  })

  it('hands a lone login to a survivor that has none', async () => {
    world.contacts = [
      contact({ id: 'c_dup', clerkUserId: 'user_jane', lastLoginAt: '2026-09-01T00:00:00Z' }),
      contact({ id: 'c_keep' }),
    ]

    const res = await merge(req('POST', 'c_dup', { into: 'c_keep' }, '/merge'), params('c_dup'))
    expect(res.status).toBe(200)
    const survivor = captured.updates.find(u => u.table === 'contacts' && u.where.params[0] === 'c_keep')
    expect(survivor!.set).toMatchObject({ clerkUserId: 'user_jane', lastLoginAt: '2026-09-01T00:00:00Z' })
  })

  it('refuses two rows that sign in as different people', async () => {
    world.contacts = [
      contact({ id: 'c_dup', clerkUserId: 'user_a' }),
      contact({ id: 'c_keep', clerkUserId: 'user_b' }),
    ]

    const res = await merge(req('POST', 'c_dup', { into: 'c_keep' }, '/merge'), params('c_dup'))
    expect(res.status).toBe(409)
    expect((await json(res)).code).toBe('both_linked')
    expect(captured.runs).toHaveLength(0)
    expect(captured.deletes).toHaveLength(0)
  })

  it('refuses a merge across organisations', async () => {
    world.contacts = [
      contact({ id: 'c_dup' }),
      contact({ id: 'c_keep', orgId: 'org_other' }),
    ]
    world.counts = { requests: 1 }

    const res = await merge(req('POST', 'c_dup', { into: 'c_keep' }, '/merge'), params('c_dup'))
    expect(res.status).toBe(400)
    expect((await json(res)).code).toBe('different_org')
    expect(captured.runs).toHaveLength(0)
    expect(captured.updates).toHaveLength(0)
    expect(captured.deletes).toHaveLength(0)
  })

  it('refuses a merge into itself and a missing survivor', async () => {
    world.contacts = [contact({ id: 'c_dup' })]
    expect((await merge(req('POST', 'c_dup', { into: 'c_dup' }, '/merge'), params('c_dup'))).status).toBe(400)
    expect((await merge(req('POST', 'c_dup', {}, '/merge'), params('c_dup'))).status).toBe(400)
    expect((await merge(req('POST', 'c_dup', { into: 'c_ghost' }, '/merge'), params('c_dup'))).status).toBe(404)
    expect(captured.deletes).toHaveLength(0)
  })

  it('is scoped to the clients the caller can see', async () => {
    world.contacts = [contact({ id: 'c_dup' }), contact({ id: 'c_keep' })]
    vi.mocked(requireAccessToOrg).mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    expect((await merge(req('POST', 'c_dup', { into: 'c_keep' }, '/merge'), params('c_dup'))).status).toBe(403)
    expect(captured.deletes).toHaveLength(0)
  })
})

// ── REFERENCES ───────────────────────────────────────────────────────────────

describe('GET /api/admin/contacts/[id]/references', () => {
  it('names the references, the blockers and the reassign candidates in one read', async () => {
    world.contacts = [
      contact({ id: 'c_1', isPrimary: true }),
      contact({ id: 'c_2', name: 'Bob', email: 'bob@acme.com', clerkUserId: 'user_bob' }),
      contact({ id: 'c_other', orgId: 'org_other', email: 'zed@other.com' }),
    ]
    world.counts = { requests: 3, messages: 2 }

    const res = await references(req('GET', 'c_1', undefined, '/references'), params('c_1'))
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(body.summary).toBe('3 requests, 2 messages')
    expect(body.total).toBe(5)
    expect(body.blockers).toEqual({ clerkLinked: false, onlyPrimary: true })
    expect(body.candidates).toEqual([
      { id: 'c_2', name: 'Bob', email: 'bob@acme.com', isPrimary: false, clerkLinked: true },
    ])
  })
})
