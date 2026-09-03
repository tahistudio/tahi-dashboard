/**
 * Pure state helpers for <DataTable>: which rows are open, which column the
 * table is sorted by, and which rows a shift-click selects.
 *
 * Kept in their own module (no React, no 'use client') so the reducer-ish
 * rules can be unit-tested without a DOM, and so <DataTable> and its
 * consumers share one implementation instead of each page hand-rolling a Set
 * toggle.
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

// ── Sort ────────────────────────────────────────────────────────────────────

/**
 * The sort a table is currently under. Structurally identical to
 * `DataTableSort` in data-table.tsx; declared here so this module stays free
 * of the client component that consumes it.
 */
export interface DataTableSortState {
  key: string
  dir: 'asc' | 'desc'
}

/**
 * The three-step header cycle: ascending, descending, then off.
 *
 * Clearing on the third click is what keeps a page-level sort control alive.
 * Without it one header click silently overrides the order the page handed
 * in, with no way back short of a reload, so the page's own Sort select
 * reads as a dead input.
 */
export function nextSortState(
  current: DataTableSortState | null | undefined,
  key: string,
): DataTableSortState | null {
  if (!current || current.key !== key) return { key, dir: 'asc' }
  if (current.dir === 'asc') return { key, dir: 'desc' }
  return null
}

// ── Range selection ─────────────────────────────────────────────────────────

/**
 * Shift-click range selection. Adds (or removes) every id from `anchor` to
 * `index` inclusive, in either direction, and leaves every id outside the
 * span untouched.
 *
 * `select` comes from the row that was clicked: shift-clicking an unselected
 * row selects the span, shift-clicking a selected one clears it, which is the
 * behaviour every file manager has trained people to expect. Indices outside
 * the id list are clamped rather than throwing, so a stale anchor left behind
 * by a filter can never break a click.
 */
export function applyRangeSelection(
  current: ReadonlySet<string>,
  ids: readonly string[],
  anchor: number,
  index: number,
  select: boolean,
): Set<string> {
  const next = new Set(current)
  const from = Math.max(0, Math.min(anchor, index))
  const to = Math.min(ids.length - 1, Math.max(anchor, index))
  for (let i = from; i <= to; i++) {
    const id = ids[i]
    if (id === undefined) continue
    if (select) next.add(id)
    else next.delete(id)
  }
  return next
}
