/**
 * GET /api/admin/overview/replies-waiting - the owner / teammate "client
 * replies" feed.
 *
 * Three things this route got wrong. Its request branch matched on
 * `messages.conversation_id IS NULL`, and the admin composer stamps a
 * conversation id on every studio reply while the portal sets none, so the
 * studio's answer could never win the per-request "last message" race and an
 * answered thread stayed listed for sixty days. It handed conversation rows a
 * `to` of `/messages/{id}`, which is a hard 404 while the standalone Messages
 * page is hidden. And one shared 12 row cap ran across both kinds, so a run of
 * newer conversation rows could spend the whole budget and leave the card
 * empty while request replies were in fact waiting.
 *
 * The db mock is a queue: the route issues its reads in a fixed order, so each
 * test scripts that sequence and the assertions are about what the route does
 * with the rows, not about re-implementing drizzle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface ReplyThread {
  id: string
  kind: 'conversation' | 'request'
  threadTitle: string
  clientName: string | null
  lastSnippet: string
  ago: string
  at: string
  to: string
}

type Row = Record<string, unknown>

const queue: Row[][] = []

vi.mock('@/lib/server-auth', () => ({
  getRequestAuth: async () => ({ orgId: 'tahi-org', userId: 'user_1' }),
  isTahiAdmin: () => true,
}))

vi.mock('@/db/d1', () => ({
  schema: new Proxy({}, {
    get: (_t, table: string) => new Proxy({}, { get: (_x, col: string) => `${table}.${col}` }),
  }),
}))

vi.mock('drizzle-orm', () => ({
  eq: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
  inArray: () => ({}),
  gte: () => ({}),
  desc: () => ({}),
}))

/** One chainable, awaitable builder that answers with the next queued rows. */
function builder(): Record<string, unknown> {
  const b: Record<string, unknown> = {}
  for (const key of ['from', 'where', 'innerJoin', 'leftJoin', 'orderBy', 'limit']) {
    b[key] = () => b
  }
  b.then = (resolve: (rows: Row[]) => void) => resolve(queue.shift() ?? [])
  return b
}

vi.mock('@/lib/db', () => ({
  db: async () => ({ select: () => builder() }),
}))

const { GET } = await import('../admin/overview/replies-waiting/route')

const NOW = Date.now()
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()

function req(): Request {
  return new Request('http://localhost/api/admin/overview/replies-waiting?scope=me')
}

async function threads(): Promise<ReplyThread[]> {
  const res = await GET(req() as never)
  const body = await res.json() as { threads: ReplyThread[] }
  return body.threads
}

/**
 * Script the six reads the route makes, in order: the caller's team member
 * row, the requests they are assigned, the requests they participate on, the
 * messages on those requests, the conversations they participate in, and the
 * messages in those conversations.
 */
function script(opts: {
  requestIds?: string[]
  requestMessages?: Row[]
  conversationIds?: string[]
  conversationMessages?: Row[]
}) {
  queue.length = 0
  queue.push([{ id: 'tm1' }])
  queue.push((opts.requestIds ?? []).map(id => ({ id })))
  queue.push([])
  if ((opts.requestIds ?? []).length > 0) queue.push(opts.requestMessages ?? [])
  queue.push((opts.conversationIds ?? []).map(id => ({ conversationId: id })))
  if ((opts.conversationIds ?? []).length > 0) queue.push(opts.conversationMessages ?? [])
}

describe('GET /api/admin/overview/replies-waiting', () => {
  beforeEach(() => { queue.length = 0 })

  it('lists a request whose last message came from the client', async () => {
    script({
      requestIds: ['r1'],
      requestMessages: [
        { requestId: 'r1', body: 'Any update?', authorType: 'contact', createdAt: at(30), reqTitle: 'New hero', orgName: 'Acme' },
      ],
    })
    const rows = await threads()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'r1', kind: 'request', to: '/requests/r1', clientName: 'Acme' })
  })

  it('drops a thread the studio has already answered, conversation id or not', async () => {
    // The studio reply is the newest row AND carries a conversation id. Under
    // the old `conversation_id IS NULL` filter it was invisible here, so the
    // client's older message stayed on the card as "waiting".
    script({
      requestIds: ['r1'],
      requestMessages: [
        { requestId: 'r1', body: 'On it', authorType: 'team_member', createdAt: at(5), reqTitle: 'New hero', orgName: 'Acme' },
        { requestId: 'r1', body: 'Any update?', authorType: 'contact', createdAt: at(30), reqTitle: 'New hero', orgName: 'Acme' },
      ],
    })
    expect(await threads()).toEqual([])
  })

  it('never hands out a /messages link', async () => {
    script({
      requestIds: ['r1'],
      requestMessages: [
        { requestId: 'r1', body: 'hi', authorType: 'contact', createdAt: at(10), reqTitle: 'A', orgName: 'Acme' },
      ],
      conversationIds: ['c1', 'c2'],
      conversationMessages: [
        // Attached to a request nobody else listed: opens on that request.
        { conversationId: 'c1', convRequestId: 'r9', reqTitle: 'Other work', body: 'ping', authorType: 'contact', createdAt: at(8), convName: 'Acme channel', orgName: 'Acme' },
        // Attached to nothing: no page to open while Messages is hidden.
        { conversationId: 'c2', convRequestId: null, reqTitle: null, body: 'hello', authorType: 'contact', createdAt: at(6), convName: 'Acme channel', orgName: 'Acme' },
      ],
    })
    const rows = await threads()
    expect(rows.every(t => t.to.startsWith('/requests/'))).toBe(true)
    expect(rows.map(t => t.id)).toEqual(['r9', 'r1'])
  })

  it('counts a request reached through both branches once', async () => {
    script({
      requestIds: ['r1'],
      requestMessages: [
        { requestId: 'r1', body: 'hi', authorType: 'contact', createdAt: at(10), reqTitle: 'A', orgName: 'Acme' },
      ],
      conversationIds: ['c1'],
      conversationMessages: [
        { conversationId: 'c1', convRequestId: 'r1', reqTitle: 'A', body: 'hi', authorType: 'contact', createdAt: at(10), convName: 'A', orgName: 'Acme' },
      ],
    })
    const rows = await threads()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('r1')
  })

  it('caps each kind on its own so one can never starve the other', async () => {
    const ids = Array.from({ length: 15 }, (_, i) => `r${i}`)
    script({
      requestIds: ids,
      requestMessages: ids.map((id, i) => ({
        requestId: id, body: 'hi', authorType: 'contact', createdAt: at(i + 1), reqTitle: id, orgName: 'Acme',
      })),
    })
    const rows = await threads()
    expect(rows).toHaveLength(12)
    expect(rows[0].id).toBe('r0')
  })

  it('answers an honest empty feed for a caller with no team member row', async () => {
    queue.length = 0
    queue.push([])
    expect(await threads()).toEqual([])
  })
})
