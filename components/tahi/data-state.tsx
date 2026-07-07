'use client'

/**
 * <DataState> - the canonical loading / empty / error / populated wrapper.
 *
 * List and detail surfaces across the dashboard all reimplement the same four
 * states: a skeleton while the first uncached load runs, an inline error with a
 * Retry button, an empty block when there is nothing to show, and the populated
 * content otherwise. <DataState> encapsulates that so pages stop copy-pasting it.
 *
 * It pairs naturally with useResource:
 *
 *   const { data, error, isLoading, mutate } = useResource<{ items: Invoice[] }>('/api/admin/invoices')
 *   const invoices = (data?.items ?? []).filter(matchesFilters)  // post-filter array
 *
 *   <DataState
 *     loading={isLoading}
 *     hasData={Boolean(data)}
 *     error={error}
 *     isEmpty={invoices.length === 0}
 *     onRetry={() => void mutate()}
 *     errorTitle="Failed to load invoices."
 *     skeleton={<SkeletonTable rows={8} columns={5} />}
 *     empty={
 *       <EmptyState
 *         icon={<FileText className="w-8 h-8" />}
 *         title="No invoices yet"
 *         description="Invoices you raise will appear here."
 *         ctaLabel="New invoice"
 *         onCtaClick={() => setOpen(true)}
 *       />
 *     }
 *   >
 *     <DataTable<Invoice> columns={columns} rows={invoices} />
 *   </DataState>
 *
 * Precedence (matches the existing convention):
 *   error (and not loading) -> skeleton (loading, no cached data) -> empty
 *   (isEmpty, not loading) -> children.
 *
 * Because <SwrProvider> sets keepPreviousData, we prefer showing children with
 * stale data over flashing a skeleton on a background revalidation: pass
 * `hasData` and the skeleton only renders on the very first load. Note that
 * `isEmpty` must be computed from the POST-FILTER array, not raw data, or a
 * fully-filtered list would flash the empty state.
 */

import React from 'react'
import { RefreshCw } from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { SkeletonTable } from '@/components/tahi/skeletons'

interface DataStateProps {
  /** True while SWR is loading. Combined with `hasData` to avoid skeleton flashes. */
  loading: boolean
  /** True once any (even stale) data has been received. Keeps children mounted
   *  during background revalidation instead of dropping back to the skeleton. */
  hasData?: boolean
  /** ApiError from useResource, or any thrown value. Undefined when healthy. */
  error?: unknown
  /** Caller-computed emptiness of the POST-FILTER list. */
  isEmpty?: boolean
  /** Usually `() => void mutate()`. Wires the Retry button. */
  onRetry?: () => void
  /** Skeleton shown on first load. Defaults to a table skeleton. */
  skeleton?: React.ReactNode
  /** An <EmptyState /> for the empty branch. */
  empty?: React.ReactNode
  /** Error headline. Defaults to a generic message. */
  errorTitle?: string
  /** Populated content. */
  children: React.ReactNode
}

export function DataState({
  loading,
  hasData = false,
  error,
  isEmpty = false,
  onRetry,
  skeleton,
  empty,
  errorTitle = 'Something went wrong loading this.',
  children,
}: DataStateProps) {
  // Error wins, but only once we are not mid-load (a retry re-enters loading).
  if (error && !loading) {
    return (
      <div
        style={{
          padding: '3rem 1.5rem',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '0.75rem',
        }}
      >
        <p style={{ fontSize: '0.875rem' }}>{errorTitle}</p>
        {onRetry && (
          <TahiButton
            size="sm"
            variant="secondary"
            iconLeft={<RefreshCw className="w-3.5 h-3.5" />}
            onClick={() => onRetry()}
          >
            Retry
          </TahiButton>
        )}
      </div>
    )
  }

  // First uncached load only: keepPreviousData keeps children up on refetch.
  if (loading && !hasData) {
    return <>{skeleton ?? <SkeletonTable />}</>
  }

  if (isEmpty) {
    return <>{empty ?? null}</>
  }

  return <>{children}</>
}
