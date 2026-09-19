/**
 * The pure half of the overview's kpis.taskSuggestions key (CN.1 build
 * contract, section 5): reading a raw COUNT(*) row into the honest
 * { pending, calls } shape the owner home card and the overview payload
 * both take.
 *
 * The route this backs queries task_suggestions directly by table name
 * (drizzle-orm's sql tag, not the schema import) because the table is
 * slice S1's migration and may not exist in db/schema.ts yet in every tree
 * that imports this route; the query itself is wrapped in a try/catch that
 * falls back to summariseTaskSuggestionsOverview(undefined), so the KPI
 * degrades to zero rather than 500ing the whole overview page.
 */

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
