'use client'

// ─── In the Studio ────────────────────────────────────────────────────────────
//
// The WORK-zone worklog (delivery spine #148 / homepage Studio Ledger Slice 3).
// Recent requests rendered as a LEFT-SPINE vertical timeline: a hairline rail
// runs down the left, a small node sits per row. Rows are title-led (title
// primary, "{client} . {type}" secondary) and the relative updated time is
// rendered as "temperature" colour: brand green when fresh (< 6h), muted in the
// settled middle (6h .. 3d), amber when stale (> 3d). Status shows as a small
// letterpress tag, not a coloured pill. No edition numbers yet (the
// deliveryNumber field is fallback-first and does not exist), so rows carry no
// numbering. See SPECS/homepage-studio-ledger.md (the five signature moves).

import Link from 'next/link'
import { ArrowRight, Inbox } from 'lucide-react'

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

// Temperature of the last touch: fresh work glows brand-green, settled work is
// quiet, stale work warms to amber. Green is signal only (never decoration);
// amber is the single warning channel. Red is reserved for overdue/error.
function temperature(updatedAt: string): { color: string; node: string } {
  const t = new Date(updatedAt).getTime()
  if (isNaN(t)) return { color: 'var(--color-text-subtle)', node: 'var(--color-border-strong)' }
  const age = Date.now() - t
  if (age < 6 * HOUR) return { color: 'var(--color-brand)', node: 'var(--color-brand)' }
  if (age > 3 * DAY) return { color: 'var(--color-warning)', node: 'var(--color-warning)' }
  return { color: 'var(--color-text-subtle)', node: 'var(--color-border-strong)' }
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
            style={{ fontSize: 'var(--text-xs)', fontWeight: temp.color === 'var(--color-text-subtle)' ? 400 : 600, color: temp.color }}
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
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: 'var(--space-10) var(--space-4)', gap: 'var(--space-2)' }}
    >
      <div
        className="flex items-center justify-center brand-gradient"
        style={{ width: '2.5rem', height: '2.5rem', borderRadius: 'var(--radius-leaf-sm)', marginBottom: 'var(--space-1)' }}
      >
        <Inbox size={18} aria-hidden="true" style={{ color: '#fff' }} />
      </div>
      <p style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--color-text)' }}>
        All quiet in the studio
      </p>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', maxWidth: '15rem' }}>
        New requests land here as the work moves.
      </p>
    </div>
  )
}
