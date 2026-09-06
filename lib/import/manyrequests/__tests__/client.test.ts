/**
 * The ManyRequests fetcher.
 *
 * Base URL, auth header and pagination match the worker MCP server's mrFetch
 * exactly, because that is the shape already proven against the live API. The
 * token comes from the environment and is never hardcoded.
 *
 * The last test is the one that matters most: EVERY call this client makes is a
 * GET. The old system stays untouched until Liam has cut over, and a write
 * against it is not recoverable from this side.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createManyRequestsClient,
  manyRequestsBaseUrlFromEnv,
  manyRequestsTokenFromEnv,
  ManyRequestsReadError,
  MANYREQUESTS_DEFAULT_BASE_URL,
} from '../client'

interface Call {
  url: string
  method: string | undefined
  auth: string | undefined
}

function recordingFetch(pages: unknown[]): { calls: Call[]; impl: (input: string, init?: RequestInit) => Promise<Response> } {
  const calls: Call[] = []
  let index = 0
  const impl = (input: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({ url: input, method: init?.method, auth: headers.get('Authorization') ?? undefined })
    const payload = pages[Math.min(index, pages.length - 1)]
    index += 1
    return Promise.resolve(new Response(JSON.stringify(payload), { status: 200 }))
  }
  return { calls, impl }
}

describe('token and base url from the environment', () => {
  const original = { ...process.env }
  afterEach(() => {
    process.env = { ...original }
  })

  it('reads the token from MANYREQUESTS_API_TOKEN and trims it', () => {
    process.env.MANYREQUESTS_API_TOKEN = '  token_123  '
    expect(manyRequestsTokenFromEnv()).toBe('token_123')
  })

  it('returns null when the token is unset or blank, so the caller can answer 400', () => {
    delete process.env.MANYREQUESTS_API_TOKEN
    expect(manyRequestsTokenFromEnv()).toBeNull()
    process.env.MANYREQUESTS_API_TOKEN = '   '
    expect(manyRequestsTokenFromEnv()).toBeNull()
  })

  it('falls back to the same base url the worker MCP tools use', () => {
    delete process.env.MANYREQUESTS_BASE_URL
    expect(manyRequestsBaseUrlFromEnv()).toBe(MANYREQUESTS_DEFAULT_BASE_URL)
    expect(MANYREQUESTS_DEFAULT_BASE_URL).toBe('https://tahistudio.manyrequests.com/api/v1')
  })

  it('refuses to build a client with no token', () => {
    expect(() => createManyRequestsClient({ token: '' })).toThrow(/MANYREQUESTS_API_TOKEN/)
  })
})

describe('reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the bearer token and asks for json', async () => {
    const { calls, impl } = recordingFetch([{ data: [], has_more: false }])
    const client = createManyRequestsClient({ token: 'token_123', fetchImpl: impl })
    await client.listOrganizations()
    expect(calls[0].auth).toBe('Bearer token_123')
    expect(calls[0].url).toContain('/organizations')
    expect(calls[0].url).toContain('per_page=100')
  })

  it('walks pages until has_more is false', async () => {
    const page = (n: number, hasMore: boolean) => ({
      data: Array.from({ length: hasMore ? 100 : 3 }, (_unused, i) => ({ id: n * 100 + i })),
      has_more: hasMore,
    })
    const { calls, impl } = recordingFetch([page(0, true), page(1, true), page(2, false)])
    const client = createManyRequestsClient({ token: 't', fetchImpl: impl })
    const rows = await client.listOrganizations()
    expect(calls).toHaveLength(3)
    expect(rows).toHaveLength(203)
  })

  it('stops on a short page even when the envelope forgets has_more', async () => {
    const { impl, calls } = recordingFetch([{ data: [{ id: 1 }, { id: 2 }] }])
    const client = createManyRequestsClient({ token: 't', fetchImpl: impl })
    const rows = await client.listOrganizations()
    expect(rows).toHaveLength(2)
    expect(calls).toHaveLength(1)
  })

  it('handles a bare array response', async () => {
    const { impl } = recordingFetch([[{ id: 1 }]])
    const client = createManyRequestsClient({ token: 't', fetchImpl: impl })
    expect(await client.listServices()).toHaveLength(1)
  })

  it('cannot loop forever if a page keeps claiming has_more', async () => {
    const full = { data: Array.from({ length: 100 }, (_unused, i) => ({ id: i })), has_more: true }
    const { calls, impl } = recordingFetch([full])
    const client = createManyRequestsClient({ token: 't', fetchImpl: impl, maxPages: 4 })
    await client.listOrganizations()
    expect(calls).toHaveLength(4)
  })

  it('throws a typed error carrying the status and the path', async () => {
    const impl = () => Promise.resolve(new Response('nope', { status: 404 }))
    const client = createManyRequestsClient({ token: 't', fetchImpl: impl })
    await expect(client.listRequests()).rejects.toBeInstanceOf(ManyRequestsReadError)
    await expect(client.listRequests()).rejects.toThrow(/404/)
  })

  it('asks for the fields, comments and hours a request needs to be field complete', async () => {
    const { calls, impl } = recordingFetch([{ id: 347 }])
    const client = createManyRequestsClient({ token: 't', fetchImpl: impl })
    await client.getRequest('347')
    expect(calls[0].url).toContain('/requests/347')
    expect(decodeURIComponent(calls[0].url)).toContain('include=fields,comments,hours')
  })

  it('encodes an id that would otherwise break the path', async () => {
    const { calls, impl } = recordingFetch([{ number: 'INV/1' }])
    const client = createManyRequestsClient({ token: 't', fetchImpl: impl })
    await client.getInvoice('INV/1')
    expect(calls[0].url).toContain('/invoices/INV%2F1')
  })

  it('makes GET requests and nothing else, on every method it exposes', async () => {
    const { calls, impl } = recordingFetch([{ data: [], has_more: false }])
    const client = createManyRequestsClient({ token: 't', fetchImpl: impl })
    await client.listOrganizations()
    await client.listOrgMembers('3')
    await client.listOrgBrands('3')
    await client.listOrgServices('3')
    await client.listClients()
    await client.listServices()
    await client.listInvoices()
    await client.listRequests()
    await client.getRequest('1')
    await client.getInvoice('INV-1')
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.method).toBe('GET')
    }
  })
})
