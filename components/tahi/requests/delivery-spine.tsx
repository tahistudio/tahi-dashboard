'use client'

/**
 * <DeliverySpine>: the request's delivery pipeline, drawn as its own card.
 *
 * Five steps on a connector track: 1.5rem circular nodes with a 0.125rem
 * ring, a check inside the completed ones, a brand halo on the current one,
 * and the step label underneath. For a studio audience every step is a
 * button that moves the request there (the parent runs the optimistic PATCH
 * and the toast), with a hint line under the track. For a client, and for
 * anyone in read-only client view, the same track renders as plain markup
 * with no affordance.
 *
 * The connector is an absolutely positioned bar inside each step except the
 * first, running from that step's node back to the previous one. Every step
 * is `flex: 1`, so `left: -50%; width: 100%` lands exactly centre to centre
 * without measuring anything.
 *
 * Off-pipeline statuses (draft, on_hold, cancelled, archived) are not steps.
 * The parent decides whether to render the spine at all; when the current
 * status is off-pipeline the spine shows no current step rather than
 * pretending the request is at "Submitted".
 */

import { Check } from 'lucide-react'
import { REQUEST_STATUS_LABELS } from '@/lib/status-config'

/** The delivery pipeline, in order. Matches the default kanban columns. */
export const PIPELINE_STATUSES = [
  'submitted',
  'in_review',
  'in_progress',
  'client_review',
  'delivered',
] as const

export type PipelineStatus = typeof PIPELINE_STATUSES[number]

export function isPipelineStatus(status: string): status is PipelineStatus {
  return (PIPELINE_STATUSES as readonly string[]).includes(status)
}

interface DeliverySpineProps {
  status: string
  /** When true the steps are buttons. Studio audiences only. */
  interactive?: boolean
  onPick?: (status: PipelineStatus) => void
  /** Disables every step while a move is in flight. */
  busy?: boolean
  /** Short line on the right of the header, e.g. "Due 12 Sep". */
  eta?: string | null
}

const NODE_SIZE = '1.5rem'
/** Half the node minus half the connector, so the bar hits the node's waist. */
const CONNECTOR_TOP = '0.6875rem'

export function DeliverySpine({
  status,
  interactive = false,
  onPick,
  busy = false,
  eta,
}: DeliverySpineProps) {
  const currentIndex = PIPELINE_STATUSES.indexOf(status as PipelineStatus)

  return (
    <section
      aria-label="Delivery"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg)',
        boxShadow: 'var(--shadow-xs)',
        padding: '1rem 1.125rem',
      }}
    >
      <div
        className="flex items-center"
        style={{ gap: '0.5rem', marginBottom: '0.875rem' }}
      >
        <h2
          className="uppercase"
          style={{
            margin: 0,
            fontSize: '0.6875rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            color: 'var(--color-text-subtle)',
          }}
        >
          Delivery
        </h2>
        {eta && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: 'var(--color-text-muted)',
            }}
          >
            {eta}
          </span>
        )}
      </div>

      <ol
        aria-label="Delivery steps"
        className="flex items-start"
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {PIPELINE_STATUSES.map((s, i) => {
          const done = currentIndex > i && currentIndex !== -1
          const current = currentIndex === i
          const label = REQUEST_STATUS_LABELS[s] ?? s
          const reached = done || current

          const inner = (
            <>
              {/* Connector back to the previous node. Skipped on the first
                  step, so nothing hangs off the left edge of the card. */}
              {i > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    top: CONNECTOR_TOP,
                    left: '-50%',
                    width: '100%',
                    height: '0.125rem',
                    zIndex: 0,
                    background: reached ? 'var(--color-brand)' : 'var(--color-border)',
                    transition: 'background-color 200ms ease',
                  }}
                />
              )}
              <span
                aria-hidden="true"
                className="flex items-center justify-center"
                style={{
                  position: 'relative',
                  zIndex: 1,
                  width: NODE_SIZE,
                  height: NODE_SIZE,
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                  border: `0.125rem solid ${reached ? 'var(--color-brand)' : 'var(--color-border)'}`,
                  background: done ? 'var(--color-brand)' : 'var(--color-bg)',
                  color: done ? 'var(--color-bg)' : 'var(--color-brand)',
                  boxShadow: current
                    ? '0 0 0 0.25rem color-mix(in srgb, var(--color-brand) 16%, transparent)'
                    : 'none',
                  transition: 'background-color 200ms ease, border-color 200ms ease',
                }}
              >
                {done
                  ? <Check size={13} strokeWidth={3} />
                  : (
                    <span
                      style={{
                        width: '0.4375rem',
                        height: '0.4375rem',
                        borderRadius: '50%',
                        background: current ? 'currentColor' : 'var(--color-border)',
                      }}
                    />
                  )}
              </span>
              <span
                className="truncate"
                style={{
                  maxWidth: '100%',
                  fontSize: '0.6875rem',
                  fontWeight: current ? 700 : 600,
                  lineHeight: 1.25,
                  color: reached ? 'var(--color-link)' : 'var(--color-text-subtle)',
                }}
              >
                {label}
              </span>
            </>
          )

          const stepLayout: React.CSSProperties = {
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.5rem',
            textAlign: 'center',
            minWidth: 0,
            width: '100%',
          }

          if (!interactive) {
            return (
              <li
                key={s}
                aria-current={current ? 'step' : undefined}
                className="flex-1"
                style={{ ...stepLayout, padding: '0.125rem 0.125rem 0' }}
              >
                {inner}
              </li>
            )
          }

          return (
            <li key={s} className="flex-1 flex" style={{ minWidth: 0 }}>
              <button
                type="button"
                disabled={busy}
                aria-current={current ? 'step' : undefined}
                title={current ? `This request is at ${label}` : `Move to ${label}`}
                onClick={() => { if (!busy && !current) onPick?.(s) }}
                className="tahi-focus-ring min-h-11 md:min-h-0"
                style={{
                  ...stepLayout,
                  padding: '0.25rem 0.125rem',
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  font: 'inherit',
                  cursor: busy ? 'not-allowed' : current ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  transition: 'background-color 150ms ease',
                }}
                onMouseEnter={e => { if (!busy) e.currentTarget.style.background = 'var(--color-bg-secondary)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                {inner}
              </button>
            </li>
          )
        })}
      </ol>

      {interactive && (
        <p
          className="text-center"
          style={{
            margin: '0.875rem 0 0',
            fontSize: '0.6875rem',
            fontWeight: 500,
            color: 'var(--color-text-subtle)',
          }}
        >
          Click a step to move this request.
        </p>
      )}
    </section>
  )
}
