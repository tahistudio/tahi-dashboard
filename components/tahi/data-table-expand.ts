/**
 * Expand-state helpers for <DataTable>'s multi-row expand API.
 *
 * Kept in their own module (no React, no 'use client') so the reducer-ish
 * rules that govern which rows are open can be unit-tested without a DOM,
 * and so <DataTable> and its consumers share one implementation instead of
 * each page hand-rolling a Set toggle.
 *
 * Every function is pure and returns a NEW Set, except `pruneExpandedIds`,
 * which returns the SAME Set instance when nothing needed removing. That
 * identity guarantee is what lets a caller do
 *
 *   setExpanded(prev => pruneExpandedIds(prev, visibleIds))
 *
 * inside an effect without looping forever.
 */

/** Toggle one row open or closed. */
export function toggleExpandedId(
  current: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(current)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/**
 * Drop any open id that is no longer in the visible row set. Called when a
 * filter, a saved view, a search or a sort changes the rows under the
 * table, so a panel can never stay open for a row the user cannot see.
 *
 * Returns `current` unchanged (same reference) when every open id is still
 * valid.
 */
export function pruneExpandedIds(
  current: ReadonlySet<string>,
  validIds: Iterable<string>,
): ReadonlySet<string> {
  const valid = validIds instanceof Set ? validIds : new Set(validIds)
  let changed = false
  const next = new Set<string>()
  current.forEach(id => {
    if (valid.has(id)) next.add(id)
    else changed = true
  })
  return changed ? next : current
}

/**
 * True when every expandable row is currently open. False when nothing is
 * expandable, so an "Expand all" control never renders as already-expanded
 * on an empty table.
 */
export function areAllExpanded(
  expandableIds: readonly string[],
  current: ReadonlySet<string>,
): boolean {
  if (expandableIds.length === 0) return false
  return expandableIds.every(id => current.has(id))
}

/**
 * The Expand all / Collapse all toggle. Collapses to empty when everything
 * is already open, otherwise opens every expandable row. Open ids that are
 * no longer expandable are dropped on the way through.
 */
export function toggleExpandAll(
  expandableIds: readonly string[],
  current: ReadonlySet<string>,
): Set<string> {
  if (areAllExpanded(expandableIds, current)) return new Set()
  return new Set(expandableIds)
}
