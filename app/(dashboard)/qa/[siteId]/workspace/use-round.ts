'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import type { QaLinkResult, QaPageStatus, QaScanResult, QaViewportKey } from '@/lib/qa/types'
import type { QaRoundPageDetail, QaRoundPageRow, QaRoundResponse } from './qa-types'

/** The check-links route's per-call URL cap. */
const LINK_BATCH = 100
const MAX_LINK_CALLS = 10
/** Quiet period after the last scan before the round is refreshed once. */
const REFRESH_DEBOUNCE_MS = 600

type PendingFields = Partial<QaRoundPageRow>

/** Keys whose value differs between two rows. */
function changedFields(prev: QaRoundPageRow, next: QaRoundPageRow): (keyof QaRoundPageRow)[] {
  return (Object.keys(next) as (keyof QaRoundPageRow)[]).filter(k => next[k] !== prev[k])
}

export interface QaPagePatch {
  vp?: Partial<Record<QaViewportKey, boolean>>
  status?: QaPageStatus
  note?: string | null
}

/** Maps a patch onto a row without touching anything else (used for the optimistic update). */
export function applyPagePatch(row: QaRoundPageRow, patch: QaPagePatch): QaRoundPageRow {
  const next: QaRoundPageRow = { ...row }
  if (patch.vp) {
    if (patch.vp.xl !== undefined) next.vpXl = patch.vp.xl ? 1 : 0
    if (patch.vp.desktop !== undefined) next.vpDesktop = patch.vp.desktop ? 1 : 0
    if (patch.vp.tablet !== undefined) next.vpTablet = patch.vp.tablet ? 1 : 0
    if (patch.vp.mobile_l !== undefined) next.vpMobileL = patch.vp.mobile_l ? 1 : 0
    if (patch.vp.mobile_p !== undefined) next.vpMobileP = patch.vp.mobile_p ? 1 : 0
  }
  if (patch.status !== undefined) next.status = patch.status
  if (patch.note !== undefined) next.note = patch.note
  return next
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`
}

/**
 * Loads one round (round, site, pages, groups) and exposes optimistic page patches.
 * Ticks, status and notes update locally first, then PATCH; on failure the row rolls
 * back to its previous value and a toast explains why.
 */
export function useRound(roundId: string | null) {
  const { showToast } = useToast()
  const [data, setData] = useState<QaRoundResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dataRef = useRef<QaRoundResponse | null>(null)
  dataRef.current = data
  // Optimistic field values still waiting on a PATCH, per round page. A refresh must not overwrite them.
  const pendingRef = useRef<Map<string, PendingFields>>(new Map())
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    if (!roundId) return
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/qa/rounds/${roundId}`))
      if (!res.ok) throw new Error(await readError(res))
      const json = (await res.json()) as QaRoundResponse
      const merged: QaRoundResponse = {
        ...json,
        pages: json.pages.map(row => {
          const pending = pendingRef.current.get(row.id)
          return pending ? { ...row, ...pending } : row
        }),
      }
      setData(merged)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the round.')
    } finally {
      setLoading(false)
    }
  }, [roundId])

  useEffect(() => {
    setData(null)
    void refresh()
  }, [refresh])

  /** One round refresh a short while after the last call, however many scans land in a burst. */
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void refresh()
    }, REFRESH_DEBOUNCE_MS)
  }, [refresh])

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])

  const readOnly = data?.round.status === 'closed'

  const patchPage = useCallback(async (pageId: string, patch: QaPagePatch) => {
    const current = dataRef.current
    if (!current || current.round.status === 'closed') return
    const previous = current.pages.find(p => p.id === pageId)
    if (!previous) return
    const optimistic = applyPagePatch(previous, patch)
    const fields = changedFields(previous, optimistic)
    const pending: PendingFields = pendingRef.current.get(pageId) ?? {}
    const pendingWrite = pending as Record<string, unknown>
    for (const f of fields) pendingWrite[f] = optimistic[f]
    pendingRef.current.set(pageId, pending)
    const settle = () => {
      const live = pendingRef.current.get(pageId) as Record<string, unknown> | undefined
      if (!live) return
      for (const f of fields) if (live[f] === optimistic[f]) delete live[f]
      if (Object.keys(live).length === 0) pendingRef.current.delete(pageId)
    }
    setData(d => (d ? { ...d, pages: d.pages.map(p => (p.id === pageId ? optimistic : p)) } : d))

    const body: Record<string, unknown> = {}
    if (patch.vp) body.vp = patch.vp
    if (patch.status !== undefined) body.status = patch.status
    if (patch.note !== undefined) body.note = patch.note

    try {
      const res = await fetch(apiPath(`/api/admin/qa/round-pages/${pageId}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await readError(res))
      settle()
    } catch (err) {
      // Roll back only the fields this patch touched, and only if nothing newer has replaced them.
      setData(d => {
        if (!d) return d
        return {
          ...d,
          pages: d.pages.map(p => {
            if (p.id !== pageId) return p
            const restored = { ...p } as Record<string, unknown>
            for (const f of fields) if (p[f] === optimistic[f]) restored[f] = previous[f]
            return restored as unknown as QaRoundPageRow
          }),
        }
      })
      settle()
      showToast(err instanceof Error ? err.message : 'Could not save that change.', 'error')
    }
  }, [showToast])

  /** Fetches the issues, scans and link results for one round page. */
  const fetchDetail = useCallback(async (pageId: string): Promise<QaRoundPageDetail> => {
    const res = await fetch(apiPath(`/api/admin/qa/round-pages/${pageId}`))
    if (!res.ok) throw new Error(await readError(res))
    return (await res.json()) as QaRoundPageDetail
  }, [])

  /**
   * Checks link URLs for this round (server caches per round). The route takes
   * at most LINK_BATCH URLs and returns any it ran out of fetch budget for as
   * `unchecked`, so those go back into the queue. MAX_LINK_CALLS bounds the
   * loop in case a site keeps exhausting the budget.
   */
  const checkLinks = useCallback(async (urls: string[]): Promise<QaLinkResult[]> => {
    if (!roundId || urls.length === 0) return []
    const results: QaLinkResult[] = []
    let queue = [...new Set(urls)]
    for (let call = 0; call < MAX_LINK_CALLS && queue.length > 0; call++) {
      const batch = queue.slice(0, LINK_BATCH)
      const res = await fetch(apiPath(`/api/admin/qa/rounds/${roundId}/check-links`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ urls: batch }),
      })
      if (!res.ok) throw new Error(await readError(res))
      const json = (await res.json()) as { results?: QaLinkResult[]; unchecked?: string[] }
      results.push(...(json.results ?? []))
      queue = [...(json.unchecked ?? []), ...queue.slice(LINK_BATCH)]
    }
    return results
  }, [roundId])

  /**
   * Stores one viewport scan. The desktop scan also feeds the link checker. The
   * round refresh is debounced so a burst of scans costs one refresh.
   */
  const submitScan = useCallback(async (roundPageId: string, viewport: QaViewportKey, result: QaScanResult) => {
    const res = await fetch(apiPath(`/api/admin/qa/round-pages/${roundPageId}/scan`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viewport, result }),
    })
    if (!res.ok) throw new Error(await readError(res))
    if (viewport === 'desktop') {
      await checkLinks(result.links.map(l => l.url))
    }
    scheduleRefresh()
  }, [checkLinks, scheduleRefresh])

  return {
    round: data?.round ?? null,
    site: data?.site ?? null,
    pages: data?.pages ?? [],
    groups: data?.groups ?? [],
    loading,
    error,
    readOnly,
    refresh,
    patchPage,
    fetchDetail,
    checkLinks,
    submitScan,
  }
}
