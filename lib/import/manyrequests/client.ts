/**
 * lib/import/manyrequests/client.ts
 *
 * The read side of the importer: a small, injectable fetcher over the
 * ManyRequests REST API (v1).
 *
 * Base URL, auth and endpoint paths are the same ones the worker MCP server's
 * manyrequests_* tools use (workers/mcp-server/src/index.ts, mrFetch): base
 * https://tahistudio.manyrequests.com/api/v1, `Authorization: Bearer <token>`,
 * `page` + `per_page` pagination. The token is a live credential and is NEVER
 * hardcoded here: it comes from MANYREQUESTS_API_TOKEN in the environment, and
 * on the worker it lives only in the secret store
 * (`wrangler secret put MANYREQUESTS_API_TOKEN`).
 *
 * `fetchImpl` is injectable so the whole importer can be exercised against a
 * fake harness with no network. That is the only reason this is a factory
 * rather than a set of free functions.
 *
 * EVERY METHOD HERE IS A READ. There is no POST, PATCH or DELETE in this file
 * and there must never be one: the old system stays untouched until Liam has
 * cut over, and a write against it is not recoverable from this side.
 */

import type {
  MrBrand,
  MrClient,
  MrInvoice,
  MrOrganization,
  MrRequest,
  MrService,
  MrSubscription,
} from './types'

export const MANYREQUESTS_DEFAULT_BASE_URL = 'https://tahistudio.manyrequests.com/api/v1'

export const MANYREQUESTS_TOKEN_MISSING =
  'ManyRequests is not configured. Set MANYREQUESTS_API_TOKEN in the environment (on the worker: wrangler secret put MANYREQUESTS_API_TOKEN).'

/** The token, from the environment only. Returns null when it is not set, so
 *  the caller can answer 400 with a clear message instead of throwing. */
export function manyRequestsTokenFromEnv(): string | null {
  const raw = process.env.MANYREQUESTS_API_TOKEN
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

export function manyRequestsBaseUrlFromEnv(): string {
  const raw = process.env.MANYREQUESTS_BASE_URL
  const trimmed = typeof raw === 'string' ? raw.trim() : ''
  return trimmed.length > 0 ? trimmed : MANYREQUESTS_DEFAULT_BASE_URL
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ManyRequestsClientOptions {
  token: string
  baseUrl?: string
  fetchImpl?: FetchLike
  /** Rows per page. ManyRequests caps this; 100 is what the MCP tools use. */
  perPage?: number
  /** Hard ceiling on pages per list, so a pagination bug cannot loop forever. */
  maxPages?: number
}

/** The list envelope. ManyRequests returns `data` plus `has_more`; some
 *  endpoints answer a bare array. Both are handled. */
interface ListEnvelope<T> {
  data?: T[]
  items?: T[]
  has_more?: boolean
  meta?: { last_page?: number | null; current_page?: number | null } | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPage<T>(payload: unknown): { rows: T[]; hasMore: boolean } {
  if (Array.isArray(payload)) return { rows: payload as T[], hasMore: false }
  if (!isRecord(payload)) return { rows: [], hasMore: false }
  const envelope = payload as ListEnvelope<T>
  const rows = Array.isArray(envelope.data)
    ? envelope.data
    : Array.isArray(envelope.items)
      ? envelope.items
      : []
  let hasMore = envelope.has_more === true
  const meta = envelope.meta
  if (!hasMore && meta && typeof meta.last_page === 'number' && typeof meta.current_page === 'number') {
    hasMore = meta.current_page < meta.last_page
  }
  return { rows, hasMore }
}

export class ManyRequestsReadError extends Error {
  readonly status: number
  readonly path: string
  constructor(path: string, status: number, body: string) {
    super(`ManyRequests GET ${path} returned ${status}: ${body.slice(0, 400)}`)
    this.name = 'ManyRequestsReadError'
    this.status = status
    this.path = path
  }
}

export interface ManyRequestsClient {
  /** Escape hatch for a path this client does not name. Read only. */
  get(path: string, params?: Record<string, string>): Promise<unknown>
  listAll<T>(path: string, params?: Record<string, string>): Promise<T[]>
  listOrganizations(): Promise<MrOrganization[]>
  listOrgMembers(orgId: string): Promise<MrClient[]>
  listOrgBrands(orgId: string): Promise<MrBrand[]>
  listOrgServices(orgId: string): Promise<MrSubscription[]>
  listClients(): Promise<MrClient[]>
  listServices(): Promise<MrService[]>
  listInvoices(): Promise<MrInvoice[]>
  getInvoice(number: string): Promise<MrInvoice>
  listRequests(params?: Record<string, string>): Promise<MrRequest[]>
  getRequest(id: string): Promise<MrRequest>
}

export function createManyRequestsClient(options: ManyRequestsClientOptions): ManyRequestsClient {
  const token = options.token
  if (!token) throw new Error(MANYREQUESTS_TOKEN_MISSING)

  const baseUrl = (options.baseUrl ?? manyRequestsBaseUrlFromEnv()).replace(/\/+$/, '')
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const perPage = options.perPage ?? 100
  const maxPages = options.maxPages ?? 200

  async function get(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`${baseUrl}${path}`)
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
      }
    }
    const res = await doFetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ManyRequestsReadError(path, res.status, body)
    }
    const text = await res.text()
    return text ? (JSON.parse(text) as unknown) : {}
  }

  async function listAll<T>(path: string, params?: Record<string, string>): Promise<T[]> {
    const out: T[] = []
    for (let page = 1; page <= maxPages; page++) {
      const payload = await get(path, { ...(params ?? {}), page: String(page), per_page: String(perPage) })
      const { rows, hasMore } = readPage<T>(payload)
      out.push(...rows)
      // A short page is the end of the list even when the envelope forgets to
      // say so, which is what stops a `has_more`-less endpoint looping to the
      // page cap and re-reading the same rows.
      if (!hasMore || rows.length === 0 || rows.length < perPage) break
    }
    return out
  }

  return {
    get,
    listAll,
    listOrganizations: () => listAll<MrOrganization>('/organizations'),
    listOrgMembers: (orgId: string) => listAll<MrClient>(`/organizations/${encodeURIComponent(orgId)}/members`),
    listOrgBrands: (orgId: string) => listAll<MrBrand>(`/organizations/${encodeURIComponent(orgId)}/brands`),
    listOrgServices: (orgId: string) => listAll<MrSubscription>(`/organizations/${encodeURIComponent(orgId)}/services`),
    listClients: () => listAll<MrClient>('/clients'),
    // /services and /requests are NOT in the worker's wired endpoint set (it
    // reaches requests through the ManyRequests MCP connector instead), so
    // these two paths are the only ones here that have not already been
    // exercised against the live API. The dry run is what proves them: a wrong
    // path answers 404 and the plan reports the read error instead of writing.
    listServices: () => listAll<MrService>('/services'),
    listInvoices: () => listAll<MrInvoice>('/invoices'),
    getInvoice: async (number: string) => (await get(`/invoices/${encodeURIComponent(number)}`)) as MrInvoice,
    listRequests: (params?: Record<string, string>) => listAll<MrRequest>('/requests', params),
    getRequest: async (id: string) =>
      (await get(`/requests/${encodeURIComponent(id)}`, {
        include: 'fields,comments,hours',
      })) as MrRequest,
  }
}
