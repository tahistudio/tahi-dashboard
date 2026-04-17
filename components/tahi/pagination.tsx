'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const

export type PageSize = typeof PAGE_SIZE_OPTIONS[number]

interface PaginationProps {
  /** Total number of items across all pages */
  total: number
  /** Current page (1-indexed) */
  page: number
  /** Items per page */
  pageSize: PageSize
  /** Callback when user changes page */
  onPageChange: (page: number) => void
  /** Callback when user changes page size */
  onPageSizeChange: (size: PageSize) => void
  /** Optional label for the items (e.g. "deals", "invoices"). Default: "items" */
  itemLabel?: string
}

/**
 * Shared pagination controls used at the bottom of list views.
 * Pattern: "Showing 1-10 of 47 deals   [<-]  Page 1 / 5  [->]   Show: [10]"
 *
 * Defaults to 10 items. User can change to 25/50/100 or navigate pages.
 */
export function Pagination({
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  itemLabel = 'items',
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const canPrev = page > 1
  const canNext = page < totalPages

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between"
      style={{
        padding: 'var(--space-3) var(--space-4)',
        borderTop: '1px solid var(--color-border-subtle)',
        gap: 'var(--space-3)',
      }}
    >
      {/* Range label */}
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
        Showing <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--color-text)' }}>{from}-{to}</span>
        {' of '}
        <span className="tabular-nums" style={{ fontWeight: 600, color: 'var(--color-text)' }}>{total}</span>
        {' '}{itemLabel}
      </p>

      <div className="flex items-center justify-between sm:justify-end" style={{ gap: 'var(--space-4)' }}>
        {/* Page navigation */}
        <div className="flex items-center" style={{ gap: 'var(--space-1)' }}>
          <button
            onClick={() => canPrev && onPageChange(page - 1)}
            disabled={!canPrev}
            aria-label="Previous page"
            className="flex items-center justify-center"
            style={{
              width: '2rem',
              height: '2rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: canPrev ? 'var(--color-text)' : 'var(--color-text-subtle)',
              transition: 'border-color 150ms ease, background-color 150ms ease',
            }}
            onMouseEnter={e => {
              if (canPrev) e.currentTarget.style.borderColor = 'var(--color-border)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
            }}
          >
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <span className="tabular-nums" style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            minWidth: '3rem',
            textAlign: 'center',
            padding: '0 var(--space-2)',
          }}>
            {page} / {totalPages}
          </span>
          <button
            onClick={() => canNext && onPageChange(page + 1)}
            disabled={!canNext}
            aria-label="Next page"
            className="flex items-center justify-center"
            style={{
              width: '2rem',
              height: '2rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 'var(--radius-sm)',
              color: canNext ? 'var(--color-text)' : 'var(--color-text-subtle)',
              transition: 'border-color 150ms ease, background-color 150ms ease',
            }}
            onMouseEnter={e => {
              if (canNext) e.currentTarget.style.borderColor = 'var(--color-border)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
            }}
          >
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>

        {/* Page size selector */}
        <div className="flex items-center" style={{ gap: 'var(--space-2)' }}>
          <label style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Show
          </label>
          <div style={{ position: 'relative' }}>
            <select
              value={pageSize}
              onChange={e => onPageSizeChange(parseInt(e.target.value) as PageSize)}
              aria-label="Items per page"
              style={{
                appearance: 'none',
                padding: 'var(--space-1) var(--space-6) var(--space-1) var(--space-2)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--color-text)',
                height: '2rem',
              }}
            >
              {PAGE_SIZE_OPTIONS.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <ChevronRight
              size={10}
              aria-hidden="true"
              style={{
                position: 'absolute',
                right: 'var(--space-1-5)',
                top: '50%',
                transform: 'translateY(-50%) rotate(90deg)',
                color: 'var(--color-text-subtle)',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Hook: `usePagination(items, initialPageSize)`
 * Returns the current page slice + paging state + handlers.
 * Resets page to 1 whenever `items` length changes (e.g. filter applied).
 */
import { useState, useEffect, useMemo } from 'react'

export function usePagination<T>(items: T[], initialPageSize: PageSize = 10) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<PageSize>(initialPageSize)

  // When filter changes (items length changes), reset to page 1
  useEffect(() => {
    setPage(1)
  }, [items.length])

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return items.slice(start, start + pageSize)
  }, [items, page, pageSize])

  const handlePageSizeChange = (size: PageSize) => {
    // Try to keep the user near the same items when size grows
    const firstItem = (page - 1) * pageSize
    setPageSize(size)
    setPage(Math.floor(firstItem / size) + 1)
  }

  return {
    paged,
    page,
    pageSize,
    total: items.length,
    setPage,
    setPageSize: handlePageSizeChange,
  }
}
