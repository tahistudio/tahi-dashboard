'use client'

import { useCallback, useEffect, useRef, useState, type RefCallback } from 'react'
import { viewportByWidth, type QaScanResult, type QaViewportKey } from '@/lib/qa/types'
import type { QaRoundPageRow } from './qa-types'

/** The two hidden frames that scan every page: Desktop feeds SEO and links, Mobile P feeds layout. */
export const SCAN_ALL_VIEWPORTS = ['desktop', 'mobile_p'] as const satisfies readonly QaViewportKey[]

const SCAN_TIMEOUT_MS = 25_000

interface PendingScan {
  resolve: (result: QaScanResult | null) => void
  timer: ReturnType<typeof setTimeout>
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

function isScanMessage(data: unknown): data is { type: 'qa:scan'; version: 1; viewportWidth: number; result: QaScanResult } {
  if (!data || typeof data !== 'object') return false
  const d = data as Record<string, unknown>
  return d.type === 'qa:scan' && d.version === 1 && typeof d.viewportWidth === 'number' && typeof d.result === 'object' && d.result !== null
}

export interface UseScanAllOptions {
  /** Viewer base URL from useViewToken, or null while it loads. */
  baseUrl: string | null
  /** Round pages in workspace order. */
  pages: QaRoundPageRow[]
  submitScan: (roundPageId: string, viewport: QaViewportKey, result: QaScanResult) => Promise<void>
  onError: (message: string) => void
}

export interface UseScanAllState {
  running: boolean
  done: number
  total: number
  currentPath: string | null
  start: () => void
  cancel: () => void
  /** src for each hidden frame while a run is in progress, otherwise null. */
  frameSrc: Record<(typeof SCAN_ALL_VIEWPORTS)[number], string> | null
  /** Ref callback factory for the hidden frames. */
  frameRef: (viewport: (typeof SCAN_ALL_VIEWPORTS)[number]) => RefCallback<HTMLIFrameElement>
}

/**
 * Walks every round page in order inside two hidden frames (Desktop and Mobile P),
 * waits for both scans or 25 seconds, stores each scan, and moves on. The desktop
 * scan also runs the link check inside submitScan. Cancel stops after the current
 * page. The tab must stay open while it runs (beforeunload warns).
 */
export function useScanAll({ baseUrl, pages, submitScan, onError }: UseScanAllOptions): UseScanAllState {
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(0)
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [frameSrc, setFrameSrc] = useState<UseScanAllState['frameSrc']>(null)
  const frameEls = useRef<Partial<Record<QaViewportKey, HTMLIFrameElement | null>>>({})
  const pending = useRef<Partial<Record<QaViewportKey, PendingScan>>>({})
  const cancelled = useRef(false)
  const runningRef = useRef(false)
  const viewOrigin = baseUrl ? safeOrigin(baseUrl) : null

  // Collect scans from the hidden frames only (source match plus viewer origin).
  useEffect(() => {
    if (!viewOrigin) return
    function onMessage(event: MessageEvent) {
      if (event.origin !== viewOrigin) return
      if (!isScanMessage(event.data)) return
      const key = viewportByWidth(event.data.viewportWidth)
      if (!key) return
      if (!SCAN_ALL_VIEWPORTS.some(v => v === key)) return
      const el = frameEls.current[key]
      if (!el || el.contentWindow !== event.source) return
      const waiting = pending.current[key]
      if (!waiting) return
      clearTimeout(waiting.timer)
      delete pending.current[key]
      waiting.resolve(event.data.result)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [viewOrigin])

  // Keep the tab open while a run is going.
  useEffect(() => {
    if (!running) return
    function warn(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  const settle = useCallback((vp: QaViewportKey) => {
    const waiting = pending.current[vp]
    if (!waiting) return
    clearTimeout(waiting.timer)
    delete pending.current[vp]
    waiting.resolve(null)
  }, [])

  const waitFor = useCallback((vp: QaViewportKey) => new Promise<QaScanResult | null>(resolve => {
    const timer = setTimeout(() => settle(vp), SCAN_TIMEOUT_MS)
    pending.current[vp] = { resolve, timer }
  }), [settle])

  const cancel = useCallback(() => {
    cancelled.current = true
    for (const v of SCAN_ALL_VIEWPORTS) settle(v)
  }, [settle])

  const start = useCallback(() => {
    if (runningRef.current || !baseUrl || pages.length === 0) return
    runningRef.current = true
    cancelled.current = false
    setRunning(true)
    setDone(0)

    void (async () => {
      for (let i = 0; i < pages.length; i++) {
        if (cancelled.current) break
        const page = pages[i]
        setCurrentPath(page.path)
        const src = `${baseUrl}${page.path}`
        setFrameSrc({ desktop: src, mobile_p: src })
        const waits = SCAN_ALL_VIEWPORTS.map(v => waitFor(v).then(result => ({ v, result })))
        const results = await Promise.all(waits)
        for (const { v, result } of results) {
          if (!result || cancelled.current) continue
          try {
            await submitScan(page.id, v, result)
          } catch (err) {
            onError(err instanceof Error ? `${page.path}: ${err.message}` : `${page.path}: scan could not be saved.`)
          }
        }
        setDone(i + 1)
      }
      setFrameSrc(null)
      setCurrentPath(null)
      setRunning(false)
      runningRef.current = false
    })()
  }, [baseUrl, pages, submitScan, onError, waitFor])

  useEffect(() => () => cancel(), [cancel])

  const frameRef = useCallback(
    (viewport: (typeof SCAN_ALL_VIEWPORTS)[number]): RefCallback<HTMLIFrameElement> =>
      el => {
        frameEls.current[viewport] = el
      },
    [],
  )

  return {
    running,
    done,
    total: pages.length,
    currentPath,
    start,
    cancel,
    frameSrc,
    frameRef,
  }
}
