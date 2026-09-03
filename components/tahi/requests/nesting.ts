/**
 * components/tahi/requests/nesting.ts
 *
 * One pure rule for the requests table: which rows belong in the top-level
 * body when sub-requests are also drawn inside their parent's expanded group.
 *
 * Not a component, so no 'use client' and no React import. Kept out of
 * request-list.tsx so it can be unit tested on its own.
 */

/** The two fields the rule reads. Any row shape with them will do. */
export interface NestableRow {
  id: string
  parentRequestId?: string | null
}

/**
 * Drop the children that the table is already printing somewhere else.
 *
 * A sub-request appears as a <tr> inside its parent's expanded group, so
 * leaving it in the top-level set printed it twice, counted it twice and let
 * it be ticked twice. Dropping EVERY row with a parentRequestId over-corrects:
 * the expanded group is fed by its own /sub-requests fetch, so a child whose
 * parent is not in this set (searched for by title, or caught by a saved view
 * like Overdue that its parent misses) had no row left to appear in and read
 * as "No requests found". A child is a duplicate only when its parent is
 * standing right there in the same set, so that is the only case removed.
 * Order is preserved.
 */
export function dropNestedDuplicates<T extends NestableRow>(rows: readonly T[]): T[] {
  const present = new Set(rows.map(r => r.id))
  return rows.filter(r => !r.parentRequestId || !present.has(r.parentRequestId))
}
