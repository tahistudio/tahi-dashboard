'use client'

/**
 * <DataTable>. The shared list-page table.
 *
 * Features:
 *   - Sortable columns (controlled or internal). A header cycles ascending,
 *     descending, then off, so a page-level sort control gets its ordering
 *     back on the third click.
 *   - Row click navigates or toggles expansion.
 *   - Row selection with checkbox column and select-all in head, plus
 *     shift-click to extend the selection across a range of rows.
 *   - Per-row action menu via 3-dots button OR right-click anywhere
 *     on the row.
 *   - Expandable rows, two flavours:
 *       renderExpand    one row open at a time, row click toggles it.
 *       expandable +    many rows open at once, a chevron in the first
 *       renderExpanded  column toggles them, row click still navigates,
 *                       plus an Expand all / Collapse all header control.
 *                       With expandedRowMode="rows" the children are real
 *                       <tr>s in the same tbody, so their cells line up with
 *                       the parent's columns for free.
 *   - Sticky thead, h-scroll on mobile, an opt-in mobileCard layout below md,
 *     density toggle.
 *   - Loading / empty states baked in.
 *   - Outer wrapper clips to its parent's rounded corners so the
 *     table doesn't poke past a Card's curve.
 *
 *   <DataTable
 *     columns={[
 *       { key: 'name', header: 'Name', sortable: true },
 *       { key: 'status', render: r => <Badge ... /> },
 *     ]}
 *     rows={rows}
 *     getRowId={r => r.id}
 *     selectable
 *     selectedIds={selected}
 *     onSelectionChange={setSelected}
 *     onRowClick={r => router.push(`/invoices/${r.id}`)}
 *     rowActions={r => [
 *       { label: 'Open', onClick: () => navigate(r.id) },
 *       { label: 'Delete', tone: 'danger', onClick: () => del(r.id) },
 *     ]}
 *     renderExpand={r => <DetailsPanel row={r} />}
 *     loading={isLoading}
 *     empty={<EmptyState ... />}
 *   />
 */

import * as React from 'react'
import {
  ChevronDown, ChevronUp, ChevronRight, Loader2, MoreHorizontal, Check,
} from 'lucide-react'
import { Popover } from '@/components/tahi/popover'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import {
  toggleExpandedId,
  areAllExpanded,
  toggleExpandAll,
  nextSortState,
  nextInternalSortState,
  applyRangeSelection,
} from '@/components/tahi/data-table-expand'

export {
  toggleExpandedId,
  pruneExpandedIds,
  areAllExpanded,
  toggleExpandAll,
  nextSortState,
  nextInternalSortState,
  applyRangeSelection,
} from '@/components/tahi/data-table-expand'

// ── Types ───────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc'

export interface DataTableSort {
  key: string
  dir: SortDir
}

export interface ChipOption {
  value: string
  label: string
  tone?: BadgeTone
}

/** Editable-chip column declaration. Cell renders as a Badge and
 *  clicking opens a popover with the option list. */
export interface ChipColumnConfig<Row> {
  /** Current value getter. */
  value: (row: Row) => string
  /** Options shown in the popover. */
  options: ChipOption[]
  /** Fires when the user picks a new option. */
  onChange: (row: Row, next: string) => void
}

/** Link-column declaration. Cell renders as a link-styled text and
 *  clicking it navigates / runs onClick. Click does NOT trigger the
 *  parent row's onRowClick. */
export interface LinkColumnConfig<Row> {
  href?: (row: Row) => string | null | undefined
  onClick?: (row: Row) => void
}

export interface DataTableColumn<Row> {
  /** Unique column key. Used for sort + React key. */
  key: string
  /** Header label. */
  header: React.ReactNode
  /** Cell renderer. */
  render?: (row: Row, rowIndex: number) => React.ReactNode
  /** Convenience accessor when render is a straight property pull. */
  accessor?: (row: Row) => React.ReactNode
  /** When sortable, header becomes a toggle. */
  sortable?: boolean
  /** Value used for internal sort. Falls back to accessor result. */
  sortValue?: (row: Row) => string | number | null | undefined
  /** Cell alignment. Default 'left'. */
  align?: 'left' | 'right' | 'center'
  /** Fixed width (e.g. '6rem'). */
  width?: string
  /** Min-width hint for h-scroll. */
  minWidth?: string
  /** Render in a muted text colour. */
  muted?: boolean
  /** Make this cell a link. Click navigates / runs onClick and does
   *  NOT trigger the row's onRowClick / preview. */
  link?: LinkColumnConfig<Row>
  /** Make this cell an editable chip (Notion-style). Click opens a
   *  popover with options; selecting calls onChange. Does NOT trigger
   *  the row's onRowClick / preview. */
  edit?: ChipColumnConfig<Row>
  /** Allow cell contents to wrap onto multiple lines. By default every
   *  cell is `white-space: nowrap` so narrow tables scroll
   *  horizontally instead of wrapping mid-content. Set true on long-
   *  text columns where wrapping is genuinely wanted. */
  wrap?: boolean
}

/**
 * What `renderExpanded` is told about the table it is rendering into. Only
 * meaningful in `expandedRowMode="rows"`, where the caller emits real cells
 * and has to match the parent's shape.
 */
export interface DataTableExpandedContext {
  /** The data columns, in order, by key. */
  columnKeys: readonly string[]
  /** Cells before the data columns: the selection column, when there is one. */
  leadingCells: number
  /** Cells after them: the row-actions column, when there is one. */
  trailingCells: number
  /** Every cell in one full-width row, for a `colSpan`. */
  colSpan: number
}

export interface DataTableAction {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}

interface DataTableProps<Row> {
  columns: ReadonlyArray<DataTableColumn<Row>>
  rows: ReadonlyArray<Row>
  /** Stable row id. Required for keys + click semantics. */
  getRowId: (row: Row) => string
  /** Row click. Skipped if the row is expandable (toggles expansion
   *  instead). Convention: use for full-page navigation. */
  onRowClick?: (row: Row) => void
  /** Optional preview handler. When set, clicking the row fires this
   *  instead of `onRowClick`. Convention: wire to a SlideOver for a
   *  compact record view. Combine with a row-action menu entry
   *  ("Open full record") for full navigation when both are wanted. */
  onRowPreview?: (row: Row) => void
  /** Controlled sort. If omitted, the table sorts internally. */
  sort?: DataTableSort | null
  onSortChange?: (next: DataTableSort | null) => void
  /** Initial sort when uncontrolled. */
  defaultSort?: DataTableSort | null
  /** Render when rows are empty AND not loading. */
  empty?: React.ReactNode
  /** Replaces the body with a centred spinner. */
  loading?: boolean
  /** Optional sticky-header offset (e.g. when nested under a section nav). */
  stickyOffset?: string | number
  /** Tighter row padding for dense lists. */
  density?: 'comfortable' | 'compact'
  /** Aria label for the table. */
  ariaLabel?: string
  /** Optional class on the outer wrapper. */
  className?: string

  // ── Row selection ──
  /** Show a leading checkbox column. Defaults to false. */
  selectable?: boolean
  /** Controlled selection set of row IDs. */
  selectedIds?: ReadonlySet<string>
  /** Selection-change callback (controlled mode). */
  onSelectionChange?: (next: Set<string>) => void

  // ── Per-row actions ──
  /** Returns the action menu items for a row. When set, a 3-dots column
   *  is appended on the right and right-clicking the row opens the
   *  same menu. */
  rowActions?: (row: Row) => DataTableAction[]

  // ── Expandable rows: legacy single-open mode ──
  /** Returns the inline detail panel for a row. When non-null for a
   *  row, the row click toggles its expansion instead of firing
   *  onRowClick. Only one row is open at a time.
   *
   *  Superseded by `expandable` + `renderExpanded` for lists that need
   *  many rows open at once and a row click that still navigates. The two
   *  modes are mutually exclusive; `expandable` wins if both are passed. */
  renderExpand?: (row: Row) => React.ReactNode

  // ── Expandable rows: multi-open, chevron-driven mode ──
  /** Marks a row as expandable. Providing this switches the table into
   *  multi-open mode: a 1.5rem chevron button renders at the head of the
   *  first column, the row click keeps firing onRowClick / onRowPreview,
   *  and any number of rows can be open at once. Rows that return false
   *  get an equal-width spacer so the first column stays aligned. */
  expandable?: (row: Row) => boolean
  /** The panel rendered beneath an open row. Only called for rows that are
   *  both expandable and currently open, so the panel can fetch its own data
   *  lazily on mount.
   *
   *  In the default `panel` mode it is wrapped in a full-width cell, so it can
   *  return anything. In `rows` mode it must return `<tr>` elements; `ctx`
   *  carries the parent's column keys and the leading / trailing cell counts
   *  so the children can line their cells up. */
  renderExpanded?: (row: Row, ctx: DataTableExpandedContext) => React.ReactNode
  /** How an open row's children are put into the table.
   *
   *  `panel` (default) drops one full-width cell under the row and lets the
   *  caller draw whatever it likes inside it.
   *
   *  `rows` renders the caller's `<tr>` elements straight into the same
   *  `<tbody>`, so the browser's own column algorithm aligns a child's cells
   *  with its parent's at every width, with no duplicated width constants.
   *  Use it whenever the children are the same shape as the parent row. */
  expandedRowMode?: 'panel' | 'rows'
  /** Controlled set of open row ids. Omit for internal state. */
  expandedIds?: ReadonlySet<string>
  /** Fires with the next open set. Required for controlled mode. */
  onExpandedChange?: (next: Set<string>) => void
  /** Accessible label for the Expand all / Collapse all header control.
   *  Defaults to "sub-rows", giving "Expand all sub-rows". */
  expandAllLabel?: string

  // ── Pagination ──
  /** Enable client-side pagination. Defaults to true when rows.length > 20.
   *  Pass false to disable entirely. */
  paginate?: boolean
  /** Initial page size. Defaults to 20. User can change via the size
   *  selector in the pagination footer (20 / 50 / 100 / all). */
  defaultPageSize?: 20 | 50 | 100 | 'all'

  // ── Mobile ──
  /** Opt-in card layout used instead of the table below `md`. Without it the
   *  table simply scrolls sideways on a phone, which is fine for a two-column
   *  list and miserable for a six-column one. The caller owns the whole card,
   *  including its own hairline; the loading, empty and pagination chrome
   *  around it stays shared. */
  mobileCard?: (row: Row) => React.ReactNode
}

// ── Implementation ──────────────────────────────────────────────────────────

export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  onRowClick,
  sort,
  onSortChange,
  defaultSort = null,
  empty,
  loading = false,
  stickyOffset = 0,
  density = 'comfortable',
  ariaLabel,
  className,
  selectable = false,
  selectedIds,
  onSelectionChange,
  rowActions,
  renderExpand,
  expandable,
  renderExpanded,
  expandedRowMode = 'panel',
  expandedIds,
  onExpandedChange,
  expandAllLabel = 'sub-rows',
  onRowPreview,
  paginate,
  defaultPageSize = 20,
  mobileCard,
}: DataTableProps<Row>) {
  const isControlledSort = sort !== undefined
  const [internalSort, setInternalSort] = React.useState<DataTableSort | null>(defaultSort)
  const activeSort: DataTableSort | null = isControlledSort ? (sort ?? null) : internalSort

  // Internal selection state if not controlled.
  const isControlledSelection = selectedIds !== undefined
  const [internalSelection, setInternalSelection] = React.useState<Set<string>>(new Set())
  const activeSelection = isControlledSelection ? selectedIds : internalSelection

  const setSelection = React.useCallback((next: Set<string>) => {
    if (isControlledSelection) {
      onSelectionChange?.(next)
    } else {
      setInternalSelection(next)
      onSelectionChange?.(next)
    }
  }, [isControlledSelection, onSelectionChange])

  // Ascending, descending, then off. The third click hands ordering back to
  // whatever handed the rows in, so a page-level sort control never ends up
  // permanently overridden by one header click.
  //
  // A controlled table gets the raw null and decides for itself. An
  // uncontrolled one falls back to `defaultSort`, because there "off" would
  // otherwise mean the order the API happened to return, with no way back
  // short of a reload. Tables that declare no default still clear to nothing.
  const handleSortClick = (col: DataTableColumn<Row>) => {
    if (!col.sortable) return
    if (isControlledSort) {
      onSortChange?.(nextSortState(activeSort, col.key))
    } else {
      setInternalSort(nextInternalSortState(activeSort, col.key, defaultSort))
    }
  }

  const sortedRows = React.useMemo(() => {
    if (!activeSort) return rows
    const col = columns.find(c => c.key === activeSort.key)
    if (!col || !col.sortable) return rows
    const valueOf = (row: Row): string | number => {
      const raw = col.sortValue ? col.sortValue(row) : col.accessor ? col.accessor(row) : null
      if (raw == null) return ''
      if (typeof raw === 'number') return raw
      return String(raw).toLowerCase()
    }
    const sorted = [...rows].sort((a, b) => {
      const av = valueOf(a)
      const bv = valueOf(b)
      if (av === bv) return 0
      const cmp = av > bv ? 1 : -1
      return activeSort.dir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [rows, activeSort, columns])

  // ── Pagination ──────────────────────────────────────────────────────────
  // Auto-enable when rows.length > 20 unless caller explicitly says false.
  // 'all' means no slicing.
  const pagEnabled = paginate ?? (sortedRows.length > 20)
  const [pageSize, setPageSize] = React.useState<20 | 50 | 100 | 'all'>(defaultPageSize)
  const [pageIndex, setPageIndex] = React.useState(0)
  // Reset to page 0 if the row set shrinks past the current page.
  React.useEffect(() => {
    const size = typeof pageSize === 'number' ? pageSize : sortedRows.length
    const lastPage = Math.max(0, Math.ceil(sortedRows.length / Math.max(1, size)) - 1)
    if (pageIndex > lastPage) setPageIndex(0)
  }, [sortedRows.length, pageSize, pageIndex])

  const pagedRows = React.useMemo(() => {
    if (!pagEnabled || pageSize === 'all') return sortedRows
    const start = pageIndex * pageSize
    return sortedRows.slice(start, start + pageSize)
  }, [sortedRows, pagEnabled, pageSize, pageIndex])

  const rowPaddingY = density === 'compact' ? '0.5rem' : '0.75rem'

  // Expansion, legacy single-open mode.
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  // Expansion, multi-open mode. Controlled when expandedIds is supplied.
  const multiExpand = !!expandable
  const [internalExpanded, setInternalExpanded] = React.useState<ReadonlySet<string>>(() => new Set())
  const openIds = expandedIds ?? internalExpanded
  const setOpenIds = React.useCallback((next: Set<string>) => {
    if (expandedIds === undefined) setInternalExpanded(next)
    onExpandedChange?.(next)
  }, [expandedIds, onExpandedChange])

  // Which of the rows actually on screen can open. Expand all only ever
  // reaches the current page, so it can't quietly fetch a hundred panels.
  const expandableIds = React.useMemo(
    () => (expandable ? pagedRows.filter(expandable).map(getRowId) : []),
    [expandable, pagedRows, getRowId],
  )
  const allExpanded = areAllExpanded(expandableIds, openIds)

  // Right-click action menu state
  const [actionMenu, setActionMenu] = React.useState<{ row: Row; x: number; y: number } | null>(null)

  // Selection helpers
  const allRowIds = sortedRows.map(getRowId)
  const allSelected = selectable && allRowIds.length > 0 && allRowIds.every(id => activeSelection?.has(id))
  const someSelected = selectable && !allSelected && allRowIds.some(id => activeSelection?.has(id))

  // Where the last checkbox click landed, so the next one can shift-extend
  // from it. An index into the rows currently on screen, which is also the
  // only span a shift-click is allowed to reach.
  const lastToggledIndex = React.useRef<number | null>(null)

  const toggleAll = () => {
    if (allSelected) {
      setSelection(new Set())
    } else {
      setSelection(new Set(allRowIds))
    }
    // Select-all rewrites the whole selection, so no single row is the anchor
    // any more.
    lastToggledIndex.current = null
  }

  // An index only means something against the exact row list it was taken
  // from. A page change, a filter, a saved view or a new sort all rewrite that
  // list, and an anchor left over from the old one would silently select a
  // span nobody anchored on. The joined id list is the cheapest honest
  // identity for "the rows on screen right now".
  const pagedRowsKey = React.useMemo(
    () => pagedRows.map(getRowId).join('|'),
    [pagedRows, getRowId],
  )
  React.useEffect(() => { lastToggledIndex.current = null }, [pagedRowsKey])

  const toggleRow = (id: string, rowIndex: number, e?: React.MouseEvent) => {
    const current = activeSelection ?? new Set<string>()
    const anchor = lastToggledIndex.current
    if (e?.shiftKey && anchor !== null) {
      // Extend from the anchor. Direction comes from the clicked row: an
      // unselected row selects the span, a selected one clears it.
      setSelection(applyRangeSelection(current, pagedRows.map(getRowId), anchor, rowIndex, !current.has(id)))
      // Shift-clicking a row also drags a text selection across it.
      if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges()
    } else {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelection(next)
    }
    lastToggledIndex.current = rowIndex
  }

  const colCount = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)

  // Which of the two layouts is actually mounted, once we know the width.
  //
  // `md:hidden` / `hidden md:block` alone leaves both in the DOM, so a desktop
  // render still calls `mobileCard` for every paged row (mounting whatever it
  // renders a second time) and ships two copies of the empty state. `null`
  // means "not measured yet": both layouts render, exactly as the CSS pair
  // does today, so the server render and the first client render agree and
  // nothing flashes. The effect runs on mount and drops the unused one.
  const wantsCards = !!mobileCard
  const [narrow, setNarrow] = React.useState<boolean | null>(null)
  React.useEffect(() => {
    // Tables with no card layout have only one thing to render, so they never
    // need to know the width and never take a listener.
    if (!wantsCards) return
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(max-width: 767px)')
    const update = () => setNarrow(mql.matches)
    update()
    mql.addEventListener?.('change', update)
    return () => mql.removeEventListener?.('change', update)
  }, [wantsCards])
  const showCards = narrow !== false
  const showTable = !mobileCard || narrow !== true

  // Handed to `renderExpanded` in rows mode so a child row can match the
  // parent's cell count without the caller restating the column list.
  const expandedContext = React.useMemo<DataTableExpandedContext>(() => ({
    columnKeys: columns.map(c => c.key),
    leadingCells: selectable ? 1 : 0,
    trailingCells: rowActions ? 1 : 0,
    colSpan: colCount,
  }), [columns, selectable, rowActions, colCount])

  return (
    <div
      className={className}
      style={{
        width: '100%',
        // Inherit the parent's rounded corners so a wrapping Card's
        // curve clips the table cleanly. Combined with overflow:hidden
        // this removes the "borderBottom past the corner" artefact.
        borderRadius: 'inherit',
        overflow: 'hidden',
      }}
    >
      {/* Card layout below md, when the caller opted in. Same rows, same
          pagination; only the shape of one record changes. */}
      {mobileCard && showCards && (
        <div className="md:hidden" style={{ width: '100%' }}>
          {loading ? (
            <div style={{ padding: '2.5rem 1rem' }}>
              <TableStatusBlock>
                <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-brand)' }} aria-hidden="true" />
                Loading
              </TableStatusBlock>
            </div>
          ) : sortedRows.length === 0 ? (
            <div style={{ padding: 'var(--space-4)' }}>
              {empty ?? <TableStatusBlock pad>No items to display.</TableStatusBlock>}
            </div>
          ) : (
            pagedRows.map(row => (
              <React.Fragment key={getRowId(row)}>{mobileCard(row)}</React.Fragment>
            ))
          )}
        </div>
      )}

      {showTable && (
        <div className={mobileCard ? 'h-scroll hidden md:block' : 'h-scroll'} style={{ width: '100%' }}>
          <table
            role="table"
            aria-label={ariaLabel}
            style={{
              width: '100%',
              borderCollapse: 'separate',
              borderSpacing: 0,
              fontSize: 'var(--text-sm)',
              minWidth: 'max-content',
            }}
          >
            <thead>
              <tr>
                {selectable && (
                  <th
                    scope="col"
                    style={{
                      ...thStyle(stickyOffset),
                      width: expandableIds.length > 0 ? '4.25rem' : '2.75rem',
                      paddingRight: 0,
                      userSelect: 'none',
                      WebkitUserSelect: 'none',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.125rem' }}>
                      <SelectCheckbox
                        checked={!!allSelected}
                        indeterminate={someSelected}
                        onChange={toggleAll}
                        ariaLabel={allSelected ? 'Deselect all rows' : 'Select all rows'}
                      />
                      {expandableIds.length > 0 && (
                        <ExpandToggle
                          expanded={allExpanded}
                          label={`${allExpanded ? 'Collapse' : 'Expand'} all ${expandAllLabel}`}
                          onToggle={() => setOpenIds(toggleExpandAll(expandableIds, openIds))}
                        />
                      )}
                    </span>
                  </th>
                )}
                {columns.map((col, colIndex) => {
                  const isSorted = activeSort?.key === col.key
                  const align = col.align ?? 'left'
                  // With no checkbox column the Expand all control has no home
                  // of its own, so it leads the first header cell instead.
                  const leadsExpandAll = !selectable && colIndex === 0 && expandableIds.length > 0
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      aria-sort={col.sortable
                        ? (isSorted ? (activeSort.dir === 'asc' ? 'ascending' : 'descending') : 'none')
                        : undefined}
                      style={{
                        ...thStyle(stickyOffset),
                        textAlign: align,
                        width: col.width,
                        minWidth: col.minWidth,
                      }}
                    >
                      {leadsExpandAll && (
                        <ExpandToggle
                          expanded={allExpanded}
                          label={`${allExpanded ? 'Collapse' : 'Expand'} all ${expandAllLabel}`}
                          onToggle={() => setOpenIds(toggleExpandAll(expandableIds, openIds))}
                          style={{ marginRight: '0.25rem', verticalAlign: 'middle' }}
                        />
                      )}
                      {col.sortable ? (
                        <button
                          type="button"
                          onClick={() => handleSortClick(col)}
                          className="inline-flex items-center"
                          style={{
                            gap: '0.25rem',
                            padding: 0,
                            margin: 0,
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            font: 'inherit',
                            color: isSorted ? 'var(--color-text)' : 'inherit',
                            textTransform: 'inherit',
                            letterSpacing: 'inherit',
                            fontWeight: 'inherit',
                          }}
                        >
                          {col.header}
                          <SortIndicator active={isSorted} dir={isSorted ? activeSort.dir : undefined} />
                        </button>
                      ) : (
                        col.header
                      )}
                    </th>
                  )
                })}
                {rowActions && (
                  <th
                    scope="col"
                    aria-label="Row actions"
                    style={{
                      ...thStyle(stickyOffset),
                      width: '3rem',
                    }}
                  />
                )}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={colCount} style={{ padding: '2.5rem 1rem' }}>
                    <TableStatusBlock>
                      <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-brand)' }} aria-hidden="true" />
                      Loading
                    </TableStatusBlock>
                  </td>
                </tr>
              ) : sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} style={{ padding: 'var(--space-4)' }}>
                    {empty ?? <TableStatusBlock pad>No items to display.</TableStatusBlock>}
                  </td>
                </tr>
              ) : (
                pagedRows.map((row, rowIndex) => {
                  const id = getRowId(row)
                  const isLast = rowIndex === pagedRows.length - 1
                  const isSelected = activeSelection?.has(id) ?? false
                  // Multi-open mode wins when both APIs are supplied.
                  const canExpand = multiExpand ? expandable(row) : (renderExpand?.(row) ?? null) != null
                  const isExpanded = multiExpand
                    ? (canExpand && openIds.has(id))
                    : (canExpand && expandedId === id)
                  const expandContent = !isExpanded
                    ? null
                    : multiExpand
                      ? (renderExpanded?.(row, expandedContext) ?? null)
                      : (renderExpand?.(row) ?? null)
                  return (
                    <DataRow<Row>
                      key={id}
                      row={row}
                      rowId={id}
                      rowIndex={rowIndex}
                      columns={columns}
                      onRowClick={onRowClick}
                      onRowPreview={onRowPreview}
                      paddingY={rowPaddingY}
                      isLast={isLast}
                      isSelected={isSelected}
                      selectable={selectable}
                      toggleRow={toggleRow}
                      rowActions={rowActions}
                      isExpandable={canExpand}
                      isExpanded={isExpanded}
                      toggleExpand={() => {
                        if (multiExpand) setOpenIds(toggleExpandedId(openIds, id))
                        else setExpandedId(prev => (prev === id ? null : id))
                      }}
                      expandContent={expandContent}
                      expandedRowMode={multiExpand ? expandedRowMode : 'panel'}
                      openContextMenu={(x, y) => setActionMenu({ row, x, y })}
                      extraColumnCount={(selectable ? 1 : 0) + (rowActions ? 1 : 0)}
                      chevronMode={multiExpand}
                      showChevronGutter={multiExpand && expandableIds.length > 0}
                    />
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination footer — only rendered when enabled AND there's
          actually more than one page worth of data. */}
      {pagEnabled && !loading && sortedRows.length > 0 && (
        <TablePagination
          totalRows={sortedRows.length}
          pageSize={pageSize}
          pageIndex={pageIndex}
          onPageSizeChange={(next) => { setPageSize(next); setPageIndex(0) }}
          onPageChange={setPageIndex}
        />
      )}

      {/* Right-click action menu. Floating at cursor position. */}
      {actionMenu && rowActions && (
        <RightClickMenu
          x={actionMenu.x}
          y={actionMenu.y}
          actions={rowActions(actionMenu.row)}
          onClose={() => setActionMenu(null)}
        />
      )}
    </div>
  )
}

// ── Loading / empty block ───────────────────────────────────────────────────
//
// One centred line, shared by the table body and the mobile card list so both
// say the same thing in the same voice.

function TableStatusBlock({ children, pad = false }: { children: React.ReactNode; pad?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        padding: pad ? '1.5rem 0' : undefined,
        textAlign: 'center',
        color: 'var(--color-text-subtle)',
        fontSize: 'var(--text-sm)',
      }}
    >
      {children}
    </div>
  )
}

// ── th style helper ─────────────────────────────────────────────────────────

function thStyle(stickyOffset: string | number): React.CSSProperties {
  return {
    position: 'sticky',
    top: stickyOffset,
    zIndex: 1,
    padding: '0.75rem 1rem',
    background: 'var(--color-bg-secondary)',
    borderBottom: '1px solid var(--color-border-subtle)',
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-text-subtle)',
    whiteSpace: 'nowrap',
  }
}

// ── Row ─────────────────────────────────────────────────────────────────────

interface DataRowProps<Row> {
  row: Row
  rowId: string
  rowIndex: number
  columns: ReadonlyArray<DataTableColumn<Row>>
  onRowClick?: (row: Row) => void
  onRowPreview?: (row: Row) => void
  paddingY: string
  isLast: boolean
  isSelected: boolean
  selectable: boolean
  toggleRow: (id: string, rowIndex: number, e?: React.MouseEvent) => void
  rowActions?: (row: Row) => DataTableAction[]
  isExpandable: boolean
  isExpanded: boolean
  toggleExpand: () => void
  expandContent: React.ReactNode
  /** `rows` drops `expandContent` straight into the tbody; see the prop of
   *  the same name on <DataTable>. */
  expandedRowMode: 'panel' | 'rows'
  openContextMenu: (x: number, y: number) => void
  extraColumnCount: number
  /** Multi-open mode: a chevron button drives expansion and the row click
   *  is left alone, so clicking the row still navigates. */
  chevronMode: boolean
  /** Reserve the chevron's width on rows that cannot expand, so the first
   *  column's content stays aligned down the table. */
  showChevronGutter: boolean
}

function DataRow<Row>({
  row,
  rowId,
  rowIndex,
  columns,
  onRowClick,
  onRowPreview,
  paddingY,
  isLast,
  isSelected,
  selectable,
  toggleRow,
  rowActions,
  isExpandable,
  isExpanded,
  toggleExpand,
  expandContent,
  expandedRowMode,
  openContextMenu,
  extraColumnCount,
  chevronMode,
  showChevronGutter,
}: DataRowProps<Row>) {
  const actionsRef = React.useRef<HTMLButtonElement | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const clickable = (isExpandable && !chevronMode) || !!onRowClick || !!onRowPreview

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't fire row-click when the user is interacting with the
    // checkbox column, actions column, link cell, or chip cell.
    const target = e.target as HTMLElement
    if (target.closest('[data-row-control]')) return
    // In chevron mode the chevron owns expansion, so a row click keeps its
    // normal meaning: navigate, or open the preview.
    if (isExpandable && !chevronMode) toggleExpand()
    else if (onRowPreview) onRowPreview(row)
    else if (onRowClick) onRowClick(row)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!rowActions) return
    e.preventDefault()
    openContextMenu(e.clientX, e.clientY)
  }

  const rowBg = isSelected ? 'var(--color-brand-50)' : 'transparent'

  return (
    <>
      <tr
        className={clickable ? 'tahi-row-clickable' : undefined}
        onClick={clickable ? handleRowClick : undefined}
        onContextMenu={rowActions ? handleContextMenu : undefined}
        style={{
          cursor: clickable ? 'pointer' : 'default',
          background: rowBg,
          transition: 'background-color 120ms ease',
        }}
        onMouseEnter={e => {
          if (isSelected) return
          if (!clickable) return
          e.currentTarget.style.background = 'var(--color-hover-tint)'
        }}
        onMouseLeave={e => {
          if (isSelected) return
          if (!clickable) return
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {selectable && (
          <td
            data-row-control
            style={{
              // No padding of its own: the control carries it instead, so the
              // whole cell is the target rather than an 18px dot floating in
              // the middle of one. Same ink, a hit area a hand can find.
              padding: 0,
              borderBottom: isLast && !isExpanded ? 'none' : '1px solid var(--color-border-subtle)',
              verticalAlign: 'middle',
              width: '2.75rem',
              // Only the cell the shift-click lands in, not the whole row: a
              // shift-drag can no longer paint a text selection down the
              // table, and a title or a client name is still copyable.
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          >
            <SelectCheckbox
              checked={isSelected}
              onChange={e => toggleRow(rowId, rowIndex, e)}
              ariaLabel={isSelected ? 'Deselect row' : 'Select row'}
              fillCell={`${paddingY} 0 ${paddingY} 1rem`}
            />
          </td>
        )}
        {columns.map((col, colIndex) => {
          const align = col.align ?? 'left'
          const isInteractive = col.link || col.edit
          const body = col.link
            ? <LinkCell row={row} col={col} link={col.link} />
            : col.edit
              ? <ChipCell row={row} edit={col.edit} />
              : col.render
                ? col.render(row, rowIndex)
                : col.accessor
                  ? col.accessor(row)
                  : null
          // The chevron leads the first column so it sits before the row's
          // identifier, exactly where the eye scans for a disclosure.
          const leadsChevron = chevronMode && colIndex === 0 && showChevronGutter
          return (
            <td
              key={col.key}
              data-row-control={isInteractive ? '' : undefined}
              style={{
                padding: `${paddingY} 1rem`,
                textAlign: align,
                borderBottom: isLast && !isExpanded ? 'none' : '1px solid var(--color-border-subtle)',
                color: col.muted ? 'var(--color-text-muted)' : 'var(--color-text)',
                verticalAlign: 'middle',
                whiteSpace: col.wrap ? 'normal' : 'nowrap',
              }}
            >
              {leadsChevron ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', minWidth: 0 }}>
                  {isExpandable ? (
                    <span data-row-control style={{ display: 'inline-flex' }}>
                      <ExpandToggle
                        expanded={isExpanded}
                        label={`${isExpanded ? 'Collapse' : 'Expand'} row`}
                        onToggle={toggleExpand}
                      />
                    </span>
                  ) : (
                    <span
                      aria-hidden="true"
                      style={{ display: 'inline-block', width: '1.5rem', height: '1.5rem', flex: 'none' }}
                    />
                  )}
                  <span style={{ minWidth: 0, display: 'flex', alignItems: 'center' }}>{body}</span>
                </span>
              ) : body}
            </td>
          )
        })}
        {rowActions && (
          <td
            data-row-control
            style={{
              padding: `${paddingY} 0.5rem`,
              borderBottom: isLast && !isExpanded ? 'none' : '1px solid var(--color-border-subtle)',
              verticalAlign: 'middle',
              width: '3rem',
              textAlign: 'right',
            }}
          >
            <button
              ref={actionsRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(v => !v)
              }}
              className="inline-flex items-center justify-center"
              style={{
                width: '1.75rem',
                height: '1.75rem',
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-subtle)',
                cursor: 'pointer',
                transition: 'background-color 150ms ease, color 150ms ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'var(--color-bg-tertiary)'
                e.currentTarget.style.color = 'var(--color-text)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--color-text-subtle)'
              }}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Row actions"
            >
              <MoreHorizontal size={15} aria-hidden="true" />
            </button>
            <Popover
              anchorRef={actionsRef}
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              align="end"
              width="12rem"
            >
              <ActionMenuList
                actions={rowActions(row)}
                onClose={() => setMenuOpen(false)}
              />
            </Popover>
          </td>
        )}
      </tr>
      {/* Rows mode: the caller's <tr> children go straight into this tbody,
          so the browser lines their cells up with the parent's columns. */}
      {isExpanded && expandContent && expandedRowMode === 'rows' && expandContent}
      {isExpanded && expandContent && expandedRowMode === 'panel' && (
        <tr>
          <td
            colSpan={columns.length + extraColumnCount}
            style={{
              padding: 0,
              // In chevron mode the panel draws its own hairline on all four
              // sides and pulls up 1px so it sits ON the parent row's rule
              // rather than beside a doubled one.
              borderBottom: chevronMode
                ? 'none'
                : (isLast ? 'none' : '1px solid var(--color-border-subtle)'),
              background: chevronMode ? 'transparent' : 'var(--color-bg-secondary)',
            }}
          >
            <div
              style={chevronMode
                ? {
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border-subtle)',
                    marginTop: '-1px',
                    animation: 'tahi-row-expand 180ms ease-out',
                  }
                : { padding: '1rem 1.25rem', animation: 'tahi-row-expand 200ms ease-out' }}
            >
              {expandContent}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Expand chevron ──────────────────────────────────────────────────────────
//
// One 1.5rem disclosure button, used for both the per-row chevron and the
// Expand all / Collapse all header control. A real <button>, so it is
// keyboard operable and reachable by the site-wide focus ring; the click is
// stopped from bubbling so opening a panel never also opens the record.

function ExpandToggle({
  expanded,
  label,
  onToggle,
  style,
}: {
  expanded: boolean
  label: string
  onToggle: () => void
  style?: React.CSSProperties
}) {
  return (
    <button
      type="button"
      className="tahi-focus-ring inline-flex items-center justify-center"
      aria-expanded={expanded}
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      style={{
        width: '1.5rem',
        height: '1.5rem',
        flex: 'none',
        padding: 0,
        border: 'none',
        background: 'transparent',
        borderRadius: 'var(--radius-sm)',
        color: 'var(--color-text-subtle)',
        cursor: 'pointer',
        transition: 'background-color 150ms ease, color 150ms ease',
        ...style,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--color-bg-tertiary)'
        e.currentTarget.style.color = 'var(--color-text)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--color-text-subtle)'
      }}
    >
      <ChevronRight
        size={14}
        strokeWidth={2.4}
        aria-hidden="true"
        style={{
          transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 150ms ease',
        }}
      />
    </button>
  )
}

// ── Pagination footer ──────────────────────────────────────────────────────
//
// Lightweight client-side pagination. Sits below the table with three
// blocks: "Showing X–Y of Z" on the left, page-size dropdown in the
// middle, prev/next + page indicator on the right.
//
// Exported in case a page wants to render a standalone instance against
// its own data (e.g. a custom non-DataTable list view).

export interface TablePaginationProps {
  totalRows: number
  pageSize: 20 | 50 | 100 | 'all'
  pageIndex: number
  onPageSizeChange: (next: 20 | 50 | 100 | 'all') => void
  onPageChange: (nextIndex: number) => void
}

export function TablePagination({
  totalRows,
  pageSize,
  pageIndex,
  onPageSizeChange,
  onPageChange,
}: TablePaginationProps) {
  const numericSize = pageSize === 'all' ? totalRows : pageSize
  const totalPages = Math.max(1, Math.ceil(totalRows / Math.max(1, numericSize)))
  const start = pageSize === 'all' ? (totalRows > 0 ? 1 : 0) : (pageIndex * pageSize) + 1
  const end = pageSize === 'all' ? totalRows : Math.min(totalRows, (pageIndex + 1) * pageSize)
  const canPrev = pageIndex > 0
  const canNext = pageIndex + 1 < totalPages

  return (
    <div
      className="tahi-table-pagination"
      style={{
        padding: '0.5rem 0.75rem',
        borderTop: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg)',
        fontSize: '0.75rem',
        color: 'var(--color-text-muted)',
      }}
    >
      <div className="tahi-table-pagination-row">
        <span
          className="tahi-table-pagination-count"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {totalRows === 0 ? 'No items' : `${start.toLocaleString()}–${end.toLocaleString()} of ${totalRows.toLocaleString()}`}
        </span>

        <div className="tahi-table-pagination-size" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4375rem' }}>
          <label htmlFor="pgnsize" style={{ fontSize: '0.6875rem' }}>Rows</label>
          <select
            id="pgnsize"
            value={pageSize}
            onChange={(e) => {
              const v = e.target.value
              onPageSizeChange(v === 'all' ? 'all' : (parseInt(v, 10) as 20 | 50 | 100))
            }}
            className="tahi-select"
            style={{
              height: '1.75rem',
              padding: '0 0.4375rem',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.75rem',
              color: 'var(--color-text)',
              outline: 'none',
            }}
          >
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="all">All</option>
          </select>
        </div>

        <div className="tahi-table-pagination-nav" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}>
          <button
            type="button"
            onClick={() => canPrev && onPageChange(pageIndex - 1)}
            disabled={!canPrev}
            aria-label="Previous page"
            style={paginationBtnStyle(canPrev)}
          >
            ←
          </button>
          <span style={{ fontSize: '0.6875rem', fontVariantNumeric: 'tabular-nums', minWidth: '4rem', textAlign: 'center' }}>
            {pageIndex + 1} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => canNext && onPageChange(pageIndex + 1)}
            disabled={!canNext}
            aria-label="Next page"
            style={paginationBtnStyle(canNext)}
          >
            →
          </button>
        </div>
      </div>
    </div>
  )
}

function paginationBtnStyle(enabled: boolean): React.CSSProperties {
  return {
    width: '1.75rem',
    height: '1.75rem',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--color-border)',
    background: enabled ? 'var(--color-bg-secondary)' : 'transparent',
    color: enabled ? 'var(--color-text)' : 'var(--color-text-subtle)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    fontSize: '0.875rem',
    lineHeight: 1,
    opacity: enabled ? 1 : 0.5,
    transition: 'background-color 120ms ease',
  }
}

// ── Selection checkbox ──────────────────────────────────────────────────────

// The 1.125rem box is the visual; the button around it is the target. Below
// md it grows to 2.75rem square. The extra width is pulled back with a
// negative horizontal margin so the column keeps its width, but the extra
// height is left to push the row taller: a negative vertical margin would
// overflow the row, and in a compact table the overflow from one row's target
// lands on top of its neighbour's, so the bottom band of row N's checkbox
// would select row N+1. A phone getting taller rows in exchange is the point
// of a 44px target. The event reaches the caller so a shift-click can extend
// a range.
function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
  fillCell,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (e: React.MouseEvent) => void
  ariaLabel: string
  /** The row cell's padding, moved onto this control so the button IS the
   *  cell: clicking the space beside the box selects the row. Set by the body
   *  cells; the header leaves it unset and keeps the inline sizing. */
  fillCell?: string
}) {
  const showCheck = checked || indeterminate
  const [hover, setHover] = React.useState(false)
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      onClick={(e) => { e.stopPropagation(); onChange(e) }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={fillCell
        ? 'tahi-focus-ring flex items-center justify-start h-full w-full min-h-[2.75rem] md:min-h-0'
        : 'tahi-focus-ring inline-flex items-center justify-center h-11 w-11 mx-[-0.8125rem] md:h-[1.125rem] md:w-[1.125rem] md:mx-0'}
      style={{
        flex: 'none',
        padding: fillCell ?? 0,
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '1.125rem',
          height: '1.125rem',
          flex: 'none',
          boxSizing: 'border-box',
          borderRadius: 'var(--radius-sm)',
          border: showCheck
            ? '1px solid var(--color-brand)'
            : `1px solid ${hover ? 'var(--color-brand)' : 'var(--color-border)'}`,
          background: showCheck ? 'var(--color-brand)' : 'var(--color-bg)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'background-color 120ms ease, border-color 120ms ease',
        }}
      >
        {indeterminate ? (
          <span style={{ width: '0.5rem', height: '2px', background: 'var(--color-text-on-dark)', borderRadius: '1px' }} />
        ) : checked ? (
          <Check size={12} aria-hidden="true" style={{ color: 'var(--color-text-on-dark)' }} strokeWidth={3} />
        ) : null}
      </span>
    </button>
  )
}

// ── Link cell ───────────────────────────────────────────────────────────────

function LinkCell<Row>({
  row,
  col,
  link,
}: {
  row: Row
  col: DataTableColumn<Row>
  link: LinkColumnConfig<Row>
}) {
  const label =
    col.render
      ? col.render(row, 0)
      : col.accessor
        ? col.accessor(row)
        : null
  const href = link.href?.(row)
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (link.onClick) {
      e.preventDefault()
      link.onClick(row)
    }
  }
  // At rest: brand-coloured text with a faint dotted underline so the
  // link is recognisably clickable without shouting. Hover: solid
  // underline + slight colour shift.
  const linkStyle: React.CSSProperties = {
    color: 'var(--color-text-active)',
    textDecoration: 'underline',
    textDecorationStyle: 'dotted',
    textDecorationColor: 'var(--color-brand-100)',
    textUnderlineOffset: '0.1875rem',
    transition: 'color 150ms ease, text-decoration-color 150ms ease, text-decoration-style 150ms ease',
    cursor: 'pointer',
  }
  const onEnter = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.color = 'var(--color-brand-dark)'
    e.currentTarget.style.textDecorationStyle = 'solid'
    e.currentTarget.style.textDecorationColor = 'var(--color-brand)'
  }
  const onLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.color = 'var(--color-text-active)'
    e.currentTarget.style.textDecorationStyle = 'dotted'
    e.currentTarget.style.textDecorationColor = 'var(--color-brand-100)'
  }
  if (href) {
    return (
      <a
        href={href}
        onClick={handleClick}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={linkStyle}
      >
        {label}
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ ...linkStyle, background: 'transparent', border: 'none', padding: 0, font: 'inherit' }}
    >
      {label}
    </button>
  )
}

// ── Edit-chip cell ──────────────────────────────────────────────────────────

function ChipCell<Row>({
  row,
  edit,
}: {
  row: Row
  edit: ChipColumnConfig<Row>
}) {
  const ref = React.useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = React.useState(false)
  const currentValue = edit.value(row)
  const selected = edit.options.find(o => o.value === currentValue)

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center group/chip"
        style={{
          background: 'transparent',
          border: 'none',
          padding: '0.125rem 0.25rem',
          gap: '0.25rem',
          cursor: 'pointer',
          borderRadius: 'var(--radius-sm)',
          transition: 'background-color 120ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
      >
        {selected ? (
          <Badge
            tone={selected.tone ?? 'neutral'}
            variant="soft"
            size="sm"
            leader={false}
          >
            {selected.label}
          </Badge>
        ) : (
          <Badge tone="neutral" variant="soft" size="sm" leader={false}>
            Set value
          </Badge>
        )}
        <ChevronDown
          size={11}
          aria-hidden="true"
          style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }}
        />
      </button>
      <Popover
        anchorRef={ref}
        open={open}
        onClose={() => setOpen(false)}
        align="start"
        width="11rem"
      >
        <div role="listbox" aria-label="Options">
          {edit.options.map(opt => {
            const isActive = opt.value === currentValue
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  edit.onChange(row, opt.value)
                  setOpen(false)
                }}
                className="w-full inline-flex items-center"
                style={{
                  gap: '0.5rem',
                  padding: '0.4375rem 0.625rem',
                  background: isActive ? 'var(--color-bg-secondary)' : 'transparent',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 120ms ease',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = isActive ? 'var(--color-bg-secondary)' : 'transparent' }}
              >
                <Badge tone={opt.tone ?? 'neutral'} variant="soft" size="sm" leader={false}>{opt.label}</Badge>
                <span style={{ flex: 1 }} />
                {isActive && <Check size={13} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />}
              </button>
            )
          })}
        </div>
      </Popover>
    </>
  )
}

// ── Action menu (both 3-dots popover and right-click variant share this) ───

function ActionMenuList({
  actions,
  onClose,
}: {
  actions: DataTableAction[]
  onClose: () => void
}) {
  return (
    <div role="menu" aria-label="Row actions">
      {actions.map((action, i) => (
        <button
          key={i}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          onClick={() => { action.onClick(); onClose() }}
          className="w-full inline-flex items-center"
          style={{
            gap: '0.5rem',
            padding: '0.5rem 0.625rem',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-sm)',
            color: action.tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text)',
            cursor: action.disabled ? 'not-allowed' : 'pointer',
            opacity: action.disabled ? 0.5 : 1,
            textAlign: 'left',
            transition: 'background-color 150ms ease',
          }}
          onMouseEnter={e => {
            if (action.disabled) return
            e.currentTarget.style.background = action.tone === 'danger'
              ? 'var(--color-danger-bg)'
              : 'var(--color-bg-secondary)'
          }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          {action.icon && (
            <span style={{
              color: action.tone === 'danger' ? 'var(--color-danger)' : 'var(--color-text-muted)',
              display: 'inline-flex',
            }}>
              {action.icon}
            </span>
          )}
          {action.label}
        </button>
      ))}
    </div>
  )
}

function RightClickMenu({
  x,
  y,
  actions,
  onClose,
}: {
  x: number
  y: number
  actions: DataTableAction[]
  onClose: () => void
}) {
  // Close on outside click + Escape.
  React.useEffect(() => {
    const onDocClick = () => onClose()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: 'fixed',
        top: y,
        left: x,
        zIndex: 9999,
        width: '13rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-lg)',
        padding: '0.25rem',
        animation: 'tahi-row-expand 120ms ease-out',
      }}
    >
      <ActionMenuList actions={actions} onClose={onClose} />
    </div>
  )
}

// ── Sort indicator ──────────────────────────────────────────────────────────

function SortIndicator({ active, dir }: { active: boolean; dir?: SortDir }) {
  if (!active) {
    return (
      <span
        aria-hidden="true"
        style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 0.7, color: 'var(--color-text-subtle)' }}
      >
        <ChevronUp size={9} />
        <ChevronDown size={9} />
      </span>
    )
  }
  return dir === 'asc'
    ? <ChevronUp size={12} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />
    : <ChevronDown size={12} aria-hidden="true" style={{ color: 'var(--color-brand)' }} />
}
