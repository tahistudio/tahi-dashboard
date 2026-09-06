/**
 * lib/import/manyrequests/snapshot-client.ts
 *
 * The OFFLINE read side of the importer: a ManyRequestsClient over a
 * pre-fetched snapshot instead of a live token.
 *
 * MANYREQUESTS_API_TOKEN lives on the MCP worker, not on the dashboard worker
 * the import route runs in. Rather than copy a live credential onto a second
 * worker for one migration, the snapshot is read out of ManyRequests through
 * the read-only MCP connector, assembled into the eight list keys below and
 * POSTed to the route as body.snapshot. This module turns that payload into
 * the same ManyRequestsClient interface run.ts already consumes, so the
 * planner, the upserter and the mail probe see no difference at all between a
 * live run and a snapshot run.
 *
 * The keys mirror the REST API v1 lists exactly, raw. The MCP connector adds
 * keys of its own (url, notice, members_total, balance.hours.{remaining,
 * purchased, used}); the assembler that builds the payload folds the two that
 * differ into the wire shape (balance.hours, balance.purchased_hours) and
 * derives subscription_status. Nothing here renames a field: a row is handed
 * to the planner as it arrived, and every planner already reads defensively.
 *
 * Validation is deliberately strict at the TOP level and loose inside a row.
 * An unknown top-level key is refused BY NAME, because the most likely one is
 * the whole MCP response pasted in unassembled, and a list that is not an
 * array or a row with no id would otherwise reach the planner as a silent
 * refusal per row rather than one clear 400. Inside a row, extra keys are
 * kept: the planners take what they know and preserve the rest in
 * formResponses._manyrequests.
 *
 * This is a pure module: no D1, no Next, nothing from app/. It is inside the
 * static no-mail guard's walk like every other file in this directory.
 */

import { ManyRequestsReadError, type ManyRequestsClient } from './client'
import type {
  MrBrand,
  MrClient,
  MrInvoice,
  MrOrganization,
  MrRequest,
  MrService,
  MrSubscription,
} from './types'

/**
 * The payload the route accepts as body.snapshot. Every key is optional on the
 * type, but validateSnapshotPayload refuses a payload that carries none of
 * them: an empty snapshot would plan a run that reads nothing and reports it
 * as a clean zero.
 */
export interface ManyRequestsSnapshotPayload {
  organizations?: MrOrganization[]
  /** Keyed by the ManyRequests organization id, as a string. */
  membersByOrg?: Record<string, MrClient[]>
  brandsByOrg?: Record<string, MrBrand[]>
  subscriptionsByOrg?: Record<string, MrSubscription[]>
  clients?: MrClient[]
  services?: MrService[]
  requests?: MrRequest[]
  invoices?: MrInvoice[]
}

const LIST_KEYS = ['organizations', 'clients', 'services', 'requests', 'invoices'] as const
const BY_ORG_KEYS = ['membersByOrg', 'brandsByOrg', 'subscriptionsByOrg'] as const

type ListKey = (typeof LIST_KEYS)[number]
type ByOrgKey = (typeof BY_ORG_KEYS)[number]
type SnapshotKey = ListKey | ByOrgKey

/** The eight keys, in the order the importer reads them. */
export const SNAPSHOT_KEYS: readonly SnapshotKey[] = [
  'organizations',
  'membersByOrg',
  'brandsByOrg',
  'subscriptionsByOrg',
  'clients',
  'services',
  'requests',
  'invoices',
]

const KNOWN_KEYS: ReadonlySet<string> = new Set(SNAPSHOT_KEYS)

export type SnapshotValidation =
  | { ok: true; snapshot: ManyRequestsSnapshotPayload; counts: Record<string, number> }
  | { ok: false; reason: string }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

function hasId(value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Check one list of rows. `identity` names the field every row must carry:
 * `id` for the four id-keyed lists, `number` for invoices (the number IS the
 * identifier on that API), null for the per-org lists, whose rows either have
 * no id at all (subscriptions) or are matched by the planner on other fields.
 */
function checkRows(path: string, raw: unknown, identity: 'id' | 'number' | null): string | null {
  if (!Array.isArray(raw)) return `${path} must be an array, got ${describe(raw)}`
  for (let index = 0; index < raw.length; index += 1) {
    const row: unknown = raw[index]
    if (!isPlainObject(row)) return `${path}[${index}] must be a plain object, got ${describe(row)}`
    if (identity === 'id' && !hasId(row.id)) {
      return `${path}[${index}].id must be a number or a non-empty string, got ${describe(row.id)}`
    }
    if (identity === 'number' && !(typeof row.number === 'string' && row.number.trim().length > 0)) {
      return `${path}[${index}].number must be a non-empty string, got ${describe(row.number)}`
    }
  }
  return null
}

/**
 * Prove a body.snapshot is something the importer can read, and say exactly
 * where it is not.
 *
 * Refusals carry the key path (`snapshot.requests[12].id`) because the payload
 * is a few megabytes assembled by hand from MCP reads, and "invalid snapshot"
 * on its own would send the operator back through all of it.
 */
export function validateSnapshotPayload(value: unknown): SnapshotValidation {
  if (!isPlainObject(value)) {
    return { ok: false, reason: `snapshot must be a plain object, got ${describe(value)}` }
  }

  const unknown = Object.keys(value).filter((key) => !KNOWN_KEYS.has(key))
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `snapshot carries unknown key${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}. Known keys: ${SNAPSHOT_KEYS.join(', ')}.`,
    }
  }

  const present = SNAPSHOT_KEYS.filter((key) => value[key] !== undefined)
  if (present.length === 0) {
    return { ok: false, reason: `snapshot carries none of the known keys (${SNAPSHOT_KEYS.join(', ')})` }
  }

  const accepted: Record<string, unknown> = {}
  const counts: Record<string, number> = {}

  for (const key of LIST_KEYS) {
    const raw = value[key]
    if (raw === undefined) {
      counts[key] = 0
      continue
    }
    const problem = checkRows(`snapshot.${key}`, raw, key === 'invoices' ? 'number' : 'id')
    if (problem) return { ok: false, reason: problem }
    accepted[key] = raw
    counts[key] = (raw as unknown[]).length
  }

  for (const key of BY_ORG_KEYS) {
    const raw = value[key]
    if (raw === undefined) {
      counts[key] = 0
      continue
    }
    if (!isPlainObject(raw)) {
      return { ok: false, reason: `snapshot.${key} must be an object keyed by organization id, got ${describe(raw)}` }
    }
    let total = 0
    for (const [orgId, rows] of Object.entries(raw)) {
      const problem = checkRows(`snapshot.${key}["${orgId}"]`, rows, null)
      if (problem) return { ok: false, reason: problem }
      total += (rows as unknown[]).length
    }
    accepted[key] = raw
    counts[key] = total
  }

  return { ok: true, snapshot: accepted as ManyRequestsSnapshotPayload, counts }
}

/**
 * A ManyRequestsClient that answers from the snapshot and never touches the
 * network.
 *
 * Lists come back as copies so a caller that sorts or splices its result
 * cannot change what the next entity reads. The two detail reads answer with
 * the matching list row (the snapshot rows are already field-complete, so
 * `{...summary, ...detail}` in run.ts is the identity) and THROW on a miss,
 * exactly like the live client: run.ts guards every detail read, turns the
 * throw into a warning and falls back to the list row, so a request that is
 * somehow in the list but not findable by id still imports its title and
 * status rather than vanishing.
 *
 * get, getOne and listAll are the live client's escape hatches for a path it
 * does not name. A snapshot has no paths, so they refuse rather than answer
 * an empty list that would read as "nothing there".
 */
export function createSnapshotClient(snapshot: ManyRequestsSnapshotPayload): ManyRequestsClient {
  function copy<T>(rows: readonly T[] | undefined): T[] {
    return Array.isArray(rows) ? [...rows] : []
  }

  function byOrg<T>(map: Record<string, T[]> | undefined, orgId: string): T[] {
    if (!isPlainObject(map)) return []
    return copy((map as Record<string, T[] | undefined>)[String(orgId)])
  }

  function noLivePath(path: string): ManyRequestsReadError {
    // Status 0: no HTTP round trip happened, so there is no status to report.
    return new ManyRequestsReadError(path, 0, 'snapshot client has no live paths')
  }

  return {
    get: async (path) => {
      throw noLivePath(path)
    },
    getOne: async (path) => {
      throw noLivePath(path)
    },
    listAll: async (path) => {
      throw noLivePath(path)
    },
    listOrganizations: async () => copy(snapshot.organizations),
    listOrgMembers: async (orgId) => byOrg(snapshot.membersByOrg, orgId),
    listOrgBrands: async (orgId) => byOrg(snapshot.brandsByOrg, orgId),
    listOrgServices: async (orgId) => byOrg(snapshot.subscriptionsByOrg, orgId),
    listClients: async () => copy(snapshot.clients),
    listServices: async () => copy(snapshot.services),
    listInvoices: async () => copy(snapshot.invoices),
    getInvoice: async (number) => {
      const wanted = String(number).trim()
      const row = (snapshot.invoices ?? []).find((invoice) => String(invoice.number).trim() === wanted)
      if (!row) throw new ManyRequestsReadError(`/invoices/${number}`, 404, 'not in snapshot')
      return { ...row }
    },
    listRequests: async () => copy(snapshot.requests),
    getRequest: async (id) => {
      const wanted = String(id).trim()
      const row = (snapshot.requests ?? []).find((request) => String(request.id).trim() === wanted)
      if (!row) throw new ManyRequestsReadError(`/requests/${id}`, 404, 'not in snapshot')
      return { ...row }
    },
  }
}
