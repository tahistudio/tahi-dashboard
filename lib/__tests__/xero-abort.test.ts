import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { callXeroAPIOrThrow } from '@/lib/xero'
import { permissionSqlite } from '@/app/api/__tests__/helpers/permission-sqlite'

type Fixture = ReturnType<typeof permissionSqlite>
let fixture: Fixture | undefined

function seed(cachedToken = true) {
  fixture = permissionSqlite([schema.integrations])
  if (cachedToken) fixture.insert(schema.integrations, {
    id: 'xero', service: 'xero', access_token: 'synthetic-token', refresh_token: null,
    token_expires_at: new Date(Date.now() + 3_600_000).toISOString(), config: null,
  })
  vi.mocked(db).mockResolvedValue(fixture.database as never)
  return fixture
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('XERO_CLIENT_ID', 'synthetic-client')
  vi.stubEnv('XERO_CLIENT_SECRET', 'synthetic-secret')
})

afterEach(() => {
  fixture?.close()
  fixture = undefined
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('Xero caller cancellation, synthetic integration fixtures', () => {
  it('does not acquire tokens or issue a request for an already aborted caller', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    controller.abort(new Error('Deadline exceeded'))

    await expect(callXeroAPIOrThrow('GET', '/Accounts', undefined, { signal: controller.signal }))
      .rejects.toThrow('Deadline exceeded')
    expect(db).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('bounds a stalled token database lookup and never starts an API call after a late lookup', async () => {
    const saved = seed()
    let finish: ((value: Awaited<ReturnType<typeof db>>) => void) | undefined
    vi.mocked(db).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const read = callXeroAPIOrThrow('GET', '/Accounts', undefined, { signal: controller.signal })
    const rejected = expect(read).rejects.toThrow('Deadline exceeded')
    controller.abort(new Error('Deadline exceeded'))
    await rejected

    finish!(saved.database as never)
    await Promise.resolve()
    await Promise.resolve()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['fetch', 'body'] as const)('aborts a stalled token %s without a refresh fallback or stored token', async phase => {
    const saved = seed(false)
    const response = { ok: true, json: vi.fn(() => new Promise(() => undefined)) }
    const fetcher = vi.fn(() => phase === 'fetch' ? new Promise(() => undefined) : Promise.resolve(response))
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const read = callXeroAPIOrThrow('GET', '/Accounts', undefined, { signal: controller.signal })
    const rejected = expect(read).rejects.toThrow('Deadline exceeded')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    if (phase === 'body') await vi.waitFor(() => expect(response.json).toHaveBeenCalledTimes(1))
    controller.abort(new Error('Deadline exceeded'))
    await rejected

    expect(fetcher).toHaveBeenCalledWith('https://identity.xero.com/connect/token', expect.objectContaining({ signal: controller.signal }))
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(saved.rows(schema.integrations)).toHaveLength(0)
  })

  it.each(['fetch', 'json', 'text'] as const)('aborts a stalled API %s, including success and error response bodies', async phase => {
    seed()
    const response = {
      ok: phase !== 'text', status: phase === 'text' ? 503 : 200, statusText: 'Synthetic response',
      json: vi.fn(() => new Promise(() => undefined)), text: vi.fn(() => new Promise(() => undefined)),
    }
    const fetcher = vi.fn(() => phase === 'fetch' ? new Promise(() => undefined) : Promise.resolve(response))
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    const read = callXeroAPIOrThrow('GET', '/Accounts', undefined, { signal: controller.signal })
    const rejected = expect(read).rejects.toThrow('Deadline exceeded')
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    if (phase !== 'fetch') await vi.waitFor(() => expect(response[phase]).toHaveBeenCalledTimes(1))
    controller.abort(new Error('Deadline exceeded'))
    await rejected

    expect(fetcher).toHaveBeenCalledWith('https://api.xero.com/api.xro/2.0/Accounts', expect.objectContaining({ signal: controller.signal }))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keeps the existing unbounded caller contract when no signal is supplied', async () => {
    seed()
    const accounts = { Accounts: [] }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(accounts)))

    expect(await callXeroAPIOrThrow('GET', '/Accounts')).toEqual(accounts)
  })
})
