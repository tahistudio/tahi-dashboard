'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { apiPath } from '@/lib/api'
import { swrFetcher, type ApiError } from '@/lib/swr-fetcher'
import type { BriefSnapshot } from '@/lib/overview-brief'

const BRIEF_PATH = '/api/admin/overview/brief'

interface DailyBriefValue {
  data: BriefSnapshot | undefined
  summary: string | null
  isLoading: boolean
  isRefreshing: boolean
  canRefresh: boolean
  error: string | null
  refresh: () => Promise<BriefSnapshot | undefined>
}

const DailyBriefContext = createContext<DailyBriefValue>({
  data: undefined,
  summary: null,
  isLoading: false,
  isRefreshing: false,
  canRefresh: false,
  error: 'The daily brief is unavailable.',
  refresh: async () => undefined,
})

/** One read and one refresh lifecycle shared by the home, nav and mobile sheet. */
export function DailyBriefProvider({ viewerKey, children }: {
  viewerKey: string | null
  children: React.ReactNode
}) {
  // A permission or audience change discards the old refresh lifecycle, even
  // when the dashboard shell itself stays mounted.
  return <DailyBriefResource key={viewerKey ?? 'disabled'} viewerKey={viewerKey}>{children}</DailyBriefResource>
}

function DailyBriefResource({ viewerKey, children }: {
  viewerKey: string | null
  children: React.ReactNode
}) {
  const { data, error: readError, isLoading, mutate } = useSWR<BriefSnapshot, ApiError>(
    viewerKey ? [BRIEF_PATH, viewerKey] : null,
    () => swrFetcher<BriefSnapshot>(BRIEF_PATH),
    { keepPreviousData: false },
  )
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const pending = useRef<Promise<BriefSnapshot | undefined> | null>(null)
  const active = useRef(true)

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])

  const refresh = useCallback((): Promise<BriefSnapshot | undefined> => {
    if (!viewerKey || !active.current) return Promise.resolve(undefined)
    if (pending.current) return pending.current
    setIsRefreshing(true)
    setRefreshError(null)
    const work = (async () => {
      try {
        const response = await fetch(apiPath(`${BRIEF_PATH}/refresh?force=1`), { method: 'POST' })
        if (!response.ok) throw new Error('Refresh failed')
        const result = await response.json() as BriefSnapshot
        if (!active.current) return undefined
        // Publish the exact computed snapshot to every surface in one update.
        // Skipping a follow-up GET also avoids racing another regeneration.
        await mutate(result, { revalidate: false })
        return result
      } catch {
        if (active.current) setRefreshError('The daily brief could not be refreshed. Try again.')
        return undefined
      } finally {
        pending.current = null
        if (active.current) setIsRefreshing(false)
      }
    })()
    pending.current = work
    return work
  }, [viewerKey, mutate])

  const value = useMemo<DailyBriefValue>(() => ({
    data,
    summary: !data ? null : data.urgent.length + data.week.length === 0
      ? 'All clear. Nothing is waiting on you right now.'
      : `${data.urgent.length} ${data.urgent.length === 1 ? 'thing needs' : 'things need'} you today, ${data.week.length} this week.`,
    isLoading,
    isRefreshing,
    canRefresh: viewerKey !== null,
    error: viewerKey === null
      ? 'The daily brief is unavailable. Reload the page to check your access.'
      : refreshError ?? (readError ? 'The daily brief could not be loaded. Try Refresh.' : null),
    refresh,
  }), [data, isLoading, isRefreshing, refreshError, readError, refresh, viewerKey])

  return <DailyBriefContext.Provider value={value}>{children}</DailyBriefContext.Provider>
}

export function useDailyBrief(): DailyBriefValue {
  return useContext(DailyBriefContext)
}
