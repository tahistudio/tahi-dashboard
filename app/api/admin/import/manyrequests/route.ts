/**
 * POST /api/admin/import/manyrequests
 *
 * The silent ManyRequests import. Super-admin only, dry run by default.
 *
 * Body:
 *   dryRun    boolean, default TRUE. A dry run plans everything and writes
 *             nothing; it is the same code path as an apply minus the write.
 *   entities  string[], default every entity in dependency order. Team first
 *             (or Nathan Day's replies mis-attribute), then organisations,
 *             contacts, brands, services, subscriptions, requests, messages,
 *             invoices.
 *   since     ISO timestamp. Source rows created before it are skipped with a
 *             reason rather than silently dropped.
 *   closedAs  'cancelled' | 'delivered' | 'archived', default 'cancelled'.
 *             ManyRequests 'Closed' is is_closed, NOT is_completed, and the
 *             roughly 34 rows that carry it read like finished or abandoned
 *             work. Every one appears in the plan's `unmapped` list so the
 *             ruling can be checked before the apply.
 *   requestDetailLimit  number, caps the per-request detail fetch. A complete
 *             request export is one GET per request (329 of them).
 *   requestDetailOffset number, where that window starts.
 *   snapshot  object, optional. A pre-fetched ManyRequests export under the
 *             eight list keys (organizations, membersByOrg, brandsByOrg,
 *             subscriptionsByOrg, clients, services, requests, invoices).
 *             When present the run reads from it and never touches the live
 *             API, so no token is needed on this worker. It is validated up
 *             front: a bad snapshot is one 400 naming the key path, never a
 *             partial run.
 *
 * STEP 0, BEFORE ANY OF THIS: the source. Either a token or a snapshot.
 *   (a) The token. manyRequestsTokenFromEnv reads MANYREQUESTS_API_TOKEN,
 *       which is configured on the MCP worker and NOT on the dashboard worker
 *       this route runs in, so an unprepared first dry run answers 400
 *       "ManyRequests is not configured". Set it on this worker first:
 *         wrangler secret put MANYREQUESTS_API_TOKEN            (production)
 *         wrangler secret put MANYREQUESTS_API_TOKEN --env staging
 *         echo 'MANYREQUESTS_API_TOKEN="..."' >> .dev.vars       (local)
 *   (b) The snapshot. Read the lists out of ManyRequests through the read-only
 *       MCP connector, assemble them under the eight keys and POST them as
 *       body.snapshot. The token check is skipped entirely in that mode. The
 *       payload is a few megabytes: App Router route handlers carry no body
 *       size cap (bodyParser.sizeLimit is a Pages Router setting and
 *       serverActions.bodySizeLimit only governs Server Actions), the
 *       middleware never reads a body, and this handler reads it exactly once
 *       with req.json().
 *
 * WHAT TO CHECK ON THE FIRST DRY RUN, IN THIS ORDER, BEFORE TRUSTING A COUNT:
 *   1. samples.requests[0].values.description is non-empty and
 *      formResponses._manyrequests.fields carries the intake answers. If the
 *      briefs and comments are missing the detail reads are not landing;
 *      warnings will name the request and the shape that came back.
 *   2. skipped.organisations holds no "the name map expects a D1 organisation"
 *      refusal. All 15 hand-mapped names must resolve or that client is
 *      refused rather than duplicated.
 *   3. skipped.invoices, for the possible-duplicate refusals against the Xero
 *      and Stripe rows already in D1. Settle those by hand before running the
 *      invoices entity at all.
 *   4. warnings, for read failures and for the mail probe.
 *
 * WALK REQUESTS IN WINDOWS. 329 sequential upstream GETs plus the D1 reads is
 * minutes of wall time against Cloudflare's ~100s edge budget, and every one is
 * a subrequest. Run requests and messages as
 * {"entities":["requests"],"requestDetailOffset":0,"requestDetailLimit":100},
 * then offset 100, then 200, then 300. Every window is idempotent, so an
 * overlapping or repeated window is an update rather than a duplicate, and a
 * window that times out is re-runnable as-is.
 *
 * MANYREQUESTS IS THE SOURCE OF TRUTH UNTIL CUTOVER, ONE WAY. REQUEST_UPDATABLE
 * carries title, status, priority, assigneeId, dueDate and description, and
 * CONTACT_UPDATABLE carries email, so a second apply OVERWRITES whatever the
 * studio has since changed in the dashboard. Once the team starts working
 * requests here, run the import only with `entities` limited to messages.
 *
 * What comes back, in both modes: per-entity counts (toInsert, toUpdate,
 * toDelete, unchanged, skipped, and on an apply inserted / updated / deleted),
 * the first 20 sample rows per entity, every refusal with its reason, the
 * field-map entries that have no D1 column, and the mail probe read BEFORE and
 * AFTER the run. `mailSilent` is true only when the live witnesses agree, and
 * `mailWitnesses` says which of the two were live: the suppression log ships
 * with the sibling email-allowlist migration, so until that lands mailSilent
 * rests on the notification count alone.
 *
 * THIS ROUTE SENDS NOTHING. It calls no other route, mints no invite and
 * touches no notification helper: see lib/import/manyrequests/index.ts for why
 * "no routes at all" is the rule rather than "stub the mailer". The static
 * guard in lib/import/manyrequests/__tests__/no-mail-imports.test.ts walks this
 * file's whole module graph, not just the library's.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { resolvePermissions } from '@/lib/permissions'
import { db } from '@/lib/db'
import type { DB } from '@/db/d1'
import { logAudit } from '@/lib/audit'
import {
  createManyRequestsClient,
  createSnapshotClient,
  IMPORT_ENTITY_ORDER,
  isImportEntity,
  manyRequestsTokenFromEnv,
  MANYREQUESTS_TOKEN_MISSING,
  runImport,
  SNAPSHOT_KEYS,
  validateSnapshotPayload,
  type ClosedRuling,
  type ImportEntity,
  type ManyRequestsClient,
} from '@/lib/import/manyrequests'

type PermissionsDb = Parameters<typeof resolvePermissions>[0]

interface ImportBody {
  dryRun?: unknown
  entities?: unknown
  since?: unknown
  closedAs?: unknown
  requestDetailLimit?: unknown
  requestDetailOffset?: unknown
  snapshot?: unknown
}

/**
 * Where the run reads from. A snapshot in the body wins outright and the token
 * is never consulted; otherwise it is today's live path, token and all. The
 * client is built lazily so the live constructor stays inside the route's
 * try, exactly where it was.
 */
type ImportSourceChoice =
  | { ok: true; source: 'snapshot'; snapshotCounts: Record<string, number>; client: () => ManyRequestsClient }
  | { ok: true; source: 'live'; snapshotCounts: null; client: () => ManyRequestsClient }
  | { ok: false; error: string }

function resolveSource(snapshot: unknown): ImportSourceChoice {
  // Only an ABSENT key is "no snapshot". An explicit null is refused loudly
  // rather than quietly falling through to a live run nobody asked for.
  if (snapshot !== undefined) {
    const checked = validateSnapshotPayload(snapshot)
    if (!checked.ok) return { ok: false, error: `Snapshot refused: ${checked.reason}` }
    return {
      ok: true,
      source: 'snapshot',
      snapshotCounts: checked.counts,
      client: () => createSnapshotClient(checked.snapshot),
    }
  }
  const token = manyRequestsTokenFromEnv()
  if (!token) return { ok: false, error: MANYREQUESTS_TOKEN_MISSING }
  return { ok: true, source: 'live', snapshotCounts: null, client: () => createManyRequestsClient({ token }) }
}

function parseCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

function parseClosedAs(value: unknown): ClosedRuling {
  return value === 'delivered' || value === 'archived' ? value : 'cancelled'
}

function parseEntities(value: unknown): { entities: ImportEntity[]; unknownNames: string[] } {
  if (!Array.isArray(value) || value.length === 0) {
    return { entities: [...IMPORT_ENTITY_ORDER], unknownNames: [] }
  }
  const entities: ImportEntity[] = []
  const unknownNames: string[] = []
  for (const raw of value) {
    if (isImportEntity(raw)) entities.push(raw)
    else unknownNames.push(String(raw))
  }
  return { entities, unknownNames }
}

function parseSince(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export async function POST(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature(auth, 'settings')
  if (featureDenied) return featureDenied

  const database = (await db()) as DB

  // Super-admin only, exactly like the data export. An import that rewrites
  // clients, requests and the ledger is at least as consequential as reading
  // them, and the MCP service token resolves to admin (not super_admin) so it
  // cannot trigger one without a human identity behind it.
  const access = await resolvePermissions(database as unknown as PermissionsDb, auth)
  if (!access.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as ImportBody
  // Default TRUE. An import is only ever applied when someone says so out loud.
  const dryRun = body.dryRun !== false
  const { entities, unknownNames } = parseEntities(body.entities)
  if (entities.length === 0) {
    return NextResponse.json(
      { error: `No known entities requested. Known: ${IMPORT_ENTITY_ORDER.join(', ')}.` },
      { status: 400 },
    )
  }

  // The source: a snapshot in the body, or the live API behind the token. A
  // snapshot is checked BEFORE anything else so a malformed payload is one 400
  // naming the key path rather than nine entities of silent refusals.
  const source = resolveSource(body.snapshot)
  if (!source.ok) {
    return NextResponse.json({ error: source.error }, { status: 400 })
  }

  const requestDetailLimit = parseCount(body.requestDetailLimit)
  const requestDetailOffset = parseCount(body.requestDetailOffset)

  try {
    const result = await runImport({
      database,
      client: source.client(),
      dryRun,
      entities,
      since: parseSince(body.since),
      closedAs: parseClosedAs(body.closedAs),
      requestDetailLimit,
      requestDetailOffset,
    })

    if (unknownNames.length > 0) {
      result.warnings.push(`Ignored unknown entities: ${unknownNames.join(', ')}.`)
    }
    if (!result.mailSilent) {
      result.warnings.push(
        'MAIL PROBE MOVED. The suppression log or the notification table changed during this run, which means something reached a notification or mail path. Treat the run as suspect and investigate before running it again.',
      )
    }
    if (result.mailWitnesses.degraded) {
      result.warnings.push(
        'MAIL PROBE DEGRADED. email_suppressions does not exist on this database (its migration ships with the email-allowlist slice), so mailSilent rests on the notification count alone. One witness, not two.',
      )
    }

    // The audit row is written for an APPLY only: a dry run changes nothing and
    // an audit_log entry per preview would bury the one that matters.
    if (!dryRun) await writeImportAudit(database, auth.userId, result, source)

    return NextResponse.json(
      source.source === 'snapshot'
        ? { ...result, source: 'snapshot', snapshotCounts: source.snapshotCounts }
        : { ...result, source: 'live' },
    )
  } catch (error) {
    // runImport now returns a partial result rather than throwing on a per
    // entity failure, so reaching here means the run died before it could
    // report anything. Record the attempt anyway: an apply that wrote some
    // rows and left no trace at all is the one unrecoverable outcome.
    const message = error instanceof Error ? error.message : 'Import failed'
    if (!dryRun) {
      await logAudit(database, {
        action: 'manyrequests_import',
        userId: auth.userId,
        userType: 'team_member',
        entityType: 'import',
        entityId: 'manyrequests',
        metadata: { failed: true, error: message, entities, source: source.source },
      })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function writeImportAudit(
  database: DB,
  userId: string | null,
  result: Awaited<ReturnType<typeof runImport>>,
  source: Extract<ImportSourceChoice, { ok: true }>,
): Promise<void> {
  await logAudit(database, {
    action: 'manyrequests_import',
    userId,
    userType: 'team_member',
    entityType: 'import',
    entityId: 'manyrequests',
    metadata: {
      source: source.source,
      snapshotCounts: source.snapshotCounts,
      entities: result.entities,
      mailProbeBefore: result.mailProbeBefore,
      mailProbeAfter: result.mailProbeAfter,
      mailSilent: result.mailSilent,
      mailWitnesses: result.mailWitnesses,
      warnings: result.warnings,
    },
  })
}

/**
 * GET returns the contract without touching ManyRequests or D1 data.
 *
 * Super-admin gated exactly like the POST. It is introspection for an operation
 * only a super admin can run (it discloses whether the ManyRequests credential
 * is configured at all), so there is no caller that needs a weaker gate.
 */
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature(auth, 'settings')
  if (featureDenied) return featureDenied

  const database = (await db()) as DB
  const access = await resolvePermissions(database as unknown as PermissionsDb, auth)
  if (!access.isSuperAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    entities: IMPORT_ENTITY_ORDER,
    defaults: {
      dryRun: true,
      closedAs: 'cancelled',
      since: null,
      requestDetailLimit: null,
      requestDetailOffset: null,
    },
    tokenConfigured: manyRequestsTokenFromEnv() !== null,
    snapshotKeys: SNAPSHOT_KEYS,
    note: 'POST with {"dryRun":true} first. Nothing is written until dryRun is explicitly false. The source is one of two: set MANYREQUESTS_API_TOKEN on THIS worker (wrangler secret put; it is configured on the MCP worker, not here) for a live read, or POST a pre-fetched export as body.snapshot under the keys in snapshotKeys, in which case no token is needed and the live API is never touched.',
  })
}
