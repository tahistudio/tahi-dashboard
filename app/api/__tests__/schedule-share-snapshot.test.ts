/**
 * POST /api/admin/schedules/[id]/share.
 *
 * Sharing used to mint a token and set status 'shared' without ever writing a
 * publishedSnapshot. Both readers of a shared schedule (the public share link
 * and the client home's "Your project" card) fall back to the LIVE rows when
 * there is no snapshot, so a schedule that was shared and never published
 * served whatever the studio happened to be typing: a renamed phase, a moved
 * launch date, a half-written row. Sharing now publishes a first snapshot, and
 * never overwrites one that already exists, because that would silently
 * publish edits nobody pressed Republish on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>

const queue: Row[][] = []
const updates: Record<string, unknown>[] = []

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/app/api/admin/_sales-access/artifact-scope', () => ({
  requireScheduleAccess: async () => null,
}))

vi.mock('@/db/d1', () => ({
  schema: new Proxy({}, {
    get: (_t, table: string) => new Proxy({}, { get: (_x, col: string) => `${table}.${col}` }),
  }),
}))

vi.mock('drizzle-orm', () => ({ eq: () => ({}), asc: () => ({}) }))

function chain(): Record<string, unknown> {
  const b: Record<string, unknown> = {}
  for (const key of ['from', 'where', 'orderBy', 'limit']) b[key] = () => b
  b.then = (resolve: (rows: Row[]) => void) => resolve(queue.shift() ?? [])
  return b
}

vi.mock('@/lib/db', () => ({
  db: async () => ({
    select: () => chain(),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => { updates.push(values) },
      }),
    }),
  }),
}))

const { POST } = await import('../admin/schedules/[id]/share/route')

const params = { params: Promise.resolve({ id: 's1' }) }
const post = (url = 'http://localhost/api/admin/schedules/s1/share') =>
  new Request(url, { method: 'POST' })

/** The reads the route makes: the schedule row, then (only when it has no
 *  snapshot) the cover, the sections and the rows. */
function script(existing: Row, cover?: Row, sections: Row[] = [], rows: Row[] = []) {
  queue.length = 0
  queue.push([existing])
  if (cover) {
    queue.push([cover])
    queue.push(sections)
    queue.push(rows)
  }
}

describe('POST /api/admin/schedules/[id]/share', () => {
  beforeEach(() => { queue.length = 0; updates.length = 0 })

  it('publishes a first snapshot so a shared schedule cannot serve a draft', async () => {
    script(
      { token: null, publishedSnapshot: null },
      { title: 'Website build', targetLaunchDate: '2027-01-10' },
      [{ id: 'sec1', title: 'Discovery', position: 0 }],
      [{ id: 'row1', label: 'Kickoff', position: 0 }],
    )
    const res = await POST(post() as never, params)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ status: 'shared', published: true })

    expect(updates).toHaveLength(1)
    expect(updates[0].publicShareToken).toBeTypeOf('string')
    expect(updates[0].publishedAt).toBeTypeOf('string')
    const snapshot = JSON.parse(updates[0].publishedSnapshot as string) as {
      schedule: Row; sections: Row[]; rows: Row[]
    }
    expect(snapshot.schedule.title).toBe('Website build')
    expect(snapshot.sections).toHaveLength(1)
    expect(snapshot.rows).toHaveLength(1)
  })

  it('never clobbers a published state on a re-share', async () => {
    script({ token: 'tok', publishedSnapshot: '{"schedule":{"title":"As published"}}' })
    const res = await POST(post() as never, params)
    await expect(res.json()).resolves.toMatchObject({ token: 'tok', published: false })
    expect(updates[0]).not.toHaveProperty('publishedSnapshot')
    expect(updates[0].status).toBe('shared')
  })

  it('keeps the published state when the token is rotated', async () => {
    script({ token: 'old', publishedSnapshot: '{"schedule":{"title":"As published"}}' })
    await POST(post('http://localhost/api/admin/schedules/s1/share?rotate=1') as never, params)
    expect(updates[0].publicShareToken).not.toBe('old')
    expect(updates[0]).not.toHaveProperty('publishedSnapshot')
  })

  it('404s an unknown schedule without writing anything', async () => {
    queue.length = 0
    queue.push([])
    const res = await POST(post() as never, params)
    expect(res.status).toBe(404)
    expect(updates).toHaveLength(0)
  })
})
