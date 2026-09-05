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
 * without measuring anything. Vertically it has to clear the step's own
 * padding as well as reach the node waist, because `top` resolves from the
 * padding box: see STEP_PAD_TOP and CONNECTOR_TOP below.
 *
 * Off-pipeline statuses (draft, on_hold, cancelled, archived) are not steps.
 * The parent decides whether to render the spine at all; when the current
 * status is off-pipeline the spine shows no current step rather than
 * pretending the request is at "Submitted".
 *
 * Hover and focus live in SPINE_CSS rather than in inline handlers, because
 * the prototype's affordance is entirely on the step's CHILDREN: the node
 * grows a brand ring and the label tints brand, while the step box itself
 * stays transparent (no grey wash). A parent cannot style a child from an
 * inline style, and an inline style would in any case outrank the rule, so
 * the node's own resting ring is a class too. Scoped to this component the
 * way <CapacityStrip> keeps CAPACITY_CSS, so nothing lands in globals.css.
 */

import { AlertTriangle, Check } from 'lucide-react'
import { REQUEST_STATUS_LABELS } from '@/lib/status-config'

/**
 * The step's whole visual state machine. Ported from the prototype's
 * `.req-spine-*` rules (requests.css) plus the round-two hover in
 * requests-detail.css: brand border and a 0.3125rem brand halo on the node,
 * brand-dark label, and a 1px lift on the step. The focus ring itself stays
 * with `.tahi-focus-ring` on the button, so keyboard users get both.
 */
const SPINE_CSS = `
.tahi-spine-node{
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius-full);
  border: 0.125rem solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-brand);
  transition:
    background-color var(--motion-base) var(--ease-out),
    border-color var(--motion-base) var(--ease-out),
    box-shadow var(--motion-base) var(--ease-out);
}
.tahi-spine-node.is-reached{ border-color: var(--color-brand); }
.tahi-spine-node.is-done{ background: var(--color-brand); color: var(--color-bg); }
.tahi-spine-node.is-current{
  box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--color-brand) 16%, transparent);
}
.tahi-spine-dot{
  width: 0.4375rem;
  height: 0.4375rem;
  border-radius: var(--radius-full);
  background: var(--color-border);
  transition: background-color var(--motion-base) var(--ease-out);
}
.tahi-spine-node.is-current .tahi-spine-dot{ background: currentColor; }
.tahi-spine-lbl{
  max-width: 100%;
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text-subtle);
  transition: color var(--motion-base) var(--ease-out);
}
.tahi-spine-lbl.is-reached{ color: var(--color-text); }
.tahi-spine-lbl.is-current{ color: var(--color-link); font-weight: 700; }
.tahi-spine-step{ transition: transform var(--motion-base) var(--ease-out); }
.tahi-spine-step:hover:not(:disabled),
.tahi-spine-step:focus-visible{ transform: translateY(-0.0625rem); }
.tahi-spine-step:hover:not(:disabled) .tahi-spine-node,
.tahi-spine-step:focus-visible .tahi-spine-node{
  border-color: var(--color-brand);
  box-shadow: 0 0 0 0.3125rem color-mix(in srgb, var(--color-brand) 20%, transparent);
}
.tahi-spine-step:hover:not(:disabled) .tahi-spine-dot,
.tahi-spine-step:focus-visible .tahi-spine-dot{ background: var(--color-brand); }
.tahi-spine-step:hover:not(:disabled) .tahi-spine-lbl,
.tahi-spine-step:focus-visible .tahi-spine-lbl{ color: var(--color-link); }
@media (prefers-reduced-motion: reduce){
  .tahi-spine-step,
  .tahi-spine-node,
  .tahi-spine-dot,
  .tahi-spine-lbl{ transition: none; }
  .tahi-spine-step:hover:not(:disabled),
  .tahi-spine-step:focus-visible{ transform: none; }
}
`

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
  /** Open blockers on this request. Above zero, the header carries an amber
   *  chip. Deliberately NOT a sixth node: every entry in PIPELINE_STATUSES is
   *  a status setter, and a blocked request is usually still in progress. The
   *  count is derived and coexists with any pipeline status, where `on_hold`
   *  stays the manual human stop. Admin only, and the studio is the only
   *  audience that ever receives it. */
  blockedByCount?: number
}

/**
 * Vertical padding on the step box. Identical for both audiences, so the
 * studio spine and the client spine draw the same geometry, and folded into
 * CONNECTOR_TOP below because `top` on an absolutely positioned child
 * resolves from the containing block's PADDING box, not its border box.
 */
const STEP_PAD_TOP = '0.25rem'
/** Half the node minus half the connector, measured from the node's top edge.
 *  The node itself is 1.5rem with a 0.125rem ring, both set in SPINE_CSS. */
const NODE_WAIST = '0.6875rem'
/** Where the connector sits, so the bar hits the node's waist exactly. */
const CONNECTOR_TOP = `calc(${STEP_PAD_TOP} + ${NODE_WAIST})`

export function DeliverySpine({
  status,
  interactive = false,
  onPick,
  busy = false,
  eta,
  blockedByCount = 0,
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
      <style>{SPINE_CSS}</style>
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
        {blockedByCount > 0 && (
          <span
            className="inline-flex items-center"
            style={{
              // Not --color-warning-bg / --color-warning-text: the second does
              // not exist and the first is deliberately not overridden in
              // .dark. The badge family resolves for both themes.
              gap: '0.25rem',
              padding: '0.0625rem 0.375rem',
              borderRadius: 'var(--radius-badge)',
              border: '1px solid var(--badge-warning-border)',
              background: 'var(--badge-warning-bg)',
              color: 'var(--badge-warning-text)',
              fontSize: '0.6875rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            <AlertTriangle size={11} aria-hidden="true" />
            Blocked by {blockedByCount}
          </span>
        )}
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
                className={[
                  'tahi-spine-node',
                  reached ? 'is-reached' : '',
                  done ? 'is-done' : '',
                  current ? 'is-current' : '',
                ].filter(Boolean).join(' ')}
              >
                {done
                  ? <Check size={13} strokeWidth={3} />
                  : <span className="tahi-spine-dot" />}
              </span>
              <span
                className={[
                  'tahi-spine-lbl truncate',
                  reached ? 'is-reached' : '',
                  current ? 'is-current' : '',
                ].filter(Boolean).join(' ')}
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
            // Shared by both audiences so the connector's `top` lands on the
            // node waist either way. Changing this means changing
            // STEP_PAD_TOP, not this line.
            padding: `${STEP_PAD_TOP} 0.125rem`,
          }

          if (!interactive) {
            return (
              <li
                key={s}
                aria-current={current ? 'step' : undefined}
                className="flex-1"
                style={stepLayout}
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
                className="tahi-spine-step tahi-focus-ring min-h-11 md:min-h-0"
                style={{
                  ...stepLayout,
                  border: 'none',
                  borderRadius: 'var(--radius-md)',
                  background: 'transparent',
                  font: 'inherit',
                  cursor: busy ? 'not-allowed' : current ? 'default' : 'pointer',
                  opacity: busy ? 0.6 : 1,
                }}
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
