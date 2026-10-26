'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import { QA_VIEWPORTS, type QaScanResult, type QaViewportKey } from '@/lib/qa/types'
import { ViewportFrame, frameOuterWidthRem, type QaViewportDef } from './viewport-frame'
import { comparablePath } from './comparable-path'
import type { QaScanState, QaTickMap } from './qa-types'

const ROW_REM = 28
const EXPANDED_MAX_REM = 52
const FRAME_GAP_PX = 16
const FIT_FLOOR_REM = 8
const FIT_CEIL_REM = 40
const MEDIUM_ROW_REM = 28
const LARGE_ROW_REM = 40
/** Share of the screen height a single mobile frame may take. */
const MOBILE_MAX_HEIGHT_SHARE = 0.7
/** Height the frame label bar takes above each frame (2.75rem bar plus the 0.25rem gap). */
const FRAME_LABEL_BAR_REM = 3
/** Bottom padding of the wide workspace, kept clear under the frames. */
const WIDE_BOTTOM_PAD_REM = 1
const ZOOM_STORAGE_KEY = 'tahi-qa-zoom'

/** Stored choice. 'fit' is the stored value for what the UI calls "Fit width". */
export type QaZoom = 'fit' | 'actual' | 'medium' | 'large'
/** The zoom choices that share one row height across all five frames. */
export type QaSharedZoom = Exclude<QaZoom, 'actual'>

const ZOOM_OPTIONS: { value: QaZoom; label: string }[] = [
  { value: 'fit', label: 'Fit width' },
  { value: 'actual', label: 'Actual size' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]

function isZoom(v: unknown): v is QaZoom {
  return v === 'fit' || v === 'actual' || v === 'medium' || v === 'large'
}

/**
 * Shared row height (rem) for the desktop strip. Every frame uses the same height h,
 * so its column is viewport.width * h / viewport.height wide. "Fit width" takes the
 * largest h at which all five columns plus gaps fit the measured width, never above
 * `ceilingRem` (40rem by default; wide mode passes the height cap) and never below
 * the floor (the strip then scrolls sideways).
 */
export function rowRemForZoom(zoom: QaSharedZoom, availableWidthPx: number, ceilingRem: number = FIT_CEIL_REM): number {
  // Medium and large honour the ceiling too, so wide mode never needs a vertical scroll to reach a frame bottom.
  const fixedCeiling = Math.max(FIT_FLOOR_REM, ceilingRem)
  if (zoom === 'medium') return Math.min(MEDIUM_ROW_REM, fixedCeiling)
  if (zoom === 'large') return Math.min(LARGE_ROW_REM, fixedCeiling)
  if (availableWidthPx <= 0) return FIT_FLOOR_REM
  const gaps = FRAME_GAP_PX * (QA_VIEWPORTS.length - 1)
  const total = (rem: number) => QA_VIEWPORTS.reduce((n, v) => n + frameOuterWidthRem(v, rem) * 16, gaps)
  if (total(FIT_FLOOR_REM) >= availableWidthPx) return FIT_FLOOR_REM
  let lo = FIT_FLOOR_REM
  let hi = Math.max(FIT_FLOOR_REM, ceilingRem)
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (total(mid) <= availableWidthPx) lo = mid
    else hi = mid
  }
  return lo
}

/** Pixels the five frames need side by side at scale 1, gaps included. */
export function actualSizeWidthPx(): number {
  const widths = QA_VIEWPORTS.reduce((n, v) => n + v.width, 0)
  return widths + FRAME_GAP_PX * (QA_VIEWPORTS.length - 1)
}

/** True when the measured strip width holds all five frames at scale 1. Unmeasured (0) never fits. */
export function actualSizeFits(availableWidthPx: number): boolean {
  return availableWidthPx > 0 && availableWidthPx >= actualSizeWidthPx()
}

/** Row height (rem) that renders one frame at scale exactly 1: its real pixel height. */
export function actualRowRem(viewport: QaViewportDef): number {
  return viewport.height / 16
}

/**
 * Row height cap (rem) for wide mode: the space from the frames' top edge to the
 * bottom of the window, less the frame label bar and the workspace bottom padding.
 */
export function wideRowCapRem(stripTopPx: number, windowHeightPx: number): number {
  return (windowHeightPx - stripTopPx) / 16 - FRAME_LABEL_BAR_REM - WIDE_BOTTOM_PAD_REM
}

export interface ViewportStripProps {
  /** Dashboard-side origin of the QA viewer, e.g. https://qa-view.example.workers.dev */
  baseUrl: string
  /** Path of the page being viewed, starting with "/". */
  path: string
  scanStates: Record<QaViewportKey, QaScanState>
  ticks: QaTickMap
  readOnly: boolean
  onTick: (viewport: QaViewportKey, value: boolean) => void
  /** Called for a scan from one of the visible frames. Never called on a closed round. */
  onScan: (viewport: QaViewportDef, result: QaScanResult) => void
  /** A frame finished loading its page (any viewport). */
  onFrameLoad?: (viewport: QaViewportKey) => void
  /** Filled with the visible frames so the parent can postMessage to them. */
  framesRef: MutableRefObject<Partial<Record<QaViewportKey, HTMLIFrameElement | null>>>
  /** Which viewport the single-frame mobile switcher shows. */
  mobileViewport: QaViewportKey
  onMobileViewportChange: (key: QaViewportKey) => void
  /** Single-frame layout, decided by the workspace's measured width. */
  singleFrame: boolean
  /** Wide mode is on (the workspace has taken over the window). Caps the fit row to the window height. */
  wide: boolean
  /** Toggles wide mode. The Wide button is hidden in the single-frame layout. */
  onWideChange: (next: boolean) => void
  /** Viewport whose frame is in comment mode, if any. */
  commentViewport: QaViewportKey | null
  /** Turns comment mode on for a frame, or off when it is already on. */
  onCommentToggle: (viewport: QaViewportKey) => void
  /** The expanded frame changed (a frame expanded, collapsed or switched). */
  onExpandedChange?: (viewport: QaViewportKey | null) => void
}

function isScanMessage(data: unknown): data is { type: 'qa:scan'; version: 1; url: string; viewportWidth: number; result: QaScanResult } {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return d.type === 'qa:scan' && d.version === 1 && typeof d.url === 'string' && typeof d.viewportWidth === 'number' && typeof d.result === 'object' && d.result !== null
}

/** Short switcher labels for narrow widths, so five options stay distinguishable. */
const SHORT_LABEL: Record<QaViewportKey, string> = { xl: 'XL', desktop: 'Desk', tablet: 'Tab', mobile_l: 'ML', mobile_p: 'MP' }
/** Below this switcher width (px) the short labels are used. */
const SHORT_LABEL_BELOW_PX = 560

export function ViewportStrip({
  baseUrl,
  path,
  scanStates,
  ticks,
  readOnly,
  onTick,
  onScan,
  onFrameLoad,
  framesRef,
  mobileViewport,
  onMobileViewportChange,
  singleFrame,
  wide,
  onWideChange,
  commentViewport,
  onCommentToggle,
  onExpandedChange,
}: ViewportStripProps) {
  const viewOrigin = useMemo(() => {
    try {
      return new URL(baseUrl).origin
    } catch {
      return null
    }
  }, [baseUrl])
  const isMobile = singleFrame
  const [expandedKey, setExpandedKey] = useState<QaViewportKey | null>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [screenHeight, setScreenHeight] = useState(0)
  const [zoom, setZoomState] = useState<QaZoom>('fit')
  const [wideCapRem, setWideCapRem] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const pathRef = useRef(path)
  pathRef.current = path
  const readOnlyRef = useRef(readOnly)
  readOnlyRef.current = readOnly

  // Restore the saved zoom after mount so server and client markup match.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(ZOOM_STORAGE_KEY)
      if (isZoom(saved)) setZoomState(saved)
    } catch {
      // Storage can be blocked; the default stands.
    }
  }, [])

  function setZoom(next: QaZoom) {
    setZoomState(next)
    try {
      window.localStorage.setItem(ZOOM_STORAGE_KEY, next)
    } catch {
      // Not persisted; the choice still applies for this visit.
    }
  }

  useEffect(() => {
    const update = () => setScreenHeight(window.innerHeight)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Measure the strip so frames can be fitted to the width on offer.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 0
      setAvailableWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isMobile, expandedKey])

  // Scan results: only from our own frames, only from the viewer origin.
  useEffect(() => {
    if (!viewOrigin) return
    function onMessage(event: MessageEvent) {
      if (event.origin !== viewOrigin) return
      if (!isScanMessage(event.data)) return
      // A closed round never stores scans.
      if (readOnlyRef.current) return
      // Map the scan to our own frame by its window, never by the width the page claims.
      const viewport = QA_VIEWPORTS.find(v => {
        const frame = framesRef.current[v.key]
        return frame !== null && frame !== undefined && frame.contentWindow === event.source
      })
      if (!viewport) return
      // A frame can finish scanning the previous page just after the user moves
      // on; that late result must not be filed against the new page.
      if (comparablePath(event.data.url) !== comparablePath(pathRef.current)) return
      onScanRef.current(viewport, event.data.result)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [viewOrigin, framesRef])

  // Escape leaves expanded mode (unless something else already used the key).
  // Claiming the key here stops the workspace's Escape handler from leaving wide mode too.
  useEffect(() => {
    if (!expandedKey) return
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (e.key !== 'Escape') return
      e.preventDefault()
      setExpandedKey(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expandedKey])

  // In wide mode, cap the fit row so every frame ends above the bottom of the window.
  // Re-measured when the window height, the measured width, the layout or the page
  // changes (a toolbar that wraps moves the frames' top edge along with those).
  useLayoutEffect(() => {
    if (!wide) return
    const el = containerRef.current
    if (!el) return
    const cap = wideRowCapRem(el.getBoundingClientRect().top, window.innerHeight)
    setWideCapRem(prev => (prev === cap ? prev : cap))
  }, [wide, screenHeight, availableWidth, isMobile, expandedKey, path])

  const onExpandedChangeRef = useRef(onExpandedChange)
  onExpandedChangeRef.current = onExpandedChange
  useEffect(() => {
    onExpandedChangeRef.current?.(expandedKey)
  }, [expandedKey])

  // Leave expanded mode when the path changes or the layout switches to mobile.
  useEffect(() => {
    setExpandedKey(null)
  }, [path, isMobile])

  const src = `${baseUrl}${path}`

  function frameProps(v: QaViewportDef, rowHeightRem: number, expanded: boolean) {
    return {
      viewport: v,
      src,
      rowHeightRem,
      ticked: ticks[v.key],
      onTick: (value: boolean) => onTick(v.key, value),
      scanState: scanStates[v.key],
      expanded,
      onExpand: () => setExpandedKey(expanded ? null : v.key),
      readOnly,
      commenting: commentViewport === v.key,
      onCommentToggle: () => onCommentToggle(v.key),
      onLoad: () => onFrameLoad?.(v.key),
      frameRef: (el: HTMLIFrameElement | null) => {
        framesRef.current[v.key] = el
      },
    }
  }

  if (isMobile) {
    const v = QA_VIEWPORTS.find(x => x.key === mobileViewport) ?? QA_VIEWPORTS[1]
    // One frame scaled to the width on offer, but never taller than about 70svh.
    const heightPx = (screenHeight > 0 ? screenHeight : 800) * MOBILE_MAX_HEIGHT_SHARE
    const scale = availableWidth > 0 ? Math.min(availableWidth / v.width, heightPx / v.height) : 0
    const rowRem = (v.height * scale) / 16
    return (
      <div className="flex w-full min-w-0 flex-col" style={{ gap: '0.75rem' }} ref={containerRef}>
        <SegmentedControl<QaViewportKey>
          value={v.key}
          onChange={onMobileViewportChange}
          ariaLabel="Viewport"
          fill
          options={QA_VIEWPORTS.map(x => (
            availableWidth > 0 && availableWidth < SHORT_LABEL_BELOW_PX
              ? { value: x.key, label: SHORT_LABEL[x.key], title: `${x.label} (${x.width}px)` }
              : { value: x.key, label: x.label }
          ))}
        />
        {scale > 0 ? (
          <ViewportFrame key={v.key} {...frameProps(v, rowRem, false)} columnWidthRem={availableWidth / 16} />
        ) : null}
      </div>
    )
  }

  if (expandedKey) {
    const v = QA_VIEWPORTS.find(x => x.key === expandedKey)
    if (v) {
      const scaleFit = availableWidth > 0 ? availableWidth / v.width : 0
      const rowRem = scaleFit > 0 ? Math.min(EXPANDED_MAX_REM, (v.height * scaleFit) / 16) : ROW_REM
      return (
        <div ref={containerRef} data-qa-expanded="true" className="flex w-full justify-center overflow-hidden">
          <ViewportFrame {...frameProps(v, rowRem, true)} />
        </div>
      )
    }
  }

  // "Actual size" only exists while all five frames fit the measured width at scale 1.
  // A saved choice that no longer fits renders as Fit width; the saved value is left alone.
  const canActual = actualSizeFits(availableWidth)
  const effectiveZoom: QaZoom = zoom === 'actual' && !canActual ? 'fit' : zoom
  const zoomOptions = canActual ? ZOOM_OPTIONS : ZOOM_OPTIONS.filter(o => o.value !== 'actual')
  const sharedZoom: QaSharedZoom = effectiveZoom === 'actual' ? 'fit' : effectiveZoom
  const ceilingRem = wide && wideCapRem !== null ? wideCapRem : FIT_CEIL_REM
  const sharedRowRem = rowRemForZoom(sharedZoom, availableWidth, ceilingRem)
  const rowRemFor = (v: QaViewportDef) => (effectiveZoom === 'actual' ? actualRowRem(v) : sharedRowRem)
  return (
    <div className="flex w-full min-w-0 flex-col" style={{ gap: '0.5rem' }}>
      <div className="flex flex-wrap items-center justify-end" style={{ gap: '0.5rem' }}>
        <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Zoom</span>
        <SegmentedControl<QaZoom>
          value={effectiveZoom}
          onChange={setZoom}
          ariaLabel="Preview zoom"
          size="sm"
          options={zoomOptions}
        />
        <button
          type="button"
          onClick={() => onWideChange(!wide)}
          aria-pressed={wide}
          className="flex min-h-[2.75rem] items-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-3 text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
          style={{ gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600 }}
        >
          {wide ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
          {wide ? 'Exit wide' : 'Wide'}
        </button>
      </div>
      <div
        ref={containerRef}
        className="relative flex w-full min-w-0 items-start overflow-x-auto pb-2"
        style={{ gap: `${FRAME_GAP_PX}px` }}
        role="group"
        aria-label="Viewport previews"
      >
        {QA_VIEWPORTS.map(v => (
          <ViewportFrame key={v.key} {...frameProps(v, rowRemFor(v), false)} />
        ))}
      </div>
    </div>
  )
}
