'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { overlayLayers } from '@/components/tahi/overlay-stack'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Layers } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { QA_VIEWPORTS, type QaIssue, type QaScanResult, type QaTarget, type QaViewportKey } from '@/lib/qa/types'
import { QA_RAIL_COLLAPSE_REM, QA_SINGLE_FRAME_REM, narrowerThanRem, useWorkspaceWidth } from './use-workspace-width'
import { useRound, type QaPagePatch } from './use-round'
import { useViewToken } from './use-view-token'
import { useScanAll, SCAN_ALL_VIEWPORTS } from './scan-all'
import { PageRail, filterPages, type QaRailFilter } from './page-rail'
import { ViewportStrip } from './viewport-strip'
import { QA_FRAME_SANDBOX, type QaViewportDef } from './viewport-frame'
import { IssuePanel, type IssuePanelTab } from './issue-panel'
import { RoundActions } from './round-actions'
import type { CreateRequestInput } from './create-request-dialog'
import type { QaRoundPageDetail, QaRoundPageRow, QaRoundRow, QaScanState, QaSiteRow, QaTickMap } from './qa-types'
import { tickCount, ticksFor } from './qa-types'

const LOADING_SCAN_MS = 20_000
/** Quiet period after the last scan before the issues for the page are reloaded once. */
const DETAIL_DEBOUNCE_MS = 600
/** Wait after a frame loads before sending it a highlight, so the scanner has attached. */
const HIGHLIGHT_AFTER_LOAD_MS = 300
const MOBILE_DEFAULT: QaViewportKey = 'desktop'

function emptyStates(): Record<QaViewportKey, QaScanState> {
  return { xl: 'loading', desktop: 'loading', tablet: 'loading', mobile_l: 'loading', mobile_p: 'loading' }
}

/** Origin of the viewer base URL, used as the only postMessage targetOrigin. */
function viewerOrigin(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).origin
  } catch {
    return null
  }
}

/** Upstream page URL on the site (staging or live) for the Open page link. */
function upstreamUrl(site: QaSiteRow, target: QaTarget, path: string): string | null {
  const origin = target === 'live' ? site.liveUrl : site.stagingUrl
  return origin ? `${origin}${path}` : null
}

/** True while a dialog or slide-over is on screen, so page shortcuts stay quiet. */
function overlayOpen(): boolean {
  return overlayLayers.size() > 0 || document.querySelector('[role="dialog"]') !== null
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

export interface RoundWorkspaceProps {
  siteId: string
  roundId: string
}

/** Loads the round, then mounts the workspace body (which needs the round target for the viewer token). */
export function RoundWorkspace({ siteId, roundId }: RoundWorkspaceProps) {
  const round = useRound(roundId)

  if (round.loading && !round.round) {
    return <LoadingSkeleton rows={6} height={56} />
  }
  if (round.error && !round.round) {
    return (
      <EmptyState
        title="Could not load this round"
        description={round.error}
        ctaLabel="Try again"
        onCtaClick={() => void round.refresh()}
      />
    )
  }
  if (!round.round || !round.site) return null

  return (
    <RoundWorkspaceBody
      key={`${round.round.id}:${round.round.target}`}
      siteId={siteId}
      round={round.round}
      site={round.site}
      pages={round.pages}
      groups={round.groups}
      readOnly={round.readOnly}
      refresh={round.refresh}
      patchPage={round.patchPage}
      fetchDetail={round.fetchDetail}
      submitScan={round.submitScan}
    />
  )
}

interface RoundWorkspaceBodyProps {
  siteId: string
  round: QaRoundRow
  site: QaSiteRow
  pages: QaRoundPageRow[]
  groups: { groupKey: string; totalPages: number; sampled: number }[]
  readOnly: boolean
  refresh: () => Promise<void>
  patchPage: (pageId: string, patch: QaPagePatch) => Promise<void>
  fetchDetail: (pageId: string) => Promise<QaRoundPageDetail>
  submitScan: (roundPageId: string, viewport: QaViewportKey, result: QaScanResult) => Promise<void>
}

function RoundWorkspaceBody(props: RoundWorkspaceBodyProps) {
  const { siteId, round, site, pages, groups, readOnly, refresh, patchPage, fetchDetail, submitScan } = props
  const { showToast } = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { ref: workspaceRef, width: workspaceWidth } = useWorkspaceWidth()
  const isMobile = narrowerThanRem(workspaceWidth, QA_SINGLE_FRAME_REM)
  const viewer = useViewToken(siteId, round.target)
  const baseUrl = viewer.baseUrl
  const viewOrigin = useMemo(() => (baseUrl ? viewerOrigin(baseUrl) : null), [baseUrl])

  const [filter, setFilter] = useState<QaRailFilter>('all')
  // null follows the workspace width (icon rail when narrow); a click pins the user's choice.
  const [railChoice, setRailChoice] = useState<boolean | null>(null)
  const railCollapsed = railChoice ?? narrowerThanRem(workspaceWidth, QA_RAIL_COLLAPSE_REM)
  const [railSheetOpen, setRailSheetOpen] = useState(false)
  const [mobileViewport, setMobileViewport] = useState<QaViewportKey>(MOBILE_DEFAULT)
  const [issuesOpen, setIssuesOpen] = useState(true)
  const [issueTab, setIssueTab] = useState<IssuePanelTab>('a11y')
  const [detail, setDetail] = useState<QaRoundPageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [scanStates, setScanStates] = useState<Record<QaViewportKey, QaScanState>>(emptyStates)
  const framesRef = useRef<Partial<Record<QaViewportKey, HTMLIFrameElement | null>>>({})
  // Highlights waiting for their frame to load or scan, one per viewport.
  const pendingHighlights = useRef<Partial<Record<QaViewportKey, string>>>({})
  const detailTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const visible = useMemo(() => filterPages(pages, filter), [pages, filter])
  const requestedPageId = searchParams.get('page')
  const selectedRow = pages.find(p => p.id === requestedPageId) ?? visible[0] ?? pages[0] ?? null
  const selectedId = selectedRow?.id ?? null
  const selectedIdRef = useRef<string | null>(selectedId)
  selectedIdRef.current = selectedId

  const selectPage = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('round', round.id)
    params.set('page', id)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [pathname, round.id, router, searchParams])

  // Load the issues for the selected page.
  const loadDetail = useCallback(async (pageId: string) => {
    setDetailLoading(true)
    try {
      const next = await fetchDetail(pageId)
      // The user may have moved to another page while this loaded.
      if (selectedIdRef.current !== pageId) return
      setDetail(next)
      setDetailError(null)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : 'Could not load the issues.')
    } finally {
      setDetailLoading(false)
    }
  }, [fetchDetail])

  useEffect(() => {
    setDetail(null)
    pendingHighlights.current = {}
    if (!selectedId) return
    void loadDetail(selectedId)
  }, [selectedId, loadDetail])

  useEffect(() => () => {
    if (detailTimer.current) clearTimeout(detailTimer.current)
  }, [])

  // Scan states for the selected page: scanned when stored, otherwise loading until 20 seconds pass.
  useEffect(() => {
    if (!detail) return
    const next = emptyStates()
    // A closed round never scans, so a frame is scanned if a scan is stored and has no scan otherwise.
    const missing: QaScanState = readOnly ? 'no_scan' : 'loading'
    for (const v of QA_VIEWPORTS) next[v.key] = detail.scans[v.key] ? 'scanned' : missing
    setScanStates(next)
    if (readOnly) return
    const timer = setTimeout(() => {
      setScanStates(prev => {
        const out = { ...prev }
        for (const v of QA_VIEWPORTS) if (out[v.key] === 'loading') out[v.key] = 'no_scan'
        return out
      })
    }, LOADING_SCAN_MS)
    return () => clearTimeout(timer)
  }, [detail, readOnly])

  const reloadDetail = useCallback(async () => {
    if (selectedId) await loadDetail(selectedId)
  }, [loadDetail, selectedId])

  /** One issues reload shortly after the last scan of a burst. */
  const scheduleDetailReload = useCallback(() => {
    if (detailTimer.current) clearTimeout(detailTimer.current)
    detailTimer.current = setTimeout(() => {
      detailTimer.current = null
      if (selectedIdRef.current) void loadDetail(selectedIdRef.current)
    }, DETAIL_DEBOUNCE_MS)
  }, [loadDetail])

  // Post messages to frames: always to the viewer origin, never '*'.
  const postToFrames = useCallback((message: { type: 'qa:rescan' } | { type: 'qa:highlight'; selector: string }, key?: QaViewportKey) => {
    if (!viewOrigin) return
    const keys = key ? [key] : QA_VIEWPORTS.map(v => v.key)
    for (const k of keys) {
      framesRef.current[k]?.contentWindow?.postMessage(message, viewOrigin)
    }
  }, [viewOrigin])

  const flushHighlight = useCallback((key: QaViewportKey) => {
    const selector = pendingHighlights.current[key]
    if (!selector) return
    delete pendingHighlights.current[key]
    postToFrames({ type: 'qa:highlight', selector }, key)
  }, [postToFrames])

  const handleScan = useCallback(async (viewport: QaViewportDef, result: QaScanResult) => {
    // The frame is loaded and scanned, so a queued highlight can go now.
    flushHighlight(viewport.key)
    // A closed round stores nothing; the stored scans decide what each frame shows.
    if (readOnly) return
    if (!selectedRow) return
    const pageId = selectedRow.id
    setScanStates(s => ({ ...s, [viewport.key]: 'scanned' }))
    try {
      await submitScan(pageId, viewport.key, result)
      scheduleDetailReload()
    } catch (err) {
      setScanStates(s => ({ ...s, [viewport.key]: 'failed' }))
      showToast(err instanceof Error ? err.message : 'The scan could not be saved.', 'error')
    }
  }, [readOnly, selectedRow, submitScan, scheduleDetailReload, flushHighlight, showToast])

  const handleFrameLoad = useCallback((key: QaViewportKey) => {
    if (!pendingHighlights.current[key]) return
    window.setTimeout(() => flushHighlight(key), HIGHLIGHT_AFTER_LOAD_MS)
  }, [flushHighlight])

  const onScanError = useCallback((message: string) => showToast(message, 'error'), [showToast])
  const scanAll = useScanAll({ baseUrl, pages, submitScan, onError: onScanError })

  function rescan() {
    postToFrames({ type: 'qa:rescan' })
  }

  function showIssue(issue: QaIssue) {
    if (!issue.selector) return
    const key: QaViewportKey = issue.viewport ?? 'desktop'
    if (isMobile && mobileViewport !== key) {
      // The other frame has not loaded yet; queue until it loads or scans.
      pendingHighlights.current[key] = issue.selector
      setMobileViewport(key)
      return
    }
    postToFrames({ type: 'qa:highlight', selector: issue.selector }, key)
  }

  function tick(key: QaViewportKey, value: boolean) {
    if (!selectedRow) return
    const vp: Partial<Record<QaViewportKey, boolean>> = { [key]: value }
    void patchPage(selectedRow.id, { vp })
  }

  function setStatus(status: 'pass' | 'fail' | 'untested') {
    if (!selectedRow) return
    void patchPage(selectedRow.id, { status })
  }

  const move = useCallback((delta: 1 | -1) => {
    if (visible.length === 0) return
    const idx = visible.findIndex(p => p.id === selectedId)
    const next = visible[Math.min(visible.length - 1, Math.max(0, (idx === -1 ? 0 : idx) + delta))]
    if (next && next.id !== selectedId) selectPage(next.id)
  }, [visible, selectedId, selectPage])

  // j / k walk the visible pages (not while typing).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return
      if (overlayOpen()) return
      if (e.key === 'j') {
        e.preventDefault()
        move(1)
      } else if (e.key === 'k') {
        e.preventDefault()
        move(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move])

  async function addSamples(groupKey: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/qa/rounds/${round.id}/samples`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ groupKey, count: 3 }),
      })
      if (!res.ok) throw new Error(await errorText(res))
      await refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not add samples.', 'error')
    }
  }

  async function runPageSpeed(strategy: 'mobile' | 'desktop') {
    if (!selectedRow) return
    try {
      const res = await fetch(apiPath(`/api/admin/qa/round-pages/${selectedRow.id}/pagespeed`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy }),
      })
      if (!res.ok) throw new Error(await errorText(res))
      await reloadDetail()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'PageSpeed failed.', 'error')
    }
  }

  async function createRequest(issue: QaIssue, input: CreateRequestInput): Promise<string> {
    if (!selectedRow) throw new Error('No page selected.')
    const res = await fetch(apiPath(`/api/admin/qa/round-pages/${selectedRow.id}/create-request`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: input.title, description: input.description, viewport: issue.viewport }),
    })
    if (!res.ok) throw new Error(await errorText(res))
    const json = (await res.json()) as { requestId?: string }
    await reloadDetail()
    if (!json.requestId) throw new Error('The request was created but no id came back.')
    return json.requestId
  }

  async function setRoundStatus(status: 'open' | 'closed') {
    try {
      const res = await fetch(apiPath(`/api/admin/qa/rounds/${round.id}`), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error(await errorText(res))
      await refresh()
      showToast(status === 'closed' ? 'Round closed.' : 'Round reopened.', 'success')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not change the round.', 'error')
    }
  }

  const ticks: QaTickMap = selectedRow ? ticksFor(selectedRow) : { xl: false, desktop: false, tablet: false, mobile_l: false, mobile_p: false }
  const selectedIndex = selectedRow ? pages.findIndex(p => p.id === selectedRow.id) : -1
  const upstream = selectedRow ? upstreamUrl(site, round.target as QaTarget, selectedRow.path) : null
  const totalTicks = pages.length * QA_VIEWPORTS.length
  const doneTicks = pages.reduce((n, p) => n + tickCount(p), 0)
  const detailWithRow = detail && selectedRow ? { ...detail, roundPage: selectedRow } : detail
  const targetLabel = round.target === 'live' ? 'Live' : 'Staging'

  if (viewer.error === 'not_configured') {
    return (
      <EmptyState
        title="The QA viewer is not set up yet"
        description="Set QA_VIEW_SECRET and QA_VIEW_ORIGIN, then reload this page."
      />
    )
  }
  if (viewer.error === 'failed') {
    return (
      <EmptyState
        title="Could not open the viewer for this round"
        description={viewer.errorMessage ?? 'Try reloading the page.'}
      />
    )
  }
  if (!baseUrl) {
    return <LoadingSkeleton rows={4} height={96} />
  }

  return (
    <section ref={workspaceRef} aria-label={`${round.name} workspace`} className="flex min-w-0 flex-col" style={{ gap: '1rem' }}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3" style={{ gap: '0.5rem' }}>
        <div className="flex min-w-0 flex-wrap items-center" style={{ gap: '0.5rem' }}>
          {isMobile ? (
            <button
              type="button"
              onClick={() => setRailSheetOpen(true)}
              className="flex min-h-[2.75rem] items-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] px-3 transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              style={{ gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600 }}
            >
              <Layers className="size-4" aria-hidden="true" />
              Pages
            </button>
          ) : null}
          <h2 className="min-w-0 truncate text-[var(--color-text)]" style={{ fontSize: '1rem', fontWeight: 700 }} title={selectedRow?.path ?? ''}>
            {selectedRow?.path ?? 'No page selected'}
          </h2>
          <span className="rounded-full border border-[var(--color-border)] px-2 text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', fontWeight: 600 }}>
            {targetLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: '0.5rem' }}>
          <TahiButton
            variant="secondary"
            size="sm"
            aria-label="Previous page"
            disabled={selectedIndex <= 0}
            onClick={() => move(-1)}
            iconLeft={<ChevronLeft className="size-4" aria-hidden="true" />}
          >
            Prev
          </TahiButton>
          <TahiButton
            variant="secondary"
            size="sm"
            aria-label="Next page"
            disabled={selectedIndex === -1 || selectedIndex >= pages.length - 1}
            onClick={() => move(1)}
            iconRight={<ChevronRight className="size-4" aria-hidden="true" />}
          >
            Next
          </TahiButton>
          <TahiButton variant="secondary" size="sm" onClick={rescan} disabled={!selectedRow || readOnly}>
            Rescan
          </TahiButton>
          {upstream ? (
            <a
              href={upstream}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[2.75rem] items-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] px-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              style={{ gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600 }}
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Open page
            </a>
          ) : null}
          <TahiButton variant="secondary" size="sm" onClick={() => setStatus('pass')} disabled={!selectedRow || readOnly}>
            Pass
          </TahiButton>
          <TahiButton variant="danger" size="sm" onClick={() => setStatus('fail')} disabled={!selectedRow || readOnly}>
            Fail
          </TahiButton>
          <RoundActions
            round={round}
            readOnly={readOnly}
            scanRunning={scanAll.running}
            onScanAll={scanAll.start}
            onRoundChanged={refresh}
            onCloseRound={() => void setRoundStatus('closed')}
            onReopenRound={() => void setRoundStatus('open')}
          />
        </div>
      </div>

      {scanAll.running ? (
        <div role="status" className="flex items-center justify-between rounded-[var(--radius-leaf-sm)] bg-[var(--color-brand-50)] px-3 py-2" style={{ gap: '0.5rem', fontSize: '0.8125rem' }}>
          <span>Scanning {Math.min(scanAll.done + 1, scanAll.total)} of {scanAll.total}. Keep this tab open.</span>
          <TahiButton variant="secondary" size="sm" onClick={scanAll.cancel}>Cancel</TahiButton>
        </div>
      ) : null}

      {readOnly ? (
        <div role="note" className="rounded-[var(--radius-leaf-sm)] bg-[var(--color-bg-tertiary)] px-3 py-2 text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>
          This round is closed. Ticks, status and notes are read-only.
        </div>
      ) : null}

      <div className="flex min-w-0 items-stretch" style={{ gap: '1rem' }}>
        <PageRail
          pages={pages}
          groups={groups}
          selectedId={selectedId}
          onSelect={selectPage}
          filter={filter}
          onFilterChange={setFilter}
          collapsed={railCollapsed}
          onToggleCollapsed={() => setRailChoice(!railCollapsed)}
          singleFrame={isMobile}
          sheetOpen={railSheetOpen}
          onSheetClose={() => setRailSheetOpen(false)}
          onAddSamples={groupKey => void addSamples(groupKey)}
          readOnly={readOnly}
        />
        <div className="flex min-w-0 flex-1 flex-col" style={{ gap: '1rem' }}>
          <div className="flex flex-wrap items-center justify-between" style={{ gap: '0.5rem' }}>
            <div className="flex items-center" style={{ gap: '0.5rem', fontSize: '0.8125rem' }}>
              <span className="text-[var(--color-text-muted)]">Ticks</span>
              <span style={{ fontWeight: 600 }}>{doneTicks} / {totalTicks}</span>
            </div>
            {selectedRow ? (
              <div className="flex flex-wrap items-center" style={{ gap: '0.5rem' }} role="group" aria-label="Viewport ticks">
                {QA_VIEWPORTS.map(v => (
                  <label key={v.key} className="flex min-h-[2.75rem] items-center text-[var(--color-text)]" style={{ gap: '0.25rem', fontSize: '0.75rem' }}>
                    <input
                      type="checkbox"
                      checked={ticks[v.key]}
                      disabled={readOnly}
                      onChange={e => tick(v.key, e.target.checked)}
                      className="size-4 accent-[var(--color-brand)] disabled:cursor-not-allowed"
                    />
                    {v.label}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          {selectedRow ? (
            <ViewportStrip
              baseUrl={baseUrl}
              path={selectedRow.path}
              scanStates={scanStates}
              ticks={ticks}
              readOnly={readOnly}
              onTick={tick}
              onScan={(v, result) => void handleScan(v, result)}
              framesRef={framesRef}
              onFrameLoad={handleFrameLoad}
              mobileViewport={mobileViewport}
              onMobileViewportChange={setMobileViewport}
              singleFrame={isMobile}
            />
          ) : (
            <p className="text-[var(--color-text-muted)]" style={{ fontSize: '0.875rem' }}>No pages in this round yet.</p>
          )}
          <section className="flex flex-col rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]" aria-label="Issues">
            <button
              type="button"
              aria-expanded={issuesOpen}
              onClick={() => setIssuesOpen(o => !o)}
              className="flex min-h-[2.75rem] items-center justify-between px-3 text-left transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              style={{ fontSize: '0.875rem', fontWeight: 600 }}
            >
              Issues
              {issuesOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronUp className="size-4" aria-hidden="true" />}
            </button>
            {issuesOpen ? (
              <div className="h-auto min-w-0 overflow-y-auto p-3 md:h-[18rem]">
                {selectedRow ? (
                  <IssuePanel
                    detail={detailWithRow}
                    loading={detailLoading}
                    error={detailError}
                    target={round.target as QaTarget}
                    readOnly={readOnly}
                    pagePath={selectedRow.path}
                    tab={issueTab}
                    onTabChange={setIssueTab}
                    onShow={showIssue}
                    onCreateRequest={createRequest}
                    onPatch={patch => void patchPage(selectedRow.id, patch)}
                    onRunPageSpeed={runPageSpeed}
                  />
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </div>

      {scanAll.frameSrc ? (
        <div aria-hidden="true" inert>
          {SCAN_ALL_VIEWPORTS.map(key => {
            const v = QA_VIEWPORTS.find(x => x.key === key)
            if (!v || !scanAll.frameSrc) return null
            return (
              <iframe
                key={key}
                ref={scanAll.frameRef(key)}
                title={`${v.label} scan frame`}
                src={scanAll.frameSrc[key]}
                sandbox={QA_FRAME_SANDBOX}
                referrerPolicy="no-referrer"
                tabIndex={-1}
                width={v.width}
                height={v.height}
                style={{ position: 'fixed', left: '-20000px', top: 0, width: `${v.width}px`, height: `${v.height}px`, border: 0 }}
              />
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`
}
