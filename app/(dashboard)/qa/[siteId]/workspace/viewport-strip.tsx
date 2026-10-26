'use client'

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
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
const ZOOM_STORAGE_KEY = 'tahi-qa-zoom'

export type QaZoom = 'fit' | 'medium' | 'large'

const ZOOM_OPTIONS: { value: QaZoom; label: string }[] = [
  { value: 'fit', label: 'Fit all' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
]

function isZoom(v: unknown): v is QaZoom {
  return v === 'fit' || v === 'medium' || v === 'large'
}

/**
 * Shared row height (rem) for the desktop strip. Every frame uses the same height h,
 * so its column is viewport.width * h / viewport.height wide. "Fit all" takes the
 * largest h at which all five columns plus gaps fit the measured width, never below
 * the floor (the strip then scrolls sideways).
 */
export function rowRemForZoom(zoom: QaZoom, availableWidthPx: number): number {
  if (zoom === 'medium') return MEDIUM_ROW_REM
  if (zoom === 'large') return LARGE_ROW_REM
  if (availableWidthPx <= 0) return FIT_FLOOR_REM
  const gaps = FRAME_GAP_PX * (QA_VIEWPORTS.length - 1)
  const total = (rem: number) => QA_VIEWPORTS.reduce((n, v) => n + frameOuterWidthRem(v, rem) * 16, gaps)
  if (total(FIT_FLOOR_REM) >= availableWidthPx) return FIT_FLOOR_REM
  let lo = FIT_FLOOR_REM
  let hi = FIT_CEIL_REM
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (total(mid) <= availableWidthPx) lo = mid
    else hi = mid
  }
  return lo
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
  useEffect(() => {
    if (!expandedKey) return
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') setExpandedKey(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
        <div ref={containerRef} className="flex w-full justify-center overflow-hidden">
          <ViewportFrame {...frameProps(v, rowRem, true)} />
        </div>
      )
    }
  }

  const rowRem = rowRemForZoom(zoom, availableWidth)
  return (
    <div className="flex w-full min-w-0 flex-col" style={{ gap: '0.5rem' }}>
      <div className="flex flex-wrap items-center justify-end" style={{ gap: '0.5rem' }}>
        <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', fontWeight: 600 }}>Zoom</span>
        <SegmentedControl<QaZoom>
          value={zoom}
          onChange={setZoom}
          ariaLabel="Preview zoom"
          size="sm"
          options={ZOOM_OPTIONS}
        />
      </div>
      <div
        ref={containerRef}
        className="relative flex w-full min-w-0 items-start overflow-x-auto pb-2"
        style={{ gap: `${FRAME_GAP_PX}px` }}
        role="group"
        aria-label="Viewport previews"
      >
        {QA_VIEWPORTS.map(v => (
          <ViewportFrame key={v.key} {...frameProps(v, rowRem, false)} />
        ))}
      </div>
    </div>
  )
}
