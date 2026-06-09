/**
 * <GanttGrid> — the visual heart of project schedules.
 *
 * Renders a CSS-grid table that matches the PDF reference exactly:
 *
 *   ┌───────────────┬──────┬─────────────────────────────────────────────┐
 *   │ Phase         │ Owner│ W1  W2  W3  ...  Wn                         │
 *   ├───────────────┴──────┴─────────────────────────────────────────────┤
 *   │ MAIN BUILD PHASES                                                  │  <- section_header row
 *   ├───────────────┬──────┬─────────────────────────────────────────────┤
 *   │ Discovery     │ Joint│ ████                                        │  <- task row, joint colour
 *   │ Wireframing   │ Tahi │ ████ ████                                   │  <- task row, tahi colour
 *   │ Sitemap gate  │ Gate │       ◇                                     │  <- gate row, diamond
 *   └───────────────┴──────┴─────────────────────────────────────────────┘
 *
 * The bars are absolutely-positioned within a single grid cell that spans
 * all the week columns; this gives sub-cell precision (we could later add
 * day-resolution) and keeps the bar a single DOM node per row.
 *
 * Read-only by default. Pass `onRowClick` / `onCellClick` to wire up edits
 * from the parent (the admin editor uses those; the public viewer doesn't).
 */
'use client'

import React from 'react'
import type { DeliveryStatus } from '@/lib/delivery-status'

export type RowOwner = 'tahi' | 'client' | 'joint' | 'tahi_parallel'
export type RowType = 'section_header' | 'task' | 'gate' | 'critical_gate'

export interface GanttRow {
  id: string
  rowType: RowType
  label: string
  owner: RowOwner | null
  startWeek: number | null
  endWeek: number | null
  riskFlag: number | boolean
  position: number
}

interface GanttGridProps {
  rows: GanttRow[]
  numberOfWeeks: number
  /** Optional click handler — receives the row that was clicked. Editors
   *  use this to pop a per-row inspector. */
  onRowClick?: (row: GanttRow) => void
  /** Compact mode shrinks paddings + label column for slide embedding. */
  compact?: boolean
  /** Explicit min height per row, used by drag-reorder UIs to keep targets stable. */
  rowMinHeight?: string
  /** Delivery spine (#148): rowId -> live delivery status. When present, a
   *  status dot shows next to the phase label. Optional + backward-compatible:
   *  omitted on the public viewer / PDF / proposal embeds. */
  statusByRow?: Record<string, DeliveryStatus>
}

// Delivery status dot colours (hardcoded hex, brand-locked visual like OWNER_BG).
export const DELIVERY_STATUS_COLOR: Record<DeliveryStatus, string> = {
  done: '#4ade80',
  in_progress: '#60a5fa',
  not_started: '#cbd5e1',
  at_risk: '#fb923c',
  delayed: '#f87171',
  blocked: '#b91c1c',
}

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  done: 'Done',
  in_progress: 'In progress',
  not_started: 'Not started',
  at_risk: 'At risk',
  delayed: 'Delayed',
  blocked: 'Blocked',
}

// Owner → colour. Hardcoded hex (not CSS vars) per CLAUDE.md guidance for
// brand-locked visuals; matches the printed PDF reference exactly.
const OWNER_BG: Record<RowOwner, string> = {
  tahi: '#5A824E',          // solid brand green
  client: '#1f2c1a',         // dark green/black (client work)
  joint: '#d4a017',          // amber
  tahi_parallel: '#a8c89e',  // light brand green
}

const OWNER_LABEL: Record<RowOwner, string> = {
  tahi: 'Tahi',
  client: 'Client',
  joint: 'Joint',
  tahi_parallel: 'Tahi',
}

const OWNER_LABEL_COLOR: Record<RowOwner, string> = {
  tahi: '#5A824E',
  client: '#1f2c1a',
  joint: '#d4a017',
  tahi_parallel: '#5A824E',
}

// Hatched red diagonal overlay used when riskFlag is set on a task row.
const RISK_OVERLAY = 'repeating-linear-gradient(45deg, rgba(248, 113, 113, 0.95) 0 4px, transparent 4px 8px)'

// Fixed widths for the leading metadata columns. Week columns share the
// remainder equally via `1fr` so the gantt always fills its container.
const PHASE_COL = '14rem'
const OWNER_COL = '4.5rem'

export function GanttGrid({
  rows,
  numberOfWeeks,
  onRowClick,
  compact = false,
  rowMinHeight,
  statusByRow,
}: GanttGridProps) {
  const weeks = Math.max(1, numberOfWeeks)
  const gridTemplateColumns = `${compact ? '12rem' : PHASE_COL} ${OWNER_COL} repeat(${weeks}, 1fr)`
  const cellPad = compact ? '0.375rem 0.5rem' : '0.5rem 0.75rem'
  const labelFontSize = compact ? '0.75rem' : '0.8125rem'
  const headerHeight = compact ? '2rem' : '2.5rem'
  const taskRowHeight = rowMinHeight ?? (compact ? '2.5rem' : '3rem')

  return (
    <div
      className="overflow-x-auto"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: '0.5rem',
        background: 'var(--color-bg)',
      }}
    >
      <div
        role="table"
        aria-label="Project schedule gantt"
        style={{ minWidth: compact ? '48rem' : '64rem' }}
      >
        {/* Header row: Phase | Owner | W1..Wn */}
        <div
          role="row"
          style={{
            display: 'grid',
            gridTemplateColumns,
            background: 'var(--color-bg-secondary)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div role="columnheader" style={{ padding: cellPad, fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.04em', height: headerHeight, display: 'flex', alignItems: 'center' }}>
            Phase
          </div>
          <div role="columnheader" style={{ padding: cellPad, fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', textTransform: 'uppercase', letterSpacing: '0.04em', height: headerHeight, display: 'flex', alignItems: 'center' }}>
            Owner
          </div>
          {Array.from({ length: weeks }, (_, i) => (
            <div
              key={i}
              role="columnheader"
              style={{
                padding: cellPad,
                fontSize: '0.6875rem',
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                height: headerHeight,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderLeft: '1px solid var(--color-border-subtle)',
              }}
            >
              W{i + 1}
            </div>
          ))}
        </div>

        {/* Body rows */}
        {rows.map((row) => {
          const onClick = onRowClick ? () => onRowClick(row) : undefined
          const cursor = onClick ? 'pointer' : 'default'

          // ── Section header row: full-width dark band ────────────────────
          if (row.rowType === 'section_header') {
            return (
              <div
                key={row.id}
                role="row"
                onClick={onClick}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr',
                  background: '#1f2c1a',
                  color: '#ffffff',
                  cursor,
                }}
              >
                <div
                  style={{
                    padding: '0.5rem 0.875rem',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {row.label}
                </div>
              </div>
            )
          }

          // ── Task / gate / critical-gate row ──────────────────────────────
          const start = row.startWeek
          const end = row.endWeek ?? row.startWeek
          // Validate range; bars only render when both bounds are valid.
          const validRange =
            start != null && end != null &&
            start >= 1 && start <= weeks &&
            end >= 1 && end <= weeks &&
            end >= start
          const ownerColour = row.owner ? OWNER_BG[row.owner] : null

          return (
            <div
              key={row.id}
              role="row"
              onClick={onClick}
              className="gantt-row"
              style={{
                display: 'grid',
                gridTemplateColumns,
                borderBottom: '1px solid var(--color-border-subtle)',
                cursor,
                minHeight: taskRowHeight,
                alignItems: 'center',
                transition: 'background-color 120ms ease',
              }}
              onMouseEnter={(e) => {
                if (onClick) e.currentTarget.style.backgroundColor = 'var(--color-bg-secondary)'
              }}
              onMouseLeave={(e) => {
                if (onClick) e.currentTarget.style.backgroundColor = 'transparent'
              }}
            >
              {/* Phase label (+ delivery status dot when provided) */}
              <div
                style={{
                  padding: cellPad,
                  fontSize: labelFontSize,
                  fontWeight: 500,
                  color: 'var(--color-text)',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
                title={
                  statusByRow?.[row.id]
                    ? `${row.label} — ${DELIVERY_STATUS_LABEL[statusByRow[row.id]]}`
                    : row.label
                }
              >
                {statusByRow?.[row.id] && (
                  <span
                    aria-hidden="true"
                    style={{
                      width: '0.5rem',
                      height: '0.5rem',
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: DELIVERY_STATUS_COLOR[statusByRow[row.id]],
                    }}
                  />
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.label}
                </span>
              </div>
              {/* Owner pill */}
              <div
                style={{
                  padding: cellPad,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {row.rowType === 'gate' || row.rowType === 'critical_gate' ? (
                  <span
                    style={{
                      fontSize: '0.625rem',
                      fontWeight: 600,
                      color: row.rowType === 'critical_gate' ? '#dc2626' : '#5A824E',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Gate
                  </span>
                ) : row.owner ? (
                  <span
                    style={{
                      fontSize: '0.6875rem',
                      fontWeight: 600,
                      color: OWNER_LABEL_COLOR[row.owner],
                    }}
                  >
                    {OWNER_LABEL[row.owner]}
                  </span>
                ) : null}
              </div>

              {/* The week-column area: render N invisible cells for grid
                  alignment, then absolutely layer the bar/gate over them. */}
              <div
                style={{
                  gridColumn: `3 / span ${weeks}`,
                  position: 'relative',
                  height: '100%',
                  display: 'grid',
                  gridTemplateColumns: `repeat(${weeks}, 1fr)`,
                }}
              >
                {/* Vertical week dividers (cosmetic only) */}
                {Array.from({ length: weeks }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      borderLeft: '1px solid var(--color-border-subtle)',
                      height: '100%',
                    }}
                  />
                ))}

                {/* The bar / gate diamond */}
                {validRange && row.rowType === 'task' && ownerColour && (
                  <div
                    style={{
                      gridColumnStart: start,
                      gridColumnEnd: end + 1,
                      alignSelf: 'center',
                      height: compact ? '0.875rem' : '1rem',
                      margin: '0 0.25rem',
                      borderRadius: '0.125rem',
                      background: ownerColour,
                      position: 'relative',
                      // Apply hatched risk overlay on top of the base colour.
                      backgroundImage: row.riskFlag ? RISK_OVERLAY : undefined,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                    }}
                    aria-label={`${row.label} from week ${start} to week ${end}`}
                  />
                )}

                {validRange && (row.rowType === 'gate' || row.rowType === 'critical_gate') && (
                  <div
                    style={{
                      gridColumnStart: start,
                      gridColumnEnd: start + 1,
                      alignSelf: 'center',
                      justifySelf: 'center',
                      width: '0.875rem',
                      height: '0.875rem',
                      transform: 'rotate(45deg)',
                      background: '#ffffff',
                      border: row.rowType === 'critical_gate' ? '2px solid #dc2626' : '2px solid #5A824E',
                    }}
                    aria-label={`${row.label} sign-off gate at week ${start}`}
                  />
                )}

                {/* Empty-state cue: no bar rendered when range is invalid */}
                {!validRange && row.rowType === 'task' && (
                  <div
                    style={{
                      gridColumn: `1 / span ${weeks}`,
                      alignSelf: 'center',
                      justifySelf: 'center',
                      fontSize: '0.6875rem',
                      color: 'var(--color-text-subtle)',
                      fontStyle: 'italic',
                    }}
                  >
                    No timeline set
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {rows.length === 0 && (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--color-text-subtle)',
              fontSize: '0.875rem',
              fontStyle: 'italic',
            }}
          >
            No rows yet. Add a section header or task to get started.
          </div>
        )}
      </div>
    </div>
  )
}
