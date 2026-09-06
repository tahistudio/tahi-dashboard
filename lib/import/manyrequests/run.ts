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
  options: { requestDetailLimit?: number | null } = {},
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
    const capped = typeof limit === 'number' && limit >= 0 ? list.slice(0, limit) : list
    if (capped.length < list.length) {
      warnings.push(
        `Request detail capped at ${capped.length} of ${list.length}. The remainder was not fetched and is therefore neither planned nor written.`,
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
  })

  const counts: EntityCounts[] = []
  const samples: Record<string, unknown[]> = {}
  const skipped: Record<string, SkippedRow[]> = {}
  const unmapped: Record<string, string[]> = {}

  let snapshot: ImportSnapshot = await readImportSnapshot(database)

  for (const entity of entities) {
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
      continue
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
    warnings,
  }
}

/**
 * Both witnesses must agree. A moved suppression count means something tried to
 * send and was withheld; a moved notification count means a notification helper
 * ran, which is the same function that attaches an email plan. Either is a hard
 * signal the run reached a path it must not.
 */
export function mailProbesAgree(before: MailProbe, after: MailProbe): boolean {
  if (before.notifications !== after.notifications) return false
  if (before.suppressions === null || after.suppressions === null) return true
  return before.suppressions === after.suppressions
}
