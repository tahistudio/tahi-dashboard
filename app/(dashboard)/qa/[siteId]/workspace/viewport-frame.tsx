'use client'

import type { QaViewportKey } from '@/lib/qa/types'
import { QA_VIEWPORTS } from '@/lib/qa/types'
import type { QaScanState } from './qa-types'

export type QaViewportDef = (typeof QA_VIEWPORTS)[number]

export const QA_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-popups'

const SCAN_LABEL: Record<QaScanState, string> = {
  loading: 'Scanning',
  scanned: 'Scanned',
  no_scan: 'No scan',
  failed: 'Failed',
}

const SCAN_DOT: Record<QaScanState, string> = {
  loading: 'var(--color-text-subtle)',
  scanned: 'var(--color-success)',
  no_scan: 'var(--color-warning)',
  failed: 'var(--color-danger)',
}

/** Scale factor that maps a viewport's real height onto a row height in rem. */
export function frameScale(viewport: QaViewportDef, rowHeightRem: number): number {
  return (rowHeightRem * 16) / viewport.height
}

/** Narrowest a frame's column gets, so the label bar and its controls stay usable. */
export const MIN_FRAME_REM = 6

/** Width of the whole column (label bar plus frame) for a given row height. */
export function frameOuterWidthRem(viewport: QaViewportDef, rowHeightRem: number): number {
  return Math.max(MIN_FRAME_REM, (viewport.width * frameScale(viewport, rowHeightRem)) / 16)
}

export interface ViewportFrameProps {
  viewport: QaViewportDef
  src: string
  /** Height of the shared row in rem. Width follows from the viewport aspect ratio. */
  rowHeightRem: number
  ticked: boolean
  onTick: (value: boolean) => void
  scanState: QaScanState
  expanded: boolean
  onExpand: () => void
  frameRef: (el: HTMLIFrameElement | null) => void
  readOnly?: boolean
  onLoad?: () => void
  /** Overrides the column width (mobile: the label bar spans the whole screen width). */
  columnWidthRem?: number
}

export function ViewportFrame({
  viewport,
  src,
  rowHeightRem,
  ticked,
  onTick,
  scanState,
  expanded,
  onExpand,
  frameRef,
  readOnly = false,
  onLoad,
  columnWidthRem,
}: ViewportFrameProps) {
  const scale = frameScale(viewport, rowHeightRem)
  const boxWidthRem = (viewport.width * scale) / 16
  const outerWidthRem = columnWidthRem ?? frameOuterWidthRem(viewport, rowHeightRem)
  const compact = outerWidthRem < 12
  const label = viewport.label

  return (
    <div
      data-viewport={viewport.key as QaViewportKey}
      className="flex shrink-0 flex-col"
      style={{ width: `${outerWidthRem}rem`, gap: '0.25rem' }}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between" style={{ gap: '0.25rem' }}>
        <label
          className="flex min-h-[2.75rem] cursor-pointer items-center text-[var(--color-text)] hover:text-[var(--color-brand-dark)] focus-within:text-[var(--color-brand-dark)]"
          style={{ gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600 }}
        >
          <input
            type="checkbox"
            checked={ticked}
            disabled={readOnly}
            onChange={e => onTick(e.target.checked)}
            className="size-4 accent-[var(--color-brand)] disabled:cursor-not-allowed"
          />
          <span className="truncate">{label}</span>
          {compact ? null : (
            <span className="text-[var(--color-text-muted)]" style={{ fontWeight: 400 }}>
              {viewport.width}px
            </span>
          )}
        </label>
        <div className="flex items-center" style={{ gap: '0.5rem' }}>
          <span className="flex items-center text-[var(--color-text-muted)]" style={{ gap: '0.25rem', fontSize: '0.75rem' }}>
            <span
              aria-hidden="true"
              className="inline-block rounded-full"
              style={{ width: '0.5rem', height: '0.5rem', background: SCAN_DOT[scanState] }}
            />
            {compact ? <span className="sr-only">{SCAN_LABEL[scanState]}</span> : SCAN_LABEL[scanState]}
          </span>
          <button
            type="button"
            onClick={onExpand}
            aria-label={expanded ? `Collapse ${label} preview` : `Expand ${label} preview`}
            aria-pressed={expanded}
            className="flex min-h-[2.75rem] min-w-[2.75rem] items-center justify-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
            style={{ fontSize: '0.75rem' }}
          >
            {expanded ? 'Exit' : compact ? 'Max' : 'Expand'}
          </button>
        </div>
      </div>
      <div
        className="relative mx-auto overflow-hidden rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]"
        style={{ width: `${boxWidthRem}rem`, height: `${rowHeightRem}rem` }}
      >
        <iframe
          ref={frameRef}
          title={`${label} preview`}
          src={src}
          sandbox={QA_FRAME_SANDBOX}
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          width={viewport.width}
          height={viewport.height}
          style={{
            width: `${viewport.width}px`,
            height: `${viewport.height}px`,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
            border: 0,
            display: 'block',
          }}
        />
      </div>
    </div>
  )
}
