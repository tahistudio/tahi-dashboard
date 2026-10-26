'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { lockBodyScroll, overlayLayers } from '@/components/tahi/overlay-stack'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Layers, ListChecks } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { TahiButton } from '@/components/tahi/tahi-button'
import { EmptyState } from '@/components/tahi/empty-state'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { SlideOver } from '@/components/tahi/slide-over'
import {
  QA_VIEWPORTS,
  type QaCommentModeMessage,
  type QaElementContext,
  type QaFocusPinMessage,
  type QaHighlightMessage,
  type QaIssue,
  type QaPinsMessage,
  type QaRescanMessage,
  type QaScanResult,
  type QaTarget,
  type QaViewportKey,
} from '@/lib/qa/types'
import { QA_RAIL_COLLAPSE_REM, QA_SINGLE_FRAME_REM, narrowerThanRem, useWorkspaceWidth } from './use-workspace-width'
import { useRound, type QaPagePatch } from './use-round'
import { useViewToken } from './use-view-token'
import { useScanAll, SCAN_ALL_VIEWPORTS } from './scan-all'
import { PageRail, filterPages, type QaRailFilter } from './page-rail'
import { ViewportStrip } from './viewport-strip'
import { QA_FRAME_SANDBOX, type QaViewportDef } from './viewport-frame'
import { IssuePanel, type IssuePanelTab } from './issue-panel'
import { CommentComposer } from './comment-composer'
import { useComments } from './use-comments'
import { comparablePath } from './comparable-path'
import {
  composerHasDraft,
  composerPlacement,
  pickAction,
  parseEscapeMessage,
  parseModeChangedMessage,
  parsePickMessage,
  parsePinClickMessage,
  viewportForSource,
  type NumberedComment,
} from './comments-helpers'
import { RoundActions } from './round-actions'
import type { CreateRequestInput } from './create-request-dialog'
import type { QaRoundPageDetail, QaRoundPageRow, QaRoundRow, QaScanState, QaSiteRow, QaTickMap } from './qa-types'
import { tickCount, ticksFor } from './qa-types'

const LOADING_SCAN_MS = 20_000
/** Quiet period after the last scan before the issues for the page are reloaded once. */
const DETAIL_DEBOUNCE_MS = 600
/** Wait after a frame loads before sending it a highlight, so the scanner has attached. */
const HIGHLIGHT_AFTER_LOAD_MS = 300
/** Pins are sent again this long after a frame loads, for pages that render their elements late. */
const LATE_PINS_MS = 2000
/** A queued pin focus waits this long after the pins go out, so the pin exists to pulse. */
const FOCUS_AFTER_PINS_MS = 400
/** Above the wide workspace (40), below the SlideOver scrim (60). */
const COMPOSER_Z_INDEX = 55
const MOBILE_DEFAULT: QaViewportKey = 'desktop'
const WIDE_STORAGE_KEY = 'tahi-qa-wide'
/**
 * Stacking level of the wide workspace. The dashboard chrome (sidebar, top nav) sets
 * no z-index, so 40 sits above it. The overlay primitives sit above this: SlideOver
 * scrim 60 and panel 70, ConfirmDialog and PromptDialog 70, Popover 1000 (portalled),
 * toasts 50000. Wide mode is not an overlay and registers nothing.
 */
export const QA_WIDE_Z_INDEX = 40
const WIDE_SECTION_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  overflow: 'auto',
  background: 'var(--color-bg-cream)',
  padding: '1rem',
  zIndex: QA_WIDE_Z_INDEX,
}

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

/** Like overlayOpen, but the comment composer does not count (it handles Escape itself, first). */
function otherOverlayOpen(): boolean {
  return overlayLayers.size() > 0 || document.querySelector('[role="dialog"]:not([data-qa-composer])') !== null
}

type FrameMessage = QaRescanMessage | QaHighlightMessage | QaCommentModeMessage | QaPinsMessage | QaFocusPinMessage

/** A picked element waiting for its comment text, plus where the card sits. */
interface ComposerState {
  /** Changes on every pick so a fresh pick starts with an empty textarea. */
  key: number
  viewport: QaViewportKey
  selector: string
  ox: number
  oy: number
  tag: string
  text: string
  /** Where the element sits, from the frame. Absent when the scanner is older. */
  context?: QaElementContext
  left: number
  top: number
  width: number
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
  // Wide mode is the user's saved choice; it only takes effect on the desktop layout.
  const [wide, setWide] = useState(false)
  const wideActive = wide && !isMobile
  const [issuesDrawerOpen, setIssuesDrawerOpen] = useState(false)
  const closeIssuesDrawer = useCallback(() => setIssuesDrawerOpen(false), [])
  const [issueTab, setIssueTab] = useState<IssuePanelTab>('a11y')
  const [commentViewport, setCommentViewport] = useState<QaViewportKey | null>(null)
  const commentViewportRef = useRef<QaViewportKey | null>(null)
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const composerRef = useRef<ComposerState | null>(null)
  composerRef.current = composer
  const composerKey = useRef(0)
  const composerDraft = useRef('')
  const [composerPulse, setComposerPulse] = useState(0)
  const handleDraftChange = useCallback((text: string) => {
    composerDraft.current = text
  }, [])
  const [selectedCommentId, setSelectedCommentId] = useState<string | null>(null)
  // Pin focus waiting for its frame to load, one per viewport.
  const pendingFocus = useRef<Partial<Record<QaViewportKey, string>>>({})
  const expandedRef = useRef<QaViewportKey | null>(null)
  const frameTimers = useRef<number[]>([])
  // Frames that have finished loading their page. Before that a frame is still the blank
  // document of the dashboard's own origin, which would refuse a message for the viewer origin.
  const loadedFrames = useRef(new WeakSet<HTMLIFrameElement>())
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
    for (const t of frameTimers.current) window.clearTimeout(t)
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
  const postToFrames = useCallback((message: FrameMessage, key?: QaViewportKey) => {
    if (!viewOrigin) return
    const keys = key ? [key] : QA_VIEWPORTS.map(v => v.key)
    for (const k of keys) {
      framesRef.current[k]?.contentWindow?.postMessage(message, viewOrigin)
    }
  }, [viewOrigin])

  const comments = useComments(selectedId, readOnly)
  const pinsForRef = useRef(comments.pinsFor)
  pinsForRef.current = comments.pinsFor
  // Latest values for the message listener, so it subscribes once.
  const latest = useRef({ path: selectedRow?.path ?? '', readOnly, wideActive: false, comments: comments.comments })
  latest.current = { path: selectedRow?.path ?? '', readOnly, wideActive, comments: comments.comments }

  const frameLoaded = useCallback((key: QaViewportKey) => {
    const el = framesRef.current[key]
    return el !== null && el !== undefined && loadedFrames.current.has(el)
  }, [])

  const sendPins = useCallback((key?: QaViewportKey) => {
    const keys = key ? [key] : QA_VIEWPORTS.map(v => v.key)
    for (const k of keys) {
      if (frameLoaded(k)) postToFrames({ type: 'qa:pins', pins: pinsForRef.current(k) }, k)
    }
  }, [postToFrames, frameLoaded])

  // Whenever the comments change, redraw the pins in every visible frame.
  useEffect(() => {
    sendPins()
  }, [comments.pinsFor, sendPins])

  /** One frame at a time is in comment mode; null turns it off everywhere. Closes the composer. */
  const applyCommentViewport = useCallback((next: QaViewportKey | null, keepComposer = false) => {
    const prev = commentViewportRef.current
    if (prev === next) return
    // A frame that is still loading gets comment mode when it finishes (see handleFrameLoad).
    if (prev && frameLoaded(prev)) postToFrames({ type: 'qa:comment-mode', on: false }, prev)
    if (next && frameLoaded(next)) postToFrames({ type: 'qa:comment-mode', on: true }, next)
    commentViewportRef.current = next
    setCommentViewport(next)
    if (!keepComposer) setComposer(null)
  }, [postToFrames, frameLoaded])

  // A new page reloads every frame, so comment mode, the composer and the selection start clean.
  useEffect(() => {
    applyCommentViewport(null)
    setComposer(null)
    setSelectedCommentId(null)
    pendingFocus.current = {}
  }, [selectedId, applyCommentViewport])

  // A closed round takes no new comments.
  useEffect(() => {
    if (readOnly) applyCommentViewport(null)
  }, [readOnly, applyCommentViewport])

  const handleExpandedChange = useCallback((key: QaViewportKey | null) => {
    const prev = expandedRef.current
    expandedRef.current = key
    if (prev === key) return
    // Frames remount on expand and collapse, so a card anchored to the old one has nothing to sit on.
    setComposer(null)
    if (key && commentViewportRef.current && commentViewportRef.current !== key) applyCommentViewport(null)
  }, [applyCommentViewport])

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
    const later = (fn: () => void, ms: number) => {
      frameTimers.current.push(window.setTimeout(fn, ms))
    }
    const el = framesRef.current[key]
    if (el) loadedFrames.current.add(el)
    if (pendingHighlights.current[key]) later(() => flushHighlight(key), HIGHLIGHT_AFTER_LOAD_MS)
    // A reloaded frame has lost comment mode and its pins, so send both again.
    later(() => {
      if (commentViewportRef.current === key) postToFrames({ type: 'qa:comment-mode', on: true }, key)
      sendPins(key)
      const focusId = pendingFocus.current[key]
      if (focusId) {
        delete pendingFocus.current[key]
        later(() => postToFrames({ type: 'qa:focus-pin', id: focusId }, key), FOCUS_AFTER_PINS_MS)
      }
    }, HIGHLIGHT_AFTER_LOAD_MS)
    later(() => sendPins(key), LATE_PINS_MS)
  }, [flushHighlight, postToFrames, sendPins])

  // Messages from the frames about comments. Same rules as the scan listener: the
  // viewer origin only, the frame found by its window (never a claimed viewport).
  useEffect(() => {
    if (!viewOrigin) return
    function onMessage(event: MessageEvent) {
      if (event.origin !== viewOrigin) return
      const pick = parsePickMessage(event.data)
      const click = pick ? null : parsePinClickMessage(event.data)
      const changed = pick || click ? null : parseModeChangedMessage(event.data)
      const escape = pick || click || changed ? null : parseEscapeMessage(event.data)
      if (!pick && !click && !changed && !escape) return
      const key = viewportForSource(framesRef.current, event.source)
      if (!key) return

      if (escape) {
        // Focus inside a frame swallows Esc. Replay it on the window so the same ladder runs:
        // composer, comment mode, expanded frame, then wide mode. A dialog or slide-over wins.
        // Only while that frame has focus, so a page cannot peel layers (and drop a draft) on its own.
        if (document.activeElement !== framesRef.current[key]) return
        if (otherOverlayOpen()) return
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        return
      }

      if (changed) {
        // Esc inside the frame turned comment mode off there. A card with typed text stays open.
        if (!changed.on && commentViewportRef.current === key) {
          applyCommentViewport(null, composerHasDraft(composerDraft.current) && composerRef.current !== null)
        }
        return
      }
      if (click) {
        const hit = latest.current.comments.find(c => c.id === click.id && c.viewport === key)
        if (!hit) return
        setSelectedCommentId(hit.id)
        setIssueTab('comments')
        if (latest.current.wideActive) setIssuesDrawerOpen(true)
        else setIssuesOpen(true)
        return
      }
      if (pick) {
        // Only the frame in comment mode counts, on an open round, for the page on screen.
        if (latest.current.readOnly || commentViewportRef.current !== key) return
        if (comparablePath(pick.url) !== comparablePath(latest.current.path)) return
        const rect = framesRef.current[key]?.getBoundingClientRect()
        if (!rect) return
        if (pickAction(composerRef.current !== null, composerDraft.current) === 'ignore') {
          setComposerPulse(n => n + 1)
          return
        }
        composerKey.current += 1
        setComposer({
          key: composerKey.current,
          viewport: key,
          selector: pick.selector,
          ox: pick.ox,
          oy: pick.oy,
          tag: pick.tag,
          text: pick.text,
          context: pick.context,
          ...composerPlacement(rect, window.innerWidth, window.innerHeight),
        })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [viewOrigin, applyCommentViewport])

  // Keep the composer on screen when the window resizes or scrolls.
  const composerViewport = composer?.viewport ?? null
  useEffect(() => {
    if (!composerViewport) return
    function reposition() {
      if (!composerViewport) return
      const rect = framesRef.current[composerViewport]?.getBoundingClientRect()
      if (!rect) return
      const next = composerPlacement(rect, window.innerWidth, window.innerHeight)
      setComposer(c => (c && c.viewport === composerViewport && (c.left !== next.left || c.top !== next.top || c.width !== next.width) ? { ...c, ...next } : c))
    }
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [composerViewport])

  const onScanError = useCallback((message: string) => showToast(message, 'error'), [showToast])
  const scanAll = useScanAll({ baseUrl, pages, submitScan, onError: onScanError })

  function rescan() {
    postToFrames({ type: 'qa:rescan' })
  }

  /** Switches the single frame shown on small screens; the frame in comment mode may be the one leaving. */
  function changeMobileViewport(key: QaViewportKey) {
    setMobileViewport(key)
    if (commentViewportRef.current && commentViewportRef.current !== key) applyCommentViewport(null)
  }

  function showIssue(issue: QaIssue) {
    if (!issue.selector) return
    const key: QaViewportKey = issue.viewport ?? 'desktop'
    if (isMobile && mobileViewport !== key) {
      // The other frame has not loaded yet; queue until it loads or scans.
      pendingHighlights.current[key] = issue.selector
      changeMobileViewport(key)
      return
    }
    postToFrames({ type: 'qa:highlight', selector: issue.selector }, key)
  }

  function showComment(comment: NumberedComment) {
    setSelectedCommentId(comment.id)
    const key = comment.viewport
    if (isMobile && mobileViewport !== key) {
      // The frame for that viewport is not mounted yet; focus the pin once it loads.
      pendingFocus.current[key] = comment.id
      changeMobileViewport(key)
      return
    }
    postToFrames({ type: 'qa:focus-pin', id: comment.id }, key)
  }

  function toggleCommentViewport(key: QaViewportKey) {
    applyCommentViewport(commentViewportRef.current === key ? null : key)
  }

  async function saveComment(body: string) {
    if (!composer) return
    await comments.add({
      viewport: composer.viewport,
      selector: composer.selector,
      ox: composer.ox,
      oy: composer.oy,
      elementTag: composer.tag,
      elementText: composer.text,
      elementContext: composer.context,
      body,
    })
    // Comment mode stays on for the next pick.
    setComposer(null)
  }

  async function resolveComment(id: string, resolved: boolean) {
    try {
      await comments.update(id, { status: resolved ? 'resolved' : 'open' })
    } catch {
      // The hook already rolled back and toasted.
    }
  }

  async function deleteComment(id: string) {
    await comments.remove(id)
    setSelectedCommentId(current => (current === id ? null : current))
  }

  async function createRequestFromComment(comment: NumberedComment, input: CreateRequestInput): Promise<string> {
    const requestId = await postCreateRequest(comment.viewport, input)
    try {
      await comments.update(comment.id, { requestId })
    } catch {
      // The request exists; the hook toasted that the link to the comment was not saved.
    }
    return requestId
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

  // Restore the saved wide choice after mount so server and client markup match.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(WIDE_STORAGE_KEY) === 'true') setWide(true)
    } catch {
      // Storage can be blocked; wide mode stays off.
    }
  }, [])

  const storeWide = useCallback((next: boolean) => {
    setWide(next)
    try {
      window.localStorage.setItem(WIDE_STORAGE_KEY, next ? 'true' : 'false')
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }, [])

  // The wide workspace owns the window, so the page underneath must not scroll.
  useEffect(() => {
    if (!wideActive) return
    const unlock = lockBodyScroll()
    // Lets globals.css hide the floating feedback ball, which would sit over the wide workspace.
    document.body.dataset.qaWide = 'true'
    return () => {
      delete document.body.dataset.qaWide
      unlock()
    }
  }, [wideActive])

  // Escape peels one layer at a time: an open comment card, then comment mode, then an
  // expanded frame, then wide mode. Each layer calls preventDefault so the layers below
  // (and the expanded frame's own handler in ViewportStrip, which registers later) skip
  // the same key press. The card also handles Escape itself while its textarea has focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.key !== 'Escape') return
      if (otherOverlayOpen()) return
      if (composerRef.current) {
        e.preventDefault()
        setComposer(null)
        return
      }
      if (commentViewportRef.current) {
        e.preventDefault()
        applyCommentViewport(null)
        return
      }
      if (!wideActive) return
      if (document.querySelector('[data-qa-expanded="true"]') !== null) return
      e.preventDefault()
      storeWide(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wideActive, storeWide, applyCommentViewport])

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

  async function postCreateRequest(viewport: QaViewportKey | undefined, input: CreateRequestInput): Promise<string> {
    if (!selectedRow) throw new Error('No page selected.')
    const res = await fetch(apiPath(`/api/admin/qa/round-pages/${selectedRow.id}/create-request`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: input.title, description: input.description, viewport }),
    })
    if (!res.ok) throw new Error(await errorText(res))
    const json = (await res.json()) as { requestId?: string }
    if (!json.requestId) throw new Error('The request was created but no id came back.')
    return json.requestId
  }

  async function createRequest(issue: QaIssue, input: CreateRequestInput): Promise<string> {
    const requestId = await postCreateRequest(issue.viewport, input)
    await reloadDetail()
    return requestId
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

  // Shared by the inline Issues section and the wide-mode drawer.
  const issuePanel = selectedRow ? (
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
      comments={{
        items: comments.comments,
        loading: comments.loading,
        error: comments.error,
        selectedId: selectedCommentId,
        onSelect: setSelectedCommentId,
        onShow: showComment,
        onResolve: resolveComment,
        onEdit: (id, body) => comments.update(id, { body }),
        onDelete: deleteComment,
        onCreateRequest: createRequestFromComment,
      }}
    />
  ) : null
  // The page rail is a sheet on the single-frame layout and in wide mode.
  const railAsSheet = isMobile || wideActive

  return (
    <section
      ref={workspaceRef}
      aria-label={`${round.name} workspace`}
      className="flex min-w-0 flex-col"
      style={wideActive ? { ...WIDE_SECTION_STYLE, gap: '1rem' } : { gap: '1rem' }}
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3" style={{ gap: '0.5rem' }}>
        <div className="flex min-w-0 flex-wrap items-center" style={{ gap: '0.5rem' }}>
          {railAsSheet ? (
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
          {wideActive ? (
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={issuesDrawerOpen}
              onClick={() => setIssuesDrawerOpen(true)}
              className="flex min-h-[2.75rem] items-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] px-3 transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              style={{ gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600 }}
            >
              <ListChecks className="size-4" aria-hidden="true" />
              Issues
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
          singleFrame={railAsSheet}
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
              <div className="flex min-w-0 flex-wrap items-center" style={{ gap: '0 0.75rem' }} role="group" aria-label="Viewport ticks">
                {QA_VIEWPORTS.map(v => (
                  <label key={v.key} className="flex min-h-[2.75rem] items-center whitespace-nowrap text-[var(--color-text)]" style={{ gap: '0.25rem', fontSize: '0.75rem' }}>
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
              onMobileViewportChange={changeMobileViewport}
              singleFrame={isMobile}
              wide={wideActive}
              onWideChange={storeWide}
              commentViewport={commentViewport}
              onCommentToggle={toggleCommentViewport}
              onExpandedChange={handleExpandedChange}
            />
          ) : (
            <p className="text-[var(--color-text-muted)]" style={{ fontSize: '0.875rem' }}>No pages in this round yet.</p>
          )}
          {wideActive ? null : (
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
                <div className="h-auto min-w-0 overflow-y-auto p-3 md:h-[18rem]">{issuePanel}</div>
              ) : null}
            </section>
          )}
        </div>
      </div>

      {/* Renders nothing unless wide mode is on, so a stale open flag never shows the drawer. */}
      <SlideOver
        open={wideActive && issuesDrawerOpen}
        onClose={closeIssuesDrawer}
        title="Issues"
        maxWidth="min(32rem, 100vw)"
      >
        <SlideOver.Body>{issuePanel}</SlideOver.Body>
      </SlideOver>

      {composer && typeof document !== 'undefined'
        ? createPortal(
            <CommentComposer
              key={composer.key}
              open
              viewportLabel={QA_VIEWPORTS.find(v => v.key === composer.viewport)?.label ?? composer.viewport}
              elementTag={composer.tag}
              elementText={composer.text}
              onSave={saveComment}
              onCancel={() => setComposer(null)}
              onDraftChange={handleDraftChange}
              pulseSignal={composerPulse}
              style={{
                position: 'fixed',
                left: composer.left,
                top: composer.top,
                width: composer.width,
                maxHeight: 'calc(100vh - 1rem)',
                overflowY: 'auto',
                zIndex: COMPOSER_Z_INDEX,
              }}
            />,
            document.body,
          )
        : null}

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
