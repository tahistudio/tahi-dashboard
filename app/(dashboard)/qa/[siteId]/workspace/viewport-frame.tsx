'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, MessageSquarePlus } from 'lucide-react'
import type { QaViewportKey } from '@/lib/qa/types'
import { QA_VIEWPORTS } from '@/lib/qa/types'
import { inspectOverflows, inspectScrollStep } from './inspect-helpers'
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

/**
 * Columns narrower than this use the compact label bar (short code, icon-only Comment,
 * scan state as a dot). The full bar (name, width, scan text, Comment and Expand) needs
 * about 23rem, so 26rem leaves room before anything would overlap.
 */
const COMPACT_BELOW_REM = 26

/** Short codes for frames too narrow for the full viewport name. */
const COMPACT_LABEL: Record<QaViewportKey, string> = { xl: 'XL', desktop: 'Desk', tablet: 'Tab', mobile_l: 'ML', mobile_p: 'MP' }

/** Bars at least this wide (rem) also spell out "View at 100%"; narrower bars show only its icon. */
const VIEW_LABEL_FROM_REM = 36

/**
 * Narrowest a frame's column gets, so the label bar and its controls stay usable.
 * The compact bar needs room for the checkbox, the short code, the scan dot and three
 * 2.75rem buttons (Comment, View at 100% and Max): about 12.6rem, so 13.5rem leaves some slack.
 */
export const MIN_FRAME_REM = 13.5

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
  /** Why the frame is read only, shown as the tooltip of the disabled comment button. Defaults to the closed round message. */
  readOnlyReason?: string
  onLoad?: () => void
  /** Comment mode is on in this frame. */
  commenting?: boolean
  /** Toggles comment mode for this frame. Omit to hide the control. */
  onCommentToggle?: () => void
  /** Overrides the column width (mobile: the label bar spans the whole screen width). */
  columnWidthRem?: number
  /**
   * Inspect mode: the frame is drawn at scale 1, its true CSS size with no transform, inside a
   * box that scrolls sideways when the page is wider than the room. The Expand button is hidden
   * because there is nothing left to enlarge.
   */
  inspect?: boolean
  /** Opens this frame's page at its true size in a new tab. Omit to hide the button. */
  onViewFull?: () => void
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
  readOnlyReason,
  onLoad,
  commenting = false,
  onCommentToggle,
  columnWidthRem,
  inspect = false,
  onViewFull,
}: ViewportFrameProps) {
  const scale = frameScale(viewport, rowHeightRem)
  const boxWidthRem = (viewport.width * scale) / 16
  const outerWidthRem = columnWidthRem ?? frameOuterWidthRem(viewport, rowHeightRem)
  const compact = outerWidthRem < COMPACT_BELOW_REM
  const label = viewport.label
  // In the single-frame layout the Expand button leads the bar, away from the floating chat button.
  const expandFirst = columnWidthRem !== undefined && !inspect

  const expandButton = inspect ? null : (
    <button
      type="button"
      onClick={onExpand}
      aria-label={expanded ? `Collapse ${label} preview` : `Expand ${label} preview`}
      aria-pressed={expanded}
      className="flex min-h-[2.75rem] min-w-[2.75rem] shrink-0 items-center justify-center px-2 rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
      style={{ fontSize: '0.75rem' }}
    >
      {expanded ? 'Exit' : compact ? 'Max' : 'Expand'}
    </button>
  )

  const commentButton = onCommentToggle ? (
    <button
      type="button"
      onClick={onCommentToggle}
      disabled={readOnly}
      aria-pressed={commenting}
      aria-label={`Comment on ${label}`}
      title={readOnly ? (readOnlyReason ?? 'This round is closed') : `Comment on ${label}`}
      className="flex min-h-[2.75rem] min-w-[2.75rem] shrink-0 items-center justify-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-60"
      style={{
        gap: '0.25rem',
        padding: compact ? 0 : '0 0.5rem',
        fontSize: '0.75rem',
        fontWeight: 600,
        background: commenting ? 'var(--color-brand-50)' : 'var(--color-bg)',
        borderColor: commenting ? 'var(--color-brand)' : undefined,
        color: commenting ? 'var(--color-brand-dark)' : undefined,
      }}
    >
      <MessageSquarePlus className="size-4 shrink-0" aria-hidden="true" />
      {compact ? null : <span>Comment</span>}
    </button>
  ) : null

  const viewButton = onViewFull ? (
    <button
      type="button"
      onClick={onViewFull}
      aria-label={`View at 100% for ${label}, opens in a new tab`}
      title={`View ${label} (${viewport.width}px) at 100% in a new tab`}
      className="flex min-h-[2.75rem] min-w-[2.75rem] shrink-0 items-center justify-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
      style={{ gap: '0.25rem', padding: outerWidthRem >= VIEW_LABEL_FROM_REM ? '0 0.5rem' : 0, fontSize: '0.75rem', fontWeight: 600 }}
    >
      <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
      {outerWidthRem >= VIEW_LABEL_FROM_REM ? <span className="whitespace-nowrap">View at 100%</span> : null}
    </button>
  ) : null

  const bar = (
    <div
      className={`flex min-w-0 flex-nowrap items-center ${expandFirst ? 'justify-start' : 'justify-between'}`}
      style={{ gap: expandFirst ? '0.5rem' : compact ? '0.125rem' : '0.25rem', height: '2.75rem' }}
    >
      {expandFirst ? expandButton : null}
      <label
        className="flex min-h-[2.75rem] min-w-0 cursor-pointer items-center text-[var(--color-text)] hover:text-[var(--color-brand-dark)] focus-within:text-[var(--color-brand-dark)]"
        style={{ gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600 }}
      >
        <input
          type="checkbox"
          checked={ticked}
          disabled={readOnly}
          onChange={e => onTick(e.target.checked)}
          className="size-4 accent-[var(--color-brand)] disabled:cursor-not-allowed"
        />
        {compact ? (
          // Narrow frames show the short code (ML, MP) so Mobile L and Mobile P stay
          // distinguishable on touch screens; the checkbox keeps the full name.
          <>
            <span aria-hidden="true" title={label}>{COMPACT_LABEL[viewport.key]}</span>
            <span className="sr-only">{label}</span>
          </>
        ) : (
          <span className="truncate" title={label}>{label}</span>
        )}
        {compact ? null : (
          <span className="text-[var(--color-text-muted)]" style={{ fontWeight: 400 }}>
            {viewport.width}px
          </span>
        )}
      </label>
      <div className="flex shrink-0 items-center" style={{ gap: compact ? '0.125rem' : '0.5rem' }}>
        <span className="flex items-center text-[var(--color-text-muted)]" style={{ gap: '0.25rem', fontSize: '0.75rem' }} title={SCAN_LABEL[scanState]}>
          <span
            aria-hidden="true"
            className="inline-block rounded-full"
            style={{ width: '0.5rem', height: '0.5rem', background: SCAN_DOT[scanState] }}
          />
          {compact ? <span className="sr-only">{SCAN_LABEL[scanState]}</span> : SCAN_LABEL[scanState]}
        </span>
        {commentButton}
        {viewButton}
        {expandFirst ? null : expandButton}
      </div>
    </div>
  )

  if (inspect) {
    return (
      <div data-viewport={viewport.key as QaViewportKey} data-qa-mode="inspect" className="relative flex w-full min-w-0 flex-col" style={{ gap: '0.25rem' }}>
        {bar}
        <InspectBody viewport={viewport} src={src} frameRef={frameRef} onLoad={onLoad} commenting={commenting} />
      </div>
    )
  }

  return (
    <div
      data-viewport={viewport.key as QaViewportKey}
      className="relative flex shrink-0 flex-col"
      style={{ width: `${outerWidthRem}rem`, gap: '0.25rem' }}
    >
      {bar}
      <div
        className="relative mx-auto overflow-hidden rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]"
        style={{ width: `${boxWidthRem}rem`, height: `${rowHeightRem}rem`, borderColor: commenting ? 'var(--color-brand)' : undefined }}
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

interface InspectBodyProps {
  viewport: QaViewportDef
  src: string
  frameRef: (el: HTMLIFrameElement | null) => void
  onLoad?: () => void
  commenting: boolean
}

const SCROLL_BUTTON =
  'flex min-h-[2.75rem] min-w-[2.75rem] shrink-0 items-center justify-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-50'

/**
 * The Inspect frame: the page at its true CSS size, no transform of any kind, so no element edge
 * falls between device pixels. Sizes are real CSS pixels on purpose (not rem): the frame must
 * match the viewport width the page is built for, whatever the dashboard's root font size is.
 * The box is left aligned (never centred) so it starts on a whole pixel. When the page is wider
 * than the room, this box scrolls sideways; the page inside scrolls vertically on its own.
 */
function InspectBody({ viewport, src, frameRef, onLoad, commenting }: InspectBodyProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [room, setRoom] = useState(0)
  const [edge, setEdge] = useState({ atStart: true, atEnd: true })
  const label = viewport.label
  const overflows = inspectOverflows(viewport.width, room)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      setRoom(el.clientWidth)
      setEdge({ atStart: el.scrollLeft <= 1, atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function onScroll() {
    const el = scrollerRef.current
    if (!el) return
    setEdge({ atStart: el.scrollLeft <= 1, atEnd: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 })
  }

  function scrollSideways(direction: -1 | 1) {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: direction * inspectScrollStep(el.clientWidth), behavior: 'smooth' })
  }

  return (
    <>
      {overflows ? (
        <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
          <p className="min-w-0 text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem' }}>
            {label} is {viewport.width}px wide. Scroll sideways to see all of it.
          </p>
          <div className="flex shrink-0 items-center" style={{ gap: '0.25rem' }}>
            <button type="button" onClick={() => scrollSideways(-1)} disabled={edge.atStart} aria-label={`Scroll ${label} preview left`} className={SCROLL_BUTTON}>
              <ChevronLeft className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => scrollSideways(1)} disabled={edge.atEnd} aria-label={`Scroll ${label} preview right`} className={SCROLL_BUTTON}>
              <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        role="region"
        aria-label={`${label} preview at ${viewport.width}px`}
        tabIndex={0}
        className="tahi-focus-ring w-full min-w-0 overflow-x-auto overflow-y-hidden rounded-[var(--radius-leaf-sm)]"
      >
        <div
          className="relative shrink-0 overflow-hidden rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]"
          style={{ width: `${viewport.width + 2}px`, height: `${viewport.height + 2}px`, borderColor: commenting ? 'var(--color-brand)' : undefined }}
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
            style={{ width: `${viewport.width}px`, height: `${viewport.height}px`, border: 0, display: 'block' }}
          />
        </div>
      </div>
    </>
  )
}
