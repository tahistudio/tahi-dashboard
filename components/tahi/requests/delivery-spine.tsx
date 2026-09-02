'use client'

/**
 * <DeliverySpine> — the request detail's status strip, made clickable.
 *
 * Five pipeline steps drawn as a connected track. For a studio audience
 * every step is a button that moves the request there (the parent runs the
 * optimistic PATCH and the toast), with a hint line under the track. For a
 * client, and for anyone in read-only client view, the same track renders
 * as plain markup with no affordance.
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

export function DeliverySpine({
  status,
  interactive = false,
  onPick,
  busy = false,
  eta,
}: DeliverySpineProps) {
  const currentIndex = PIPELINE_STATUSES.indexOf(status as PipelineStatus)

  return (
    <div
      style={{
        padding: '0.875rem 1.5rem 1rem',
        borderTop: '1px solid var(--color-border-subtle)',
        background: 'var(--color-bg-secondary)',
        borderBottomLeftRadius: '0.75rem',
        borderBottomRightRadius: '0.75rem',
      }}
    >
      <div
        className="flex items-center"
        style={{ gap: '0.5rem', marginBottom: '0.625rem' }}
      >
        <h2
          className="uppercase"
          style={{
            margin: 0,
            fontSize: '0.6875rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            color: 'var(--color-text-muted)',
          }}
        >
          Delivery
        </h2>
        {eta && (
          <span
            style={{
              marginLeft: 'auto',
              fontSize: '0.6875rem',
              fontWeight: 500,
              color: 'var(--color-text-subtle)',
            }}
          >
            {eta}
          </span>
        )}
      </div>

      <ol
        aria-label="Delivery steps"
        className="flex items-stretch"
        style={{ listStyle: 'none', margin: 0, padding: 0, gap: '0.375rem' }}
      >
        {PIPELINE_STATUSES.map((s, i) => {
          const done = currentIndex > i && currentIndex !== -1
          const current = currentIndex === i
          const label = REQUEST_STATUS_LABELS[s] ?? s
          const barColor = done || current ? 'var(--color-brand)' : 'var(--color-border)'

          const inner = (
            <>
              <span
                aria-hidden="true"
                style={{
                  height: '0.1875rem',
                  borderRadius: '0.125rem',
                  background: barColor,
                  transition: 'background-color 200ms ease',
                }}
              />
              <span
                className="flex items-center"
                style={{ gap: '0.25rem', minWidth: 0 }}
              >
                {done && (
                  <Check size={11} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-brand)' }} />
                )}
                <span
                  className="truncate"
                  style={{
                    fontSize: '0.6875rem',
                    fontWeight: current ? 600 : 400,
                    color: current ? 'var(--color-brand-dark)' : 'var(--color-text-subtle)',
                  }}
                >
                  {label}
                </span>
              </span>
            </>
          )

          if (!interactive) {
            return (
              <li
                key={s}
                aria-current={current ? 'step' : undefined}
                className="flex-1 flex flex-col"
                style={{ gap: '0.25rem', minWidth: 0 }}
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
                className="tahi-focus-ring flex-1 flex flex-col min-h-11 md:min-h-[2.25rem]"
                style={{
                  gap: '0.25rem',
                  minWidth: 0,
                  padding: '0.25rem 0.125rem',
                  border: 'none',
                  borderRadius: 'var(--radius-sm)',
                  background: 'transparent',
                  textAlign: 'left',
                  cursor: busy ? 'not-allowed' : current ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                  justifyContent: 'center',
                  transition: 'background-color 150ms ease',
                }}
                onMouseEnter={e => { if (!busy) e.currentTarget.style.background = 'var(--color-bg-tertiary)' }}
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
            margin: '0.75rem 0 0',
            fontSize: '0.6875rem',
            fontWeight: 500,
            color: 'var(--color-text-subtle)',
          }}
        >
          Click a step to move this request.
        </p>
      )}
    </div>
  )
}
