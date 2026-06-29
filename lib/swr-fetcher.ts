/**
 * lib/swr-fetcher.ts - the canonical SWR fetcher for the dashboard.
 *
 * Wired as the global fetcher in <SwrProvider> (components/tahi/swr-provider.tsx),
 * so client components just call `useSWR<T>('/api/...')` and get caching,
 * dedup, and revalidation for free. The key IS the API path; this fetcher
 * prefixes basePath via apiPath, and throws ApiError on a non-2xx response so
 * SWR surfaces it through `error`.
 *
 * Canonical usage:
 *   const { data, isLoading, error, mutate } = useSWR<{ items: Foo[] }>('/api/admin/foo')
 *   const items = data?.items ?? []
 * Conditional (skip until ready): useSWR(orgId ? `/api/admin/foo?org=${orgId}` : null)
 * After a write: await fetch(apiPath('/api/admin/foo'), { method: 'POST', ... }); mutate()
 * Polling: useSWR(key, { refreshInterval: anyInProgress ? 6000 : 0 })
 */

import { apiPath } from '@/lib/api'

export class ApiError extends Error {
  status: number
  info: unknown
  constructor(status: number, info?: unknown) {
    super(`Request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.info = info
  }
}

export async function swrFetcher<T = unknown>(path: string): Promise<T> {
  const res = await fetch(apiPath(path))
  if (!res.ok) {
    let info: unknown
    try { info = await res.json() } catch { /* response had no JSON body */ }
    throw new ApiError(res.status, info)
  }
  return res.json() as Promise<T>
}
