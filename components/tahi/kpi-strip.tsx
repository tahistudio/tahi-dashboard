/**
 * <KPIStrip> + <KPICell> — a grouped panel with internal dividers.
 *
 * Used wherever a page has >2 related stats that read as a single unit
 * (Overview, Pipeline, Reports, Billing, Capacity, Client Detail, Audit Log).
 * Previously 7 pages rebuilt this pattern by hand; now they share one.
 *
 *   <KPIStrip>
 *     <KPICell icon={Users}      label="Total Clients"   value={11} />
 *     <KPICell icon={Inbox}      label="Open Requests"   value={12} sub="+3 this week" />
 *     <KPICell icon={Clock}      label="Billable Hours"  value="84.5h" />
 *     <KPICell icon={CreditCard} label="Outstanding"     value="$11,150" tone="warning" />
 *   </KPIStrip>
 *
 * Responsive rules (auto):
 *   mobile (<64rem) : 2-col grid, bottom dividers between rows
 *   desktop (≥64rem): N-col grid (N = number of cells), right dividers between cells
 *
 * Per DESIGN.md: "Multiple stats = one grouped panel with internal dividers,
 * NOT separate cards." This component enforces it.
 */

import React, { Children, isValidElement } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from './card'
import type { BadgeTone } from './badge'

// ── Types ───────────────────────────────────────────────────────────────────

interface KPICellProps {
  /** Optional Lucide icon. When set, rendered in the signature leaf-radius wrapper. */
  icon?: LucideIcon
  /** Short label (uppercase-ish, muted). */
  label: React.ReactNode
  /** The hero value (big, bold number or amount). */
  value: React.ReactNode
  /** Optional sub-line (delta, trend, or context). */
  sub?: React.ReactNode
  /** Tint the icon wrapper to flag attention (e.g. "warning" for outstanding). */
  tone?: BadgeTone
  /** Optional href — makes the cell a link. */
  href?: string
  /** Internal: controlled by <KPIStrip> so cells know their position. */
  __cellIndex?: number
  __totalCells?: number
}

// Map tone → bg/fg for the icon wrapper. Defaults to brand.
const TONE_ICON: Record<BadgeTone, { bg: string; fg: string }> = {
  brand:    { bg: 'var(--color-brand-50)',          fg: 'var(--color-brand)' },
  positive: { bg: 'var(--color-brand-50)',          fg: 'var(--color-brand)' },
  warning:  { bg: 'var(--color-warning-bg)',        fg: 'var(--color-warning)' },
  danger:   { bg: 'var(--color-danger-bg)',         fg: 'var(--color-danger)' },
  info:     { bg: 'var(--status-submitted-bg)',     fg: 'var(--status-submitted-text)' },
  teal:     { bg: 'var(--status-in-progress-bg)',   fg: 'var(--status-in-progress-text)' },
  purple:   { bg: 'var(--status-client-review-bg)', fg: 'var(--status-client-review-text)' },
  rose:     { bg: 'var(--priority-urgent-bg)',      fg: 'var(--priority-urgent-text)' },
  neutral:  { bg: 'var(--color-bg-tertiary)',       fg: 'var(--color-text-muted)' },
}

// ── KPICell ─────────────────────────────────────────────────────────────────

export function KPICell({
  icon: Icon,
  label,
  value,
  sub,
  tone = 'brand',
  href,
  __cellIndex,
  __totalCells,
}: KPICellProps) {
  const iconColours = TONE_ICON[tone]

  const idx = __cellIndex ?? 0
  const total = __totalCells ?? 1
  const mobileRows = Math.ceil(total / 2)
  const onLastMobileRow = idx >= (mobileRows - 1) * 2

  const content = (
    <>
      <div className="flex items-center" style={{ gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
        {Icon && (
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: '2rem',
              height: '2rem',
              background: iconColours.bg,
              color: iconColours.fg,
              borderRadius: 'var(--radius-leaf-sm)',
            }}
          >
            <Icon size={15} aria-hidden="true" />
          </div>
        )}
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {label}
        </span>
      </div>
      <div
        className="tabular-nums"
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          color: 'var(--color-text)',
          letterSpacing: '-0.01em',
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-1)' }}>
          {sub}
        </div>
      )}
    </>
  )

  // .kpi-strip-item removes bottom borders at lg+; pipeline-divider-item
  // adds right borders between cells at sm+. Both live in globals.css.
  return (
    <div
      className="kpi-strip-item pipeline-divider-item"
      style={{
        padding: 'var(--space-5)',
        borderBottom: onLastMobileRow ? 'none' : '1px solid var(--color-border-subtle)',
        display: 'block',
        textDecoration: 'none',
        color: 'inherit',
        ...(href
          ? { cursor: 'pointer', transition: 'background 150ms ease' }
          : {}),
      }}
    >
      {href ? (
        <a href={href} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
          {content}
        </a>
      ) : (
        content
      )}
    </div>
  )
}

// ── KPIStrip ────────────────────────────────────────────────────────────────

interface KPIStripProps {
  children: React.ReactNode
  /** Responsive desktop column count. Defaults to the number of cells. */
  desktopCols?: number
  className?: string
  style?: React.CSSProperties
}

export function KPIStrip({ children, desktopCols, className, style }: KPIStripProps) {
  const cells = Children.toArray(children).filter(isValidElement)
  const total = cells.length
  const cols = desktopCols ?? total

  const cellsWithIndex = cells.map((cell, i) =>
    isValidElement<KPICellProps>(cell)
      ? React.cloneElement(cell, { __cellIndex: i, __totalCells: total })
      : cell,
  )

  return (
    <Card variant="grouped" className={className} style={style}>
      <div
        className="grid grid-cols-2"
        style={{
          gridTemplateColumns: undefined,
          // Use a CSS custom property so the lg breakpoint picks it up
          ['--kpi-lg-cols' as string]: String(cols),
        }}
      >
        <style>{`
          @media (min-width: 64rem) {
            .kpi-strip-grid { grid-template-columns: repeat(var(--kpi-lg-cols), 1fr) !important; }
          }
        `}</style>
        <div
          className="kpi-strip-grid grid grid-cols-2"
          style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}
        >
          {cellsWithIndex}
        </div>
      </div>
    </Card>
  )
}
