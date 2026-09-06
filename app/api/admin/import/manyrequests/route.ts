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
 *
 * What comes back, in both modes: per-entity counts (toInsert, toUpdate,
 * toDelete, unchanged, skipped, and on an apply inserted / updated / deleted),
 * the first 20 sample rows per entity, every refusal with its reason, the
 * field-map entries that have no D1 column, and the mail probe read BEFORE and
 * AFTER the run. `mailSilent` is true only when both witnesses agree.
 *
 * THIS ROUTE SENDS NOTHING. It calls no other route, mints no invite and
 * touches no notification helper: see lib/import/manyrequests/index.ts for why
 * "no routes at all" is the rule rather than "stub the mailer".
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
  IMPORT_ENTITY_ORDER,
  isImportEntity,
  manyRequestsTokenFromEnv,
  MANYREQUESTS_TOKEN_MISSING,
  runImport,
  type ClosedRuling,
  type ImportEntity,
} from '@/lib/import/manyrequests'

type PermissionsDb = Parameters<typeof resolvePermissions>[0]

interface ImportBody {
  dryRun?: unknown
  entities?: unknown
  since?: unknown
  closedAs?: unknown
  requestDetailLimit?: unknown
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

  const token = manyRequestsTokenFromEnv()
  if (!token) {
    return NextResponse.json({ error: MANYREQUESTS_TOKEN_MISSING }, { status: 400 })
  }

  const limitRaw = body.requestDetailLimit
  const requestDetailLimit = typeof limitRaw === 'number' && Number.isFinite(limitRaw) && limitRaw >= 0
    ? Math.floor(limitRaw)
    : null

  try {
    const result = await runImport({
      database,
      client: createManyRequestsClient({ token }),
      dryRun,
      entities,
      since: parseSince(body.since),
      closedAs: parseClosedAs(body.closedAs),
      requestDetailLimit,
    })

    if (unknownNames.length > 0) {
      result.warnings.push(`Ignored unknown entities: ${unknownNames.join(', ')}.`)
    }
    if (!result.mailSilent) {
      result.warnings.push(
        'MAIL PROBE MOVED. The suppression log or the notification table changed during this run, which means something reached a notification or mail path. Treat the run as suspect and investigate before running it again.',
      )
    }

    // The audit row is written for an APPLY only: a dry run changes nothing and
    // an audit_log entry per preview would bury the one that matters.
    if (!dryRun) {
      await logAudit(database, {
        action: 'manyrequests_import',
        userId: auth.userId,
        userType: 'team_member',
        entityType: 'import',
        entityId: 'manyrequests',
        metadata: {
          entities: result.entities,
          mailProbeBefore: result.mailProbeBefore,
          mailProbeAfter: result.mailProbeAfter,
          mailSilent: result.mailSilent,
          warnings: result.warnings,
        },
      })
    }

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Import failed' },
      { status: 500 },
    )
  }
}

/** GET returns the contract without touching ManyRequests or D1 data. */
export async function GET(req: NextRequest) {
  const auth = await getRequestAuth(req)
  if (!isTahiAdmin(auth.orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature(auth, 'settings')
  if (featureDenied) return featureDenied

  return NextResponse.json({
    entities: IMPORT_ENTITY_ORDER,
    defaults: { dryRun: true, closedAs: 'cancelled', since: null, requestDetailLimit: null },
    tokenConfigured: manyRequestsTokenFromEnv() !== null,
    note: 'POST with {"dryRun":true} first. Nothing is written until dryRun is explicitly false.',
  })
}
