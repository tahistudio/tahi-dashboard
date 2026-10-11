/**
 * The pure half of the overview's kpis.taskSuggestions key (CN.1 build
 * contract, section 5): reading a raw COUNT(*) row into the honest
 * { pending, calls } shape the owner home card and the overview payload
 * both take.
 *
 * Counts require both inbox features and the caller's current client scope.
 * A missing table or failed permission lookup returns zero.
 */

import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { resolveAccessScoping } from '@/lib/access-scoping'
import { can, type ResolvedAccess } from '@/lib/permissions'
import { isTahiAdmin, type RequestAuthResult } from '@/lib/server-auth'
import { SERVICE_USER_ID } from '@/lib/team-identity'

type Drizzle = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** The inbox's client fence, including pre-client rows only with some access.
 * One JSON binding keeps large scopes under D1's parameter limit. */
export function taskSuggestionOrgCondition(orgIds: readonly string[] | null) {
  if (orgIds === null) return undefined
  if (orgIds.length === 0) return sql`0 = 1`
  return or(
    isNull(schema.taskSuggestions.orgId),
    sql`${schema.taskSuggestions.orgId} IN (SELECT value FROM json_each(${JSON.stringify(orgIds)}))`,
  )
}

export interface TaskSuggestionsCountRow {
  pending: number | string | null
  calls: number | string | null
}

export interface TaskSuggestionsOverviewSummary {
  pending: number
  calls: number
}

function asCount(value: number | string | null | undefined): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** D1's raw driver can hand back numbers as numbers or as strings
 *  depending on the aggregate; this reads either, and a missing or
 *  malformed row as zero rather than throwing. */
export function summariseTaskSuggestionsOverview(
  row: TaskSuggestionsCountRow | undefined | null,
): TaskSuggestionsOverviewSummary {
  if (!row) return { pending: 0, calls: 0 }
  return { pending: asCount(row.pending), calls: asCount(row.calls) }
}

export async function loadTaskSuggestionsOverview(
  database: Drizzle,
  auth: Pick<RequestAuthResult, 'userId' | 'orgId'>,
  access: ResolvedAccess,
): Promise<TaskSuggestionsOverviewSummary> {
  const zero = summariseTaskSuggestionsOverview(undefined)
  if (!isTahiAdmin(auth.orgId) || !auth.userId) return zero
  if (auth.userId !== SERVICE_USER_ID && !(can(access, 'tasks') && can(access, 'requests'))) return zero
  try {
    const orgIds = await resolveAccessScoping(database, auth.userId)
    if (orgIds?.length === 0) return zero
    const [row] = await database
      .select({
        pending: sql<number>`count(*)`,
        calls: sql<number>`count(distinct coalesce(${schema.taskSuggestions.callId}, ${schema.taskSuggestions.transcriptId}))`,
      })
      .from(schema.taskSuggestions)
      .where(and(eq(schema.taskSuggestions.status, 'pending'), taskSuggestionOrgCondition(orgIds)))
    return summariseTaskSuggestionsOverview(row)
  } catch {
    return zero
  }
}
