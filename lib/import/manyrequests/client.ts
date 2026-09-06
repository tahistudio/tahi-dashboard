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
 *
 * Lists and single resources unwrap DIFFERENTLY and both have to be handled.
 * readPage takes `{data: [...]}` off a list; getOne takes `{data: {...}}` off a
 * detail read and then proves the row is the one that was asked for. Skipping
 * the second was the quietest failure available here: `{...summary, ...detail}`
 * in run.ts would merge a stray `data` key, every brief, comment, assignee and
 * line item would disappear, and the run would still report a full count of
 * inserts with no warning at all. A mismatch now throws, which run.ts turns
 * into a warning and a fall back to the list summary.
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

/**
 * A single-resource read, unwrapped.
 *
 * The list endpoints are envelope-wrapped (`{data: [...]}`), and an API whose
 * lists are data-wrapped almost always wraps its single resources the same way.
 * Casting `{data: {...}}` straight to MrRequest was the quiet failure mode:
 * `{...summary, ...detail}` in run.ts would then produce the list row plus a
 * stray `data` key, and every brief, comment, assignee and line item would
 * vanish while the run still reported a full count of inserts.
 */
export function unwrapSingle(payload: unknown): unknown {
  if (!isRecord(payload)) return payload
  const inner = payload.data
  if (isRecord(inner)) return inner
  return payload
}

/**
 * Prove the payload is the row that was asked for.
 *
 * A detail read that comes back as something else (an envelope shape this
 * client does not know, an error body served with a 200) must be LOUD. It is
 * thrown, because run.ts guards every detail read: the throw becomes a warning
 * on the result and the row falls back to its list summary, which is the
 * difference between "no comments" and "the envelope was not unwrapped".
 */
export function assertIdentity(
  payload: unknown,
  path: string,
  field: 'id' | 'number',
  expected: string,
): void {
  if (!isRecord(payload)) {
    throw new ManyRequestsShapeError(path, `expected an object, got ${Array.isArray(payload) ? 'an array' : typeof payload}`)
  }
  const actual = payload[field]
  if (actual === undefined || actual === null) {
    throw new ManyRequestsShapeError(
      path,
      `the detail payload carries no "${field}" (keys: ${Object.keys(payload).slice(0, 12).join(', ') || 'none'}). The envelope shape is not what this client expects, so the row would silently lose its brief, comments and assignees.`,
    )
  }
  if (String(actual).trim() !== expected) {
    throw new ManyRequestsShapeError(path, `asked for ${field} ${expected} and got ${String(actual)}`)
  }
}

export class ManyRequestsShapeError extends Error {
  readonly path: string
  constructor(path: string, detail: string) {
    super(`ManyRequests GET ${path} returned an unexpected shape: ${detail}`)
    this.name = 'ManyRequestsShapeError'
    this.path = path
  }
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
  /** A single resource, envelope unwrapped and checked against the id asked
   *  for. Throws rather than returning a row that is not the one requested. */
  getOne(
    path: string,
    identity: { field: 'id' | 'number'; expected: string },
    params?: Record<string, string>,
  ): Promise<unknown>
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

  async function getOne(
    path: string,
    identity: { field: 'id' | 'number'; expected: string },
    params?: Record<string, string>,
  ): Promise<unknown> {
    const payload = unwrapSingle(await get(path, params))
    assertIdentity(payload, path, identity.field, identity.expected)
    return payload
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
    getOne,
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
    // Both detail reads go through getOne, so an envelope this client does not
    // understand fails LOUDLY as a warning on the run rather than quietly
    // returning a row with no brief and no comments.
    getInvoice: async (number: string) =>
      (await getOne(`/invoices/${encodeURIComponent(number)}`, { field: 'number', expected: number })) as MrInvoice,
    listRequests: (params?: Record<string, string>) => listAll<MrRequest>('/requests', params),
    getRequest: async (id: string) =>
      (await getOne(
        `/requests/${encodeURIComponent(id)}`,
        { field: 'id', expected: id },
        { include: 'fields,comments,hours' },
      )) as MrRequest,
  }
}
