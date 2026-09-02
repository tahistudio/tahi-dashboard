'use client'

/**
 * <RequestsTimeline>. The timeline view, promoted from a sub-view of
 * <BoardView> to a peer of List, Kanban and Workload.
 *
 * One row per item. Items with a start date draw a bar across the range;
 * everything else drops a milestone diamond on its due date. Bars take
 * their colour from the item's status column so the timeline shares the
 * kanban's palette, and an open item past its due date overrides to red
 * with a darker ring. Finished work is never late.
 *
 * The label column is sticky, so the request stays readable while the
 * date axis scrolls under it. Only the chart scrolls sideways: the page
 * around it keeps a constant width. Each row carries the button role and
 * a tab stop, so a keyboard user walks the plot and opens a request with
 * Enter or Space.
 *
 * <BoardView> renders this same component for its own `timeline` tab, so
 * there is one implementation and nothing drifts.
 */

import * as React from 'react'
import { Calendar } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Tooltip } from '@/components/tahi/tooltip'
import type { BoardItem, BoardColumn } from '@/components/tahi/kanban-board'
import {
  DAY_MS,
  TIMELINE_EDGE_EXTENSION_DAYS,
  TIMELINE_LABEL_WIDTH_PX,
  computeTimelineDomain,
  doneStatusValues,
  formatTimelineDate,
  isTimelineOverdue,
  parseTimelineDate,
  ratioOf,
  timelineChartWidth,
  todayRatio,
  weekTicks,
  type TimelineDomain,
  type TimelineTick,
} from '@/lib/timeline-domain'

// ── Styles ───────────────────────────────────────────────────────────
//
// Sticky positioning, zebra striping that a sticky cell can inherit, the
// hover tint and the mobile overrides all need real CSS rather than
// inline style objects, so the component ships its own scoped sheet in
// the same shape <BoardScrollbar> uses. Everything reads from tokens, so
// dark mode needs no second set of rules.

const TIMELINE_CSS = `
.tahi-tl{ --tahi-tl-lbl: 16.25rem; }
.tahi-tl-row{
  transition: background-color 150ms ease;
  background: var(--color-bg);
}
.tahi-tl-row[data-zebra="true"]{ background: var(--color-bg-secondary); }
.tahi-tl-row:hover{ background: var(--color-bg-tertiary); }
.tahi-tl-lbl{ background: inherit; }
.tahi-tl-title{
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (max-width: 47.9375rem){
  .tahi-tl{ --tahi-tl-lbl: 10.625rem; }
  .tahi-tl-row{ min-height: 3.25rem; }
  .tahi-tl-today{ min-height: 2.75rem; }
  .tahi-tl-title{
    white-space: normal;
    text-overflow: clip;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
}
`

// ── Types ────────────────────────────────────────────────────────────

interface TimelineDatum {
  item: BoardItem
  startTs: number | null
  endTs: number
  column: BoardColumn | undefined
  isOverdue: boolean
}

interface RequestsTimelineProps {
  columns: ReadonlyArray<BoardColumn>
  items: ReadonlyArray<BoardItem>
  /** Row click, Enter and Space all route here. */
  onOpen?: (item: BoardItem) => void
  /** Show the client avatar in the label column. Clients already know
   *  whose request it is, so the portal passes false. */
  showClient?: boolean
  className?: string
}

// ── Component ────────────────────────────────────────────────────────

export function RequestsTimeline({
  columns,
  items,
  onOpen,
  showClient = true,
  className,
}: RequestsTimelineProps) {
  // One "now" for the life of the view, so the today line, the ticks and
  // the overdue rule agree with each other and the domain does not shift
  // under the user mid-scroll.
  const [now] = React.useState(() => Date.now())

  const columnByStatus = React.useMemo(() => {
    const m = new Map<string, BoardColumn>()
    for (const c of columns) m.set(c.statusValue, c)
    return m
  }, [columns])

  const doneStatuses = React.useMemo(() => doneStatusValues(columns), [columns])

  const data = React.useMemo<TimelineDatum[]>(() => (
    items
      .map((item): TimelineDatum | null => {
        const endTs = parseTimelineDate(item.dueDate, now)
        if (endTs == null) return null
        return {
          item,
          startTs: parseTimelineDate(item.startDate, now),
          endTs,
          column: columnByStatus.get(item.status),
          isOverdue: isTimelineOverdue({ status: item.status, endTs, now, doneStatuses }),
        }
      })
      .filter((d): d is TimelineDatum => d !== null)
      .sort((a, b) => (a.startTs ?? a.endTs) - (b.startTs ?? b.endTs))
  ), [items, columnByStatus, doneStatuses, now])

  // Scroll extension. Reaching either edge widens the domain by another
  // 180 days, so the chart reads as endless without rendering the whole
  // calendar. Growing to the left moves every date right, so scrollLeft
  // is pushed by the same amount to hold the user's place.
  const [pastDays, setPastDays] = React.useState(0)
  const [futureDays, setFutureDays] = React.useState(0)

  const domain: TimelineDomain = React.useMemo(() => computeTimelineDomain(
    data.map(d => ({ startTs: d.startTs, endTs: d.endTs })),
    { now, pastExtensionDays: pastDays, futureExtensionDays: futureDays },
  ), [data, now, pastDays, futureDays])

  const chartWidth = React.useMemo(() => timelineChartWidth(domain), [domain])
  const ticks = React.useMemo(() => weekTicks(domain, now), [domain, now])
  const nowRatio = todayRatio(domain, now)
  const todayX = nowRatio * chartWidth
  const weekPx = (7 * DAY_MS / domain.span) * chartWidth

  const scrollRef = React.useRef<HTMLDivElement | null>(null)

  const labelWidth = React.useCallback(() => {
    const el = scrollRef.current
    if (!el) return TIMELINE_LABEL_WIDTH_PX
    const raw = getComputedStyle(el).getPropertyValue('--tahi-tl-lbl')
    const px = Number.parseFloat(raw)
    if (!Number.isFinite(px) || px <= 0) return TIMELINE_LABEL_WIDTH_PX
    // The custom property is authored in rem, so it needs the root size.
    return raw.trim().endsWith('rem')
      ? px * Number.parseFloat(getComputedStyle(document.documentElement).fontSize || '16')
      : px
  }, [])

  const jumpToToday = React.useCallback((smooth: boolean) => {
    const el = scrollRef.current
    if (!el) return
    // Today sits 30% into the plotted area, measured past the sticky
    // label column rather than past the viewport edge it hides.
    const plotted = Math.max(0, el.clientWidth - labelWidth())
    const left = Math.max(0, Math.round(todayX - plotted * 0.3))
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' })
    } else {
      el.scrollLeft = left
    }
  }, [todayX, labelWidth])

  // Land on today once, on mount. After that the scroll position belongs
  // to the user, and the Today button is how they come back.
  const mountedRef = React.useRef(false)
  React.useEffect(() => {
    if (mountedRef.current) return
    mountedRef.current = true
    jumpToToday(false)
  }, [jumpToToday])

  const prevWidthRef = React.useRef(chartWidth)
  const pendingPastRef = React.useRef(false)
  React.useEffect(() => {
    const el = scrollRef.current
    if (el && pendingPastRef.current) {
      const delta = chartWidth - prevWidthRef.current
      if (delta > 0) el.scrollLeft += delta
      pendingPastRef.current = false
    }
    prevWidthRef.current = chartWidth
  }, [chartWidth])

  const handleScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollLeft < 120) {
      pendingPastRef.current = true
      setPastDays(d => d + TIMELINE_EDGE_EXTENSION_DAYS)
    } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - 120) {
      setFutureDays(d => d + TIMELINE_EDGE_EXTENSION_DAYS)
    }
  }, [])

  const legend = (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '0.5rem 0.875rem',
      marginBottom: '0.75rem',
    }}>
      {columns.map(col => (
        <LegendKey
          key={col.id}
          color={col.color ?? 'var(--color-text-muted)'}
          label={col.label}
        />
      ))}
      <LegendKey color="var(--color-danger)" label="Overdue" />
      <button
        type="button"
        className="tahi-focus-ring tahi-tl-today"
        onClick={() => jumpToToday(true)}
        style={{
          marginLeft: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4375rem',
          minHeight: '2.125rem',
          padding: '0 0.8125rem',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          fontSize: '0.78125rem',
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--color-bg-secondary)'
          e.currentTarget.style.color = 'var(--color-brand-dark)'
          e.currentTarget.style.borderColor = 'var(--color-brand)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'var(--color-bg)'
          e.currentTarget.style.color = 'var(--color-text)'
          e.currentTarget.style.borderColor = 'var(--color-border)'
        }}
      >
        <Calendar size={14} aria-hidden="true" />
        Today
      </button>
    </div>
  )

  if (data.length === 0) {
    return (
      <div className={className}>
        <style>{TIMELINE_CSS}</style>
        <div className="tahi-tl">
          {legend}
          <div style={{
            padding: '1.75rem 0.875rem',
            textAlign: 'center',
            border: '1px dashed var(--color-border)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg-secondary)',
            color: 'var(--color-text-muted)',
            fontSize: '0.8125rem',
          }}>
            No requests with a due date to plot.
          </div>
        </div>
      </div>
    )
  }

  // Week guides are painted as a repeating gradient rather than one node
  // per line per row, so a long domain stays cheap. The offset locks the
  // first line to today, matching the axis ticks.
  const gridStyle: React.CSSProperties = {
    width: chartWidth,
    backgroundImage: `repeating-linear-gradient(90deg, var(--color-border-subtle) 0, var(--color-border-subtle) 1px, transparent 1px, transparent ${weekPx}px)`,
    backgroundPosition: `${todayX % weekPx}px 0`,
  }

  return (
    <div className={className}>
      <style>{TIMELINE_CSS}</style>
      <div className="tahi-tl">
        {legend}
        <div style={{
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-bg)',
          overflow: 'hidden',
        }}>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            style={{ overflowX: 'auto', overflowY: 'hidden' }}
          >
            <div style={{ minWidth: '100%', width: `calc(var(--tahi-tl-lbl) + ${chartWidth}px)` }}>
              {/* Axis */}
              <div style={{
                display: 'flex',
                alignItems: 'stretch',
                height: '2.75rem',
                background: 'var(--color-bg-tertiary)',
              }}>
                <div style={{
                  position: 'sticky',
                  left: 0,
                  zIndex: 2,
                  display: 'flex',
                  alignItems: 'center',
                  width: 'var(--tahi-tl-lbl)',
                  flexShrink: 0,
                  padding: '0 0.75rem',
                  background: 'var(--color-bg-tertiary)',
                }}>
                  <span style={{
                    fontSize: '0.625rem',
                    fontWeight: 700,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: 'var(--color-text-subtle)',
                  }}>
                    Request
                  </span>
                </div>
                <div style={{ position: 'relative', flexShrink: 0, width: chartWidth }}>
                  {ticks.map(tick => (
                    <span
                      key={tick.ts}
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: `${tick.ratio * 100}%`,
                        transform: 'translate(-50%, -50%)',
                        fontSize: '0.625rem',
                        fontWeight: 600,
                        color: 'var(--color-text-subtle)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tick.label}
                    </span>
                  ))}
                  <TodayLine ratio={nowRatio} />
                  {nowRatio >= 0 && nowRatio <= 1 && (
                    <span style={{
                      position: 'absolute',
                      top: '0.1875rem',
                      left: `${nowRatio * 100}%`,
                      transform: 'translateX(-50%)',
                      zIndex: 1,
                      padding: '0.0625rem 0.3125rem',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-brand)',
                      fontSize: '0.5625rem',
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}>
                      Today
                    </span>
                  )}
                </div>
              </div>

              {/* Rows */}
              {data.map((datum, i) => (
                <TimelineRow
                  key={datum.item.id}
                  datum={datum}
                  domain={domain}
                  nowRatio={nowRatio}
                  gridStyle={gridStyle}
                  showClient={showClient}
                  zebra={i % 2 === 1}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Row ──────────────────────────────────────────────────────────────

function TimelineRow({
  datum,
  domain,
  nowRatio,
  gridStyle,
  showClient,
  zebra,
  onOpen,
}: {
  datum: TimelineDatum
  domain: TimelineDomain
  nowRatio: number
  gridStyle: React.CSSProperties
  showClient: boolean
  zebra: boolean
  onOpen?: (item: BoardItem) => void
}) {
  const { item, startTs } = datum
  const tone = datum.isOverdue
    ? 'var(--color-danger)'
    : datum.column?.color ?? 'var(--color-text-muted)'
  // A late item keeps the red fill but gains a darker ring, so it reads as
  // late on its own rather than only against the legend.
  const overdueRing = '0 0 0 1.5px color-mix(in srgb, var(--color-danger) 55%, var(--color-text))'

  const endRatio = ratioOf(datum.endTs, domain)
  const leftRatio = startTs != null ? ratioOf(startTs, domain) : endRatio
  const widthRatio = Math.max(0, endRatio - leftRatio)

  const statusLabel = datum.column?.label ?? item.status
  const dates = startTs != null
    ? `${formatTimelineDate(startTs)} to ${formatTimelineDate(datum.endTs)}`
    : `Due ${formatTimelineDate(datum.endTs)}`
  const tip = `${statusLabel}${datum.isOverdue ? ', overdue' : ''}, ${dates}`

  const marker = startTs != null ? (
    <span
      style={{
        position: 'absolute',
        top: '50%',
        left: `${leftRatio * 100}%`,
        width: `${widthRatio * 100}%`,
        minWidth: '0.75rem',
        height: '0.875rem',
        transform: 'translateY(-50%)',
        borderRadius: '0.4375rem',
        background: tone,
        boxShadow: datum.isOverdue ? overdueRing : undefined,
      }}
    />
  ) : (
    <span
      style={{
        position: 'absolute',
        top: '50%',
        left: `${endRatio * 100}%`,
        width: '0.8125rem',
        height: '0.8125rem',
        transform: 'translate(-50%, -50%) rotate(45deg)',
        borderRadius: '0.125rem',
        background: tone,
        boxShadow: datum.isOverdue ? overdueRing : undefined,
      }}
    />
  )

  return (
    <div
      // A div rather than a <button>, so the client Avatar and the plot
      // markers nest validly. role and tabIndex give it the same keyboard
      // contract a button has.
      // The row fills the horizontal scroller, so an outside ring would be
      // clipped at both edges. Inset keeps the whole ring on screen.
      className="tahi-tl-row tahi-focus-inset"
      data-zebra={zebra ? 'true' : 'false'}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen(item) : undefined}
      onKeyDown={onOpen ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(item)
        }
      } : undefined}
      aria-label={onOpen ? `Open ${item.reference ? `${item.reference} ` : ''}${item.title}, ${tip}` : undefined}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        width: '100%',
        minHeight: '2.5rem',
        cursor: onOpen ? 'pointer' : 'default',
      }}
    >
      <div
        className="tahi-tl-lbl"
        style={{
          position: 'sticky',
          left: 0,
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          width: 'var(--tahi-tl-lbl)',
          flexShrink: 0,
          minWidth: 0,
          padding: '0 0.75rem',
        }}
      >
        {item.reference && (
          <span style={{
            flexShrink: 0,
            fontSize: '0.65625rem',
            fontWeight: 600,
            color: 'var(--color-text-subtle)',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {item.reference}
          </span>
        )}
        <span
          className="tahi-tl-title"
          data-private
          style={{
            minWidth: 0,
            fontSize: '0.78125rem',
            fontWeight: 600,
            color: 'var(--color-text)',
          }}
        >
          {item.title}
        </span>
        {showClient && item.client && (
          <span style={{ marginLeft: 'auto', flexShrink: 0, display: 'inline-flex' }}>
            <Avatar
              name={item.client.name}
              src={item.client.avatarUrl}
              size="sm"
              tooltip={item.client.name}
            />
          </span>
        )}
      </div>

      <div style={{ position: 'relative', flexShrink: 0, ...gridStyle }}>
        <TodayLine ratio={nowRatio} />
        <Tooltip label={tip} side="top">
          {marker}
        </Tooltip>
      </div>
    </div>
  )
}

// ── Bits ─────────────────────────────────────────────────────────────

function TodayLine({ ratio }: { ratio: number }) {
  if (ratio < 0 || ratio > 1) return null
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${ratio * 100}%`,
        width: '1px',
        background: 'var(--color-brand)',
        opacity: 0.5,
      }}
    />
  )
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.375rem',
      fontSize: '0.71875rem',
      fontWeight: 600,
      color: 'var(--color-text-muted)',
    }}>
      <span
        aria-hidden="true"
        style={{
          width: '0.5rem',
          height: '0.5rem',
          flexShrink: 0,
          borderRadius: 999,
          background: color,
        }}
      />
      {label}
    </span>
  )
}

export type { RequestsTimelineProps, TimelineTick }
