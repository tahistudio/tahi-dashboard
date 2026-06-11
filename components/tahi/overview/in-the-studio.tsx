'use client'

// ─── In the Studio ────────────────────────────────────────────────────────────
//
// The WORK-zone worklog (delivery spine #148 / homepage Studio Ledger Slice 3).
// Recent requests rendered as a LEFT-SPINE vertical timeline: a hairline rail
// runs down the left, a small node sits per row. Rows are title-led (title
// primary, "{client} . {type}" secondary) and the relative updated time is
// rendered as "temperature" colour: --color-link when fresh (< 6h), muted in
// the settled middle (6h-3d), subtle when stale (> 3d -- no amber, the warning
// channel is reserved for overdue/blocked only). Status shows as a small
// letterpress tag, not a coloured pill.
// See SPECS/homepage-studio-ledger.md (the five signature moves).

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

// Mirrors the fields RequestRow consumes in overview-content.tsx. Kept local so
// this component owns its own contract; the parent maps its payload onto it.
export interface RecentRequest {
  id: string
  title: string
  status: string
  priority: string
  type: string
  orgName: string | null
  updatedAt: string
  scopeFlagged: boolean
}

const HOUR = 3600000
const DAY = 86400000

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 'var(--text-2xs, 0.6875rem)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--color-text-subtle)',
}

// Temperature of the last touch: fresh work uses --color-link (AA-safe brand
// green) to signal recency, settled work is quiet muted, stale work falls back
// to subtle (no amber -- the warning channel is reserved for overdue/blocked).
function temperature(updatedAt: string): { color: string; node: string } {
  const t = new Date(updatedAt).getTime()
  if (isNaN(t)) return { color: 'var(--color-text-subtle)', node: 'var(--color-border-strong)' }
  const age = Date.now() - t
  if (age < 6 * HOUR) return { color: 'var(--color-link)', node: 'var(--color-link)' }
  if (age > 3 * DAY) return { color: 'var(--color-text-subtle)', node: 'var(--color-border-strong)' }
  return { color: 'var(--color-text-muted)', node: 'var(--color-border-strong)' }
}

// Compact relative stamp without a date-fns dependency in this leaf component.
function timeAgo(updatedAt: string): string {
  const t = new Date(updatedAt).getTime()
  if (isNaN(t)) return ''
  const diff = Date.now() - t
  if (diff < 60000) return 'just now'
  if (diff < HOUR) return `${Math.round(diff / 60000)}m ago`
  if (diff < DAY) return `${Math.round(diff / HOUR)}h ago`
  const days = Math.round(diff / DAY)
  if (days < 7) return `${days}d ago`
  const weeks = Math.round(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return `${Math.round(days / 30)}mo ago`
}

function humanise(value: string): string {
  return value.replace(/_/g, ' ')
}

export function InTheStudio({
  data,
  loading,
  className,
}: {
  data: RecentRequest[]
  loading: boolean
  className?: string
}) {
  const rows = data.slice(0, 6)

  return (
    <section
      aria-label="In the studio"
      className={className}
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-6)',
      }}
    >
      {/* Letterpress zone header: label + open count */}
      <div
        className="flex items-baseline justify-between"
        style={{ gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}
      >
        <h2 style={LABEL_STYLE}>In the Studio</h2>
        {!loading && data.length > 0 && (
          <span
            className="tabular-nums"
            style={{ ...LABEL_STYLE, color: 'var(--color-text-muted)' }}
          >
            {data.length} open
          </span>
        )}
      </div>

      {loading ? (
        <ShimmerRows />
      ) : rows.length === 0 ? (
        <EmptyState />
      ) : (
        <ol style={{ position: 'relative', listStyle: 'none', margin: 0, padding: 0 }}>
          {/* The left spine: one hairline rail behind every node */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: '0.3125rem',
              top: '0.5rem',
              bottom: '0.5rem',
              width: 1,
              background: 'var(--color-border-subtle)',
            }}
          />
          {rows.map((req, i) => (
            <TimelineRow key={req.id} req={req} isLast={i === rows.length - 1} />
          ))}
        </ol>
      )}
    </section>
  )
}

// ─── Timeline row ──────────────────────────────────────────────────────────────

function TimelineRow({ req, isLast }: { req: RecentRequest; isLast: boolean }) {
  const temp = temperature(req.updatedAt)
  return (
    <li style={{ position: 'relative' }}>
      <Link
        href={`/requests/${req.id}`}
        className="flex group"
        style={{
          gap: 'var(--space-3)',
          paddingTop: 'var(--space-3)',
          paddingBottom: isLast ? 0 : 'var(--space-3)',
          paddingLeft: 'var(--space-2)',
          paddingRight: 'var(--space-2)',
          marginLeft: 'calc(-1 * var(--space-2))',
          marginRight: 'calc(-1 * var(--space-2))',
          textDecoration: 'none',
          borderRadius: 'var(--radius-md)',
          minHeight: '2.75rem',
          transition: 'background-color var(--dur-2) var(--ease-productive)',
        }}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-row-hover)' }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent' }}
      >
        {/* Node on the spine, temperature-coloured */}
        <span
          aria-hidden="true"
          className="flex-shrink-0"
          style={{
            width: '0.6875rem',
            height: '0.6875rem',
            marginTop: '0.1875rem',
            borderRadius: '9999px',
            background: 'var(--color-bg)',
            border: `2px solid ${temp.node}`,
            boxSizing: 'border-box',
            zIndex: 1,
          }}
        />

        {/* Title-led body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center" style={{ gap: 'var(--space-1-5)' }}>
            <span
              data-private
              className="truncate"
              style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)', minWidth: 0 }}
            >
              {req.title}
            </span>
            {req.scopeFlagged && (
              <span
                className="flex-shrink-0"
                role="img"
                aria-label="Scope flagged"
                title="Scope flagged"
                style={{ width: '0.375rem', height: '0.375rem', borderRadius: '9999px', background: 'var(--color-danger)' }}
              />
            )}
          </div>
          <p
            className="truncate"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}
          >
            {req.orgName ? <span data-private>{req.orgName}</span> : null}
            {req.orgName ? ' · ' : ''}
            {humanise(req.type)}
          </p>
        </div>

        {/* Letterpress status tag + temperature time */}
        <div className="flex flex-col items-end flex-shrink-0" style={{ gap: 'var(--space-1)' }}>
          <span style={{ ...LABEL_STYLE, letterSpacing: '0.06em' }}>
            {humanise(req.status)}
          </span>
          <span
            className="tabular-nums"
            style={{ fontSize: 'var(--text-xs)', fontWeight: temp.color === 'var(--color-link)' ? 600 : 400, color: temp.color }}
          >
            {timeAgo(req.updatedAt)}
          </span>
        </div>

        <ArrowRight
          size={14}
          aria-hidden="true"
          className="flex-shrink-0 row-arrow"
          style={{ color: 'var(--color-border)', marginTop: '0.125rem' }}
        />
      </Link>
    </li>
  )
}

// ─── Loading + empty states ──────────────────────────────────────────────────

function ShimmerRows() {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-4)' }}>
      {[0, 1, 2, 3].map(n => (
        <div key={n} className="flex items-center" style={{ gap: 'var(--space-3)' }}>
          <div className="tahi-shimmer flex-shrink-0" style={{ width: '0.6875rem', height: '0.6875rem', borderRadius: '9999px' }} />
          <div className="flex-1 flex flex-col" style={{ gap: 'var(--space-1-5)' }}>
            <div className="tahi-shimmer" style={{ height: '0.8125rem', width: '55%' }} />
            <div className="tahi-shimmer" style={{ height: '0.6875rem', width: '35%' }} />
          </div>
          <div className="tahi-shimmer flex-shrink-0" style={{ height: '0.6875rem', width: '3rem' }} />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex items-start" style={{ gap: 'var(--space-2)', padding: 'var(--space-3) 0' }}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
        style={{ flexShrink: 0, marginTop: '0.125rem', color: 'var(--color-text-subtle)' }}
      >
        <path
          d="M3 13C3 8 6 3.5 13 3C12.5 10 8 13 3 13ZM3 13C5.5 11 7.5 8.5 9.5 6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div>
        <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--color-text-muted)' }}>
          Nothing in the studio yet
        </p>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', marginTop: 'var(--space-0-5)' }}>
          Active requests appear here as work moves through the studio.
        </p>
      </div>
    </div>
  )
}
