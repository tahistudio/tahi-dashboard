'use client'

/**
 * <DataTable>. The shared list-page table.
 *
 *   <DataTable
 *     columns={[
 *       { key: 'name',    header: 'Name',  sortable: true },
 *       { key: 'status',  header: 'Status', align: 'left',
 *         render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
 *       { key: 'amount',  header: 'Amount', align: 'right', sortable: true,
 *         render: (row) => formatMoney(row.amount) },
 *     ]}
 *     rows={rows}
 *     getRowId={r => r.id}
 *     onRowClick={r => router.push(`/invoices/${r.id}`)}
 *     empty={<EmptyState ... />}
 *     loading={isLoading}
 *   />
 *
 * Built on a real <table> for accessibility + browser semantics. The
 * outer wrapper carries the .h-scroll utility so the table scrolls
 * horizontally on mobile instead of wrapping cells. The first column
 * sticks to the left edge on h-scroll. Sortable headers toggle on
 * click, indicate direction with a chevron, and call onSortChange if
 * provided (controlled mode); otherwise sort is internal.
 *
 * No row hover ring or single-side borders, per the design system. Row
 * hover applies a brand-tinted background; the cursor turns into a
 * pointer when onRowClick is set.
 */

import * as React from 'react'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

// ── Types ───────────────────────────────────────────────────────────────────

export type SortDir = 'asc' | 'desc'

export interface DataTableSort {
  key: string
  dir: SortDir
}

export interface DataTableColumn<Row> {
  /** Unique column key. Used for sort + React key. */
  key: string
  /** Header label. */
  header: React.ReactNode
  /** Cell renderer. Defaults to (row) => row[key] if `accessor` is set. */
  render?: (row: Row, rowIndex: number) => React.ReactNode
  /** Convenience accessor when render is a straight property pull. */
  accessor?: (row: Row) => React.ReactNode
  /** When sortable, header becomes a toggle. */
  sortable?: boolean
  /** Value used for internal sort. Falls back to accessor result. */
  sortValue?: (row: Row) => string | number | null | undefined
  /** Cell alignment. Default 'left'. */
  align?: 'left' | 'right' | 'center'
  /** Fixed width (e.g. '6rem'). Lets actions / status columns stop expanding. */
  width?: string
  /** Min-width hint for h-scroll. */
  minWidth?: string
  /** Render in a muted text colour. */
  muted?: boolean
}

interface DataTableProps<Row> {
  columns: ReadonlyArray<DataTableColumn<Row>>
  rows: ReadonlyArray<Row>
  /** Stable row id. Required for keys + click semantics. */
  getRowId: (row: Row) => string
  /** Optional row click. Sets cursor: pointer + hover bg. */
  onRowClick?: (row: Row) => void
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
}: DataTableProps<Row>) {
  const isControlled = sort !== undefined
  const [internalSort, setInternalSort] = React.useState<DataTableSort | null>(defaultSort)
  const activeSort: DataTableSort | null = isControlled ? (sort ?? null) : internalSort

  const handleSortClick = (col: DataTableColumn<Row>) => {
    if (!col.sortable) return
    const nextDir: SortDir =
      activeSort?.key === col.key && activeSort.dir === 'asc' ? 'desc' : 'asc'
    const next: DataTableSort = { key: col.key, dir: nextDir }
    if (isControlled) {
      onSortChange?.(next)
    } else {
      setInternalSort(next)
    }
  }

  // Internal sort: sort rows by the active column's sortValue (or accessor).
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

  const rowPaddingY = density === 'compact' ? '0.5rem' : '0.75rem'

  return (
    <div className={['h-scroll', className].filter(Boolean).join(' ')} style={{ width: '100%' }}>
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
                    position: 'sticky',
                    top: stickyOffset,
                    zIndex: 1,
                    textAlign: align,
                    padding: '0.625rem 0.875rem',
                    background: 'var(--color-bg-secondary)',
                    borderBottom: '1px solid var(--color-border-subtle)',
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-subtle)',
                    width: col.width,
                    minWidth: col.minWidth,
                    whiteSpace: 'nowrap',
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
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: '2.5rem 1rem' }}>
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
              <td colSpan={columns.length} style={{ padding: 'var(--space-4)' }}>
                {empty ?? (
                  <div style={{ textAlign: 'center', color: 'var(--color-text-subtle)', fontSize: 'var(--text-sm)', padding: '1.5rem 0' }}>
                    No items to display.
                  </div>
                )}
              </td>
            </tr>
          ) : (
            sortedRows.map((row, rowIndex) => (
              <DataRow<Row>
                key={getRowId(row)}
                row={row}
                rowIndex={rowIndex}
                columns={columns}
                onRowClick={onRowClick}
                paddingY={rowPaddingY}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Row ─────────────────────────────────────────────────────────────────────

function DataRow<Row>({
  row,
  rowIndex,
  columns,
  onRowClick,
  paddingY,
}: {
  row: Row
  rowIndex: number
  columns: ReadonlyArray<DataTableColumn<Row>>
  onRowClick?: (row: Row) => void
  paddingY: string
}) {
  const clickable = !!onRowClick
  return (
    <tr
      onClick={clickable ? () => onRowClick(row) : undefined}
      style={{
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background-color 120ms ease',
      }}
      onMouseEnter={e => {
        if (!clickable) return
        e.currentTarget.style.background = 'var(--color-hover-tint)'
      }}
      onMouseLeave={e => {
        if (!clickable) return
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {columns.map((col, colIndex) => {
        const align = col.align ?? 'left'
        return (
          <td
            key={col.key}
            style={{
              padding: `${paddingY} 0.875rem`,
              textAlign: align,
              borderBottom: '1px solid var(--color-border-subtle)',
              color: col.muted ? 'var(--color-text-muted)' : 'var(--color-text)',
              verticalAlign: 'middle',
              whiteSpace: colIndex === 0 ? 'nowrap' : undefined,
            }}
          >
            {col.render
              ? col.render(row, rowIndex)
              : col.accessor
                ? col.accessor(row)
                : null}
          </td>
        )
      })}
    </tr>
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
