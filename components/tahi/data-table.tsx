'use client'

/**
 * <DataTable>. The shared list-page table.
 *
 * Features:
 *   - Sortable columns (controlled or internal).
 *   - Row click navigates or toggles expansion.
 *   - Row selection with checkbox column and select-all in head.
 *   - Per-row action menu via 3-dots button OR right-click anywhere
 *     on the row.
 *   - Expandable rows (renderExpand) with a slide-down detail panel.
 *   - Sticky thead, h-scroll on mobile, density toggle.
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
  ChevronDown, ChevronUp, Loader2, MoreHorizontal, Check,
} from 'lucide-react'
import { Popover } from '@/components/tahi/popover'
import { Badge, type BadgeTone } from '@/components/tahi/badge'

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

  // ── Expandable rows ──
  /** Returns the inline detail panel for a row. When non-null for a
   *  row, the row click toggles its expansion instead of firing
   *  onRowClick. */
  renderExpand?: (row: Row) => React.ReactNode

  // ── Pagination ──
  /** Enable client-side pagination. Defaults to true when rows.length > 20.
   *  Pass false to disable entirely. */
  paginate?: boolean
  /** Initial page size. Defaults to 20. User can change via the size
   *  selector in the pagination footer (20 / 50 / 100 / all). */
  defaultPageSize?: 20 | 50 | 100 | 'all'
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
  onRowPreview,
  paginate,
  defaultPageSize = 20,
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

  const handleSortClick = (col: DataTableColumn<Row>) => {
    if (!col.sortable) return
    const nextDir: SortDir =
      activeSort?.key === col.key && activeSort.dir === 'asc' ? 'desc' : 'asc'
    const next: DataTableSort = { key: col.key, dir: nextDir }
    if (isControlledSort) {
      onSortChange?.(next)
    } else {
      setInternalSort(next)
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

  // Expansion
  const [expandedId, setExpandedId] = React.useState<string | null>(null)
  // Right-click action menu state
  const [actionMenu, setActionMenu] = React.useState<{ row: Row; x: number; y: number } | null>(null)

  // Selection helpers
  const allRowIds = sortedRows.map(getRowId)
  const allSelected = selectable && allRowIds.length > 0 && allRowIds.every(id => activeSelection?.has(id))
  const someSelected = selectable && !allSelected && allRowIds.some(id => activeSelection?.has(id))

  const toggleAll = () => {
    if (allSelected) {
      setSelection(new Set())
    } else {
      setSelection(new Set(allRowIds))
    }
  }

  const toggleRow = (id: string) => {
    const next = new Set(activeSelection ?? [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelection(next)
  }

  const anyClickable = !!onRowClick || !!onRowPreview || !!renderExpand
  const colCount = columns.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)

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
      <div className="h-scroll" style={{ width: '100%' }}>
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
                    width: '2.75rem',
                    paddingRight: 0,
                  }}
                >
                  <SelectCheckbox
                    checked={!!allSelected}
                    indeterminate={someSelected}
                    onChange={toggleAll}
                    ariaLabel={allSelected ? 'Deselect all rows' : 'Select all rows'}
                  />
                </th>
              )}
              {columns.map(col => {
                const isSorted = activeSort?.key === col.key
                const align = col.align ?? 'left'
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
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      color: 'var(--color-text-subtle)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    <Loader2 size={16} className="animate-spin" style={{ color: 'var(--color-brand)' }} aria-hidden="true" />
                    Loading
                  </div>
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={colCount} style={{ padding: 'var(--space-4)' }}>
                  {empty ?? (
                    <div style={{ textAlign: 'center', color: 'var(--color-text-subtle)', fontSize: 'var(--text-sm)', padding: '1.5rem 0' }}>
                      No items to display.
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              pagedRows.map((row, rowIndex) => {
                const id = getRowId(row)
                const isLast = rowIndex === pagedRows.length - 1
                const isSelected = activeSelection?.has(id) ?? false
                const expandContent = renderExpand?.(row) ?? null
                const isExpandable = expandContent != null
                const isExpanded = isExpandable && expandedId === id
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
                    isExpandable={isExpandable}
                    isExpanded={isExpanded}
                    toggleExpand={() => setExpandedId(prev => (prev === id ? null : id))}
                    expandContent={expandContent}
                    openContextMenu={(x, y) => setActionMenu({ row, x, y })}
                    extraColumnCount={(selectable ? 1 : 0) + (rowActions ? 1 : 0)}
                  />
                )
              })
            )}
          </tbody>
        </table>
      </div>

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
  toggleRow: (id: string) => void
  rowActions?: (row: Row) => DataTableAction[]
  isExpandable: boolean
  isExpanded: boolean
  toggleExpand: () => void
  expandContent: React.ReactNode
  openContextMenu: (x: number, y: number) => void
  extraColumnCount: number
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
  openContextMenu,
  extraColumnCount,
}: DataRowProps<Row>) {
  const actionsRef = React.useRef<HTMLButtonElement | null>(null)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const clickable = isExpandable || !!onRowClick || !!onRowPreview

  const handleRowClick = (e: React.MouseEvent) => {
    // Don't fire row-click when the user is interacting with the
    // checkbox column, actions column, link cell, or chip cell.
    const target = e.target as HTMLElement
    if (target.closest('[data-row-control]')) return
    if (isExpandable) toggleExpand()
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
              padding: `${paddingY} 0 ${paddingY} 1rem`,
              borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
              verticalAlign: 'middle',
              width: '2.75rem',
            }}
          >
            <SelectCheckbox
              checked={isSelected}
              onChange={() => toggleRow(rowId)}
              ariaLabel={isSelected ? 'Deselect row' : 'Select row'}
            />
          </td>
        )}
        {columns.map((col) => {
          const align = col.align ?? 'left'
          const isInteractive = col.link || col.edit
          return (
            <td
              key={col.key}
              data-row-control={isInteractive ? '' : undefined}
              style={{
                padding: `${paddingY} 1rem`,
                textAlign: align,
                borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
                color: col.muted ? 'var(--color-text-muted)' : 'var(--color-text)',
                verticalAlign: 'middle',
                whiteSpace: col.wrap ? 'normal' : 'nowrap',
              }}
            >
              {col.link
                ? <LinkCell row={row} col={col} link={col.link} />
                : col.edit
                  ? <ChipCell row={row} edit={col.edit} />
                  : col.render
                    ? col.render(row, rowIndex)
                    : col.accessor
                      ? col.accessor(row)
                      : null}
            </td>
          )
        })}
        {rowActions && (
          <td
            data-row-control
            style={{
              padding: `${paddingY} 0.5rem`,
              borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
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
      {isExpanded && expandContent && (
        <tr>
          <td
            colSpan={columns.length + extraColumnCount}
            style={{
              padding: 0,
              borderBottom: isLast ? 'none' : '1px solid var(--color-border-subtle)',
              background: 'var(--color-bg-secondary)',
            }}
          >
            <div style={{ padding: '1rem 1.25rem', animation: 'tahi-row-expand 200ms ease-out' }}>
              {expandContent}
            </div>
          </td>
        </tr>
      )}
    </>
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

function SelectCheckbox({
  checked,
  indeterminate = false,
  onChange,
  ariaLabel,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
  ariaLabel: string
}) {
  const showCheck = checked || indeterminate
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      onClick={(e) => { e.stopPropagation(); onChange() }}
      style={{
        width: '1.125rem',
        height: '1.125rem',
        borderRadius: 'var(--radius-sm)',
        border: showCheck
          ? '1px solid var(--color-brand)'
          : '1px solid var(--color-border)',
        background: showCheck ? 'var(--color-brand)' : 'var(--color-bg)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background-color 120ms ease, border-color 120ms ease',
        padding: 0,
      }}
    >
      {indeterminate ? (
        <span style={{ width: '0.5rem', height: '2px', background: '#ffffff', borderRadius: 1 }} />
      ) : checked ? (
        <Check size={12} aria-hidden="true" style={{ color: '#ffffff' }} strokeWidth={3} />
      ) : null}
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
