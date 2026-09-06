/**
 * lib/import/manyrequests/run.ts
 *
 * The orchestrator: probe, fetch, plan, (optionally) apply, probe again.
 *
 * Entity order is a dependency order, not a preference. Team goes first or
 * every one of Nathan Day's client-facing replies mis-attributes; organisations
 * before contacts, brands, subscriptions, requests and invoices; requests
 * before messages.
 *
 * A dry run and an apply differ in exactly two places: the apply calls
 * applyEntityPlan, and it re-reads D1 between entities instead of projecting
 * the previous plan forward. Everything else, including every mapping decision
 * and every refusal, is identical, which is what makes the dry run a real
 * preview rather than a different code path.
 */

import type { DB } from '@/db/d1'
import type { ManyRequestsClient } from './client'
import type { ClosedRuling } from './map'
import {
  DEFAULT_PLAN_OPTIONS,
  PLAN_BUILDERS,
  projectPlan,
  type ImportSnapshot,
  type ImportSource,
  type PlanOptions,
} from './plan'
import { applyEntityPlan, countsFor, readImportSnapshot, readMailProbe } from './upsert'
import {
  IMPORT_ENTITY_ORDER,
  type EntityCounts,
  type EntityPlan,
  type ImportEntity,
  type ImportResult,
  type MailProbe,
  type SkippedRow,
} from './types'

/** How many sample rows a dry run returns per entity. */
export const SAMPLE_LIMIT = 20

export interface RunImportOptions {
  database: DB
  client: ManyRequestsClient
  dryRun: boolean
  entities: readonly ImportEntity[]
  since: string | null
  closedAs: ClosedRuling
  /** Injectable clock, so a plan is deterministic under test. */
  now?: string
  /**
   * Cap on per-request detail fetches. A field-complete request export is one
   * GET per request (329 of them) because the list endpoint carries no
   * created_at, no assignees, no brief and no comments. Null means no cap.
   */
  requestDetailLimit?: number | null
  /**
   * Where in the request list the detail window starts. WITHOUT THIS THE APPLY
   * HAS TO SUCCEED IN ONE SHOT: a limit alone only ever slices from the front,
   * so there is no way to run requests 200 to 329 without re-fetching the first
   * 200. 329 sequential upstream GETs plus the D1 reads is minutes of wall time
   * against Cloudflare's ~100s edge budget, so the run is meant to be walked in
   * windows: {offset: 0, limit: 100}, then {offset: 100, limit: 100}, and so
   * on. Every window is idempotent, so an overlapping or repeated window is an
   * update rather than a duplicate.
   */
  requestDetailOffset?: number | null
}

const EMPTY_SOURCE: ImportSource = {
  organizations: [],
  membersByOrg: {},
  brandsByOrg: {},
  subscriptionsByOrg: {},
  services: [],
  requests: [],
  invoices: [],
}

/** Which entities need which reads, so a single-entity run costs one call set. */
function needsOrgList(entities: ReadonlySet<ImportEntity>): boolean {
  return (
    entities.has('organisations') ||
    entities.has('contacts') ||
    entities.has('brands') ||
    entities.has('subscriptions')
  )
}

function needsRequestDetail(entities: ReadonlySet<ImportEntity>): boolean {
  return entities.has('requests') || entities.has('messages')
}

/**
 * Fetch exactly what the selected entities need. Every call is a READ; there is
 * no write against ManyRequests anywhere in this module.
 *
 * A read failure is a warning and an empty list for that slice, never a thrown
 * run: an invoice endpoint that 404s should not lose the organisation plan that
 * already succeeded.
 */
export async function fetchImportSource(
  client: ManyRequestsClient,
  entities: readonly ImportEntity[],
  options: { requestDetailLimit?: number | null; requestDetailOffset?: number | null } = {},
): Promise<{ source: ImportSource; warnings: string[] }> {
  const selected = new Set(entities)
  const warnings: string[] = []
  const source: ImportSource = {
    ...EMPTY_SOURCE,
    membersByOrg: {},
    brandsByOrg: {},
    subscriptionsByOrg: {},
  }

  async function guard<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await read()
    } catch (error) {
      warnings.push(`${label}: ${error instanceof Error ? error.message : 'read failed'}`)
      return fallback
    }
  }

  if (needsOrgList(selected)) {
    source.organizations = await guard('organizations', () => client.listOrganizations(), [])
    for (const org of source.organizations) {
      const key = String(org.id)
      if (selected.has('contacts')) {
        source.membersByOrg[key] = await guard(`members of organization ${key}`, () => client.listOrgMembers(key), [])
      }
      if (selected.has('brands')) {
        source.brandsByOrg[key] = await guard(`brands of organization ${key}`, () => client.listOrgBrands(key), [])
      }
      if (selected.has('subscriptions')) {
        source.subscriptionsByOrg[key] = await guard(
          `services of organization ${key}`,
          () => client.listOrgServices(key),
          [],
        )
      }
    }
  }

  if (selected.has('services')) {
    source.services = await guard('services', () => client.listServices(), [])
  }

  if (needsRequestDetail(selected)) {
    const list = await guard('requests', () => client.listRequests(), [])
    const limit = options.requestDetailLimit ?? null
    const rawOffset = options.requestDetailOffset ?? null
    const offset = typeof rawOffset === 'number' && rawOffset > 0 ? Math.floor(rawOffset) : 0
    const end = typeof limit === 'number' && limit >= 0 ? offset + Math.floor(limit) : list.length
    const capped = list.slice(offset, end)
    if (capped.length < list.length) {
      warnings.push(
        `Request detail window is ${offset} to ${offset + capped.length} of ${list.length}. Everything outside it was not fetched and is therefore neither planned nor written. Re-run with requestDetailOffset ${offset + capped.length} to walk the next window; every window is idempotent.`,
      )
    }
    const detailed = []
    for (const summary of capped) {
      const key = String(summary.id)
      // The list endpoint carries no created_at, no assignees, no brief and no
      // comments, so a field-complete row is one GET each. A detail failure
      // falls back to the list row, which still imports the title and status
      // rather than losing the request entirely.
      const detail = await guard(`request ${key}`, () => client.getRequest(key), summary)
      detailed.push({ ...summary, ...detail })
    }
    source.requests = detailed
  }

  if (selected.has('invoices')) {
    const list = await guard('invoices', () => client.listInvoices(), [])
    const detailed = []
    for (const summary of list) {
      const number = typeof summary.number === 'string' ? summary.number : ''
      if (!number) {
        detailed.push(summary)
        continue
      }
      // Line items only come back on the single-invoice shape.
      const detail = await guard(`invoice ${number}`, () => client.getInvoice(number), summary)
      detailed.push({ ...summary, ...detail })
    }
    source.invoices = detailed
  }

  return { source, warnings }
}

export async function runImport(options: RunImportOptions): Promise<ImportResult> {
  const { database, client, dryRun } = options
  const entities = IMPORT_ENTITY_ORDER.filter((entity) => options.entities.includes(entity))
  const now = options.now ?? new Date().toISOString()

  const planOptions: PlanOptions = {
    ...DEFAULT_PLAN_OPTIONS,
    closedAs: options.closedAs,
    since: options.since,
    now,
  }

  const mailProbeBefore = await readMailProbe(database)

  const { source, warnings } = await fetchImportSource(client, entities, {
    requestDetailLimit: options.requestDetailLimit ?? null,
    requestDetailOffset: options.requestDetailOffset ?? null,
  })

  const counts: EntityCounts[] = []
  const samples: Record<string, unknown[]> = {}
  const skipped: Record<string, SkippedRow[]> = {}
  const unmapped: Record<string, string[]> = {}

  let snapshot: ImportSnapshot = await readImportSnapshot(database)

  async function runEntity(entity: ImportEntity): Promise<void> {
    const plan: EntityPlan = PLAN_BUILDERS[entity](source, snapshot, planOptions)

    samples[entity] = [
      ...plan.toInsert.slice(0, SAMPLE_LIMIT).map((row) => ({
        op: 'insert',
        table: row.table ?? plan.table,
        manyrequestsId: row.manyrequestsId,
        label: row.label,
        values: row.values,
      })),
      ...plan.toUpdate.slice(0, Math.max(0, SAMPLE_LIMIT - plan.toInsert.length)).map((row) => ({
        op: 'update',
        table: row.table ?? plan.table,
        id: row.id,
        manyrequestsId: row.manyrequestsId,
        label: row.label,
        changes: row.changes,
      })),
    ].slice(0, SAMPLE_LIMIT)
    skipped[entity] = plan.skipped
    unmapped[entity] = plan.unmapped

    if (dryRun) {
      counts.push(countsFor(plan, null))
      // Plan the next entity against the world this one would build.
      snapshot = projectPlan(snapshot, plan)
      return
    }

    const outcome = await applyEntityPlan(database, plan)
    counts.push(countsFor(plan, outcome))
    for (const failure of outcome.failures) {
      skipped[entity].push({
        manyrequestsId: failure.manyrequestsId,
        label: failure.label,
        reason: `Write failed: ${failure.reason}`,
      })
    }
    // Re-read rather than project: the next entity must plan against what was
    // actually written, including anything the apply refused.
    snapshot = await readImportSnapshot(database)
  }

  for (const entity of entities) {
    // ONE ENTITY'S FAILURE IS NOT THE RUN'S. applyEntityPlan records its own
    // per-row write failures, but the snapshot re-read between entities and the
    // planner itself can still throw. Before this, that unwound all the way out
    // of the route: 500, no audit row, no counts, and whatever had already
    // applied stayed applied with no record of what landed. The remaining
    // entities are stopped (they would plan against a snapshot that is now
    // suspect) and the PARTIAL result is returned so the route can write it
    // down.
    try {
      await runEntity(entity)
    } catch (error) {
      warnings.push(
        `Entity "${entity}" failed and the run stopped there: ${error instanceof Error ? error.message : 'unknown error'}. Everything before it is in the counts above and, on an apply, in the audit row. The import is idempotent, so re-running resumes rather than duplicates.`,
      )
      break
    }
  }

  const mailProbeAfter = await readMailProbe(database)

  return {
    dryRun,
    entities: counts,
    samples,
    skipped,
    unmapped,
    mailProbeBefore,
    mailProbeAfter,
    mailSilent: mailProbesAgree(mailProbeBefore, mailProbeAfter),
    mailWitnesses: mailWitnesses(mailProbeBefore, mailProbeAfter),
    warnings,
  }
}

/**
 * Which of the two witnesses was actually live.
 *
 * `mailSilent: true` reads as "both agreed", and on this branch it usually is
 * not: email_suppressions ships with the sibling allowlist slice, so until that
 * migration lands the suppression probe returns null and mailSilent rests
 * entirely on the notification count. A reader deserves to know that from the
 * response rather than from the source.
 */
export function mailWitnesses(before: MailProbe, after: MailProbe): {
  notifications: 'live'
  suppressions: 'live' | 'unavailable'
  degraded: boolean
} {
  const suppressionsLive = before.suppressions !== null && after.suppressions !== null
  return {
    notifications: 'live',
    suppressions: suppressionsLive ? 'live' : 'unavailable',
    degraded: !suppressionsLive,
  }
}

/**
 * Every LIVE witness must agree. A moved suppression count means something
 * tried to send and was withheld; a moved notification count means a
 * notification helper ran, which is the same function that attaches an email
 * plan. Either is a hard signal the run reached a path it must not.
 *
 * A null suppression count is "the table does not exist here", not "agreed":
 * that case is reported separately by mailWitnesses below, so a reader knows
 * `true` came from one witness rather than two.
 */
export function mailProbesAgree(before: MailProbe, after: MailProbe): boolean {
  if (before.notifications !== after.notifications) return false
  if (before.suppressions === null || after.suppressions === null) return true
  return before.suppressions === after.suppressions
}
