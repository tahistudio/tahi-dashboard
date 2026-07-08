/**
 * lib/use-resource.ts - the thin SWR-backed resource read used across the dashboard.
 *
 * This is a convenience wrapper over `useSWR` that keeps the return shape
 * identical to raw SWR (data, error, isLoading, isValidating, mutate) so it is a
 * drop-in for the existing `useSWR<T>('/api/...')` call sites, while typing
 * `error` as ApiError so callers can branch on `error.status` (e.g. 403).
 *
 * The `url` argument IS the API path and doubles as the SWR cache key. Pass
 * `null` to skip the request (conditional fetch). Polling, dedup, and
 * revalidation all come from the global <SwrProvider> config.
 *
 * If no <SWRConfig> provider is mounted (e.g. a stray usage outside the
 * dashboard tree), we self-contain by falling back to the canonical
 * `swrFetcher`, so the hook never depends on a provider being present.
 *
 * Usage:
 *   const { data, error, isLoading, mutate } = useResource<{ items: Foo[] }>('/api/admin/foo')
 *   const items = data?.items ?? []
 *
 * Conditional (skip until ready):
 *   useResource(orgId ? `/api/admin/foo?org=${orgId}` : null)
 *
 * Polling while work is in progress:
 *   useResource(key, { refreshInterval: anyInProgress ? 6000 : 0 })
 *
 * After a write, revalidate:
 *   await fetch(apiPath('/api/admin/foo'), { method: 'POST', ... }); mutate()
 */

import useSWR, { type SWRConfiguration, type SWRResponse } from 'swr'
import { swrFetcher, type ApiError } from '@/lib/swr-fetcher'

export type { ApiError }

export function useResource<T = unknown>(
  url: string | null,
  config?: SWRConfiguration<T, ApiError>,
): Pick<SWRResponse<T, ApiError>, 'data' | 'error' | 'isLoading' | 'isValidating' | 'mutate'> {
  // Self-contained fallback: if a caller sits outside <SwrProvider>, SWR would
  // have no global fetcher, so we supply the canonical one here. When the
  // provider IS mounted its fetcher is inherited unless a caller overrides it.
  const { data, error, isLoading, isValidating, mutate } = useSWR<T, ApiError>(url, {
    fetcher: swrFetcher,
    ...config,
  })
  return { data, error, isLoading, isValidating, mutate }
}
