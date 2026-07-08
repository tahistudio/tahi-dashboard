'use client'

/**
 * <SwrProvider>. Global SWR config for the dashboard: the shared fetcher plus
 * sensible defaults so client components get caching + dedup + no-refetch-on-
 * nav for free. Wraps the dashboard layout. See lib/swr-fetcher.ts for the
 * canonical usage pattern.
 */

import { SWRConfig } from 'swr'
import { swrFetcher } from '@/lib/swr-fetcher'

export function SwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: swrFetcher,
        // Dashboards are navigated constantly; revalidating on every window
        // focus is noise. Dedup bursts of the same key, keep the last data
        // visible while revalidating (no spinner flash on back-nav), and do
        // not auto-retry failed requests (the UI shows the error instead).
        revalidateOnFocus: false,
        dedupingInterval: 5000,
        keepPreviousData: true,
        shouldRetryOnError: false,
      }}
    >
      {children}
    </SWRConfig>
  )
}
