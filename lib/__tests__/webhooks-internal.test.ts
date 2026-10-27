import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { schema } from '@/db/d1'
import { fireWebhook } from '@/lib/webhooks'

vi.mock('@/lib/db', () => ({ db: vi.fn() }))

type Database = Parameters<typeof fireWebhook>[2]

interface Endpoint {
  id: string
  url: string
  secret: string
  events: string[]
  includeInternal?: boolean
  active?: boolean
  createdAt: string
}

function endpoint(id: string, overrides: Partial<Endpoint> = {}): Endpoint {
  return {
    id,
    url: `https://example.test/${id}`,
    secret: 'whsec_test',
    events: ['*'],
    createdAt: '2026-10-27T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * Minimal Drizzle stand-in. select().from(table) resolves per table:
 * settings -> the endpoint rows, requests -> the configured lookup behaviour.
 */
function fakeDb(
  endpoints: Endpoint[],
  requestLookup: 'internal' | 'public' | 'missing' | 'throw',
) {
  const requestSelects = vi.fn()
  const database = {
    select: () => ({
      from: (table: unknown) => {
        if (table === schema.settings) {
          return {
            where: () =>
              Promise.resolve(
                endpoints.map(e => ({ key: `webhook_endpoint_${e.id}`, value: JSON.stringify(e) })),
              ),
          }
        }
        if (table === schema.requests) {
          requestSelects()
          return {
            where: () => ({
              limit: () => {
                if (requestLookup === 'throw') return Promise.reject(new Error('d1 down'))
                if (requestLookup === 'missing') return Promise.resolve([])
                return Promise.resolve([{ isInternal: requestLookup === 'internal' }])
              },
            }),
          }
        }
        return { where: () => Promise.resolve([]) }
      },
    }),
    insert: () => ({ values: () => Promise.resolve() }),
  }
  return { database: database as unknown as Database, requestSelects }
}

describe('fireWebhook internal request gating', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function sentBodies(): Array<{ event: string; data: Record<string, unknown> }> {
    return fetchMock.mock.calls.map(call => JSON.parse((call[1] as { body: string }).body))
  }

  it('sends nothing to a paused endpoint and still delivers to active ones', async () => {
    const { database } = fakeDb([endpoint('a', { active: false }), endpoint('b')], 'public')
    await fireWebhook('invoice_paid', { entityId: 'i1' }, database)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/b')
  })

  it('does not send an internal request_created to a default endpoint', async () => {
    const { database } = fakeDb([endpoint('a')], 'internal')
    await fireWebhook('request_created', { entityId: 'r1' }, database)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends an internal request_created with isInternal true to an opted-in endpoint only', async () => {
    const { database } = fakeDb(
      [endpoint('a'), endpoint('b', { includeInternal: true })],
      'internal',
    )
    await fireWebhook('request_created', { entityId: 'r1' }, database)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/b')
    expect(sentBodies()[0].data.isInternal).toBe(true)
  })

  it('sends a non-internal request event with isInternal false to every matching endpoint', async () => {
    const { database } = fakeDb(
      [endpoint('a'), endpoint('b', { includeInternal: true })],
      'public',
    )
    await fireWebhook('request_status_changed', { entityId: 'r2' }, database)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const body of sentBodies()) expect(body.data.isInternal).toBe(false)
  })

  it('trusts a payload that says internal, but checks the row when the payload says not internal', async () => {
    const trusted = fakeDb([endpoint('a')], 'public')
    await fireWebhook('request_created', { entityId: 'r3', isInternal: true }, trusted.database)
    expect(trusted.requestSelects).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    // A stale "not internal" from the caller must not leak an internal request.
    const stale = fakeDb([endpoint('a')], 'internal')
    await fireWebhook('request_created', { entityId: 'r3', isInternal: false }, stale.database)
    expect(stale.requestSelects).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('matches subscriptions saved with dots against the emitted underscore names', async () => {
    const { database } = fakeDb([endpoint('a', { events: ['invoice.paid'] })], 'public')
    await fireWebhook('invoice_paid', { entityId: 'i2' }, database)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the lookup throws, finds no row, or has no entity id', async () => {
    const thrown = fakeDb([endpoint('a')], 'throw')
    await fireWebhook('request_created', { entityId: 'r4' }, thrown.database)
    const missing = fakeDb([endpoint('a')], 'missing')
    await fireWebhook('request_created', { entityId: 'r5' }, missing.database)
    const noId = fakeDb([endpoint('a')], 'public')
    await fireWebhook('request_created', {}, noId.database)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leaves non-request events unchanged and does not look up requests', async () => {
    const { database, requestSelects } = fakeDb([endpoint('a')], 'internal')
    await fireWebhook('invoice_paid', { entityId: 'i1' }, database)
    expect(requestSelects).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sentBodies()[0].data).not.toHaveProperty('isInternal')
  })

  it('does no request lookup when no endpoint matches the event', async () => {
    const { database, requestSelects } = fakeDb(
      [endpoint('a', { events: ['invoice_paid'] })],
      'internal',
    )
    await fireWebhook('request_created', { entityId: 'r6' }, database)
    expect(requestSelects).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does no request lookup when there are no endpoints at all', async () => {
    const { database, requestSelects } = fakeDb([], 'internal')
    await fireWebhook('request_created', { entityId: 'r7' }, database)
    expect(requestSelects).not.toHaveBeenCalled()
  })
})
