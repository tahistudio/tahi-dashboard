'use client'

/**
 * WaitingOnYou - the hero of the client portal home.
 *
 * The old home led with a green KPI hero ("Awaiting your review: 2") and then
 * repeated the same facts one strip lower in a "Needs you" card whose rows had
 * a single verb. A client got a number they could not press and a verb that
 * usually routed them to a list.
 *
 * This is one tile that does both jobs: a dark forest feature surface (the only
 * deliberately dark surface in the portal, fixed in both themes like the rail)
 * carrying up to three RANKED, ACTIONABLE rows. Reviews first, then an invoice
 * (only ever passed in when the invoices read is actually allowed for this
 * seat), then a call that has a real meeting link. Every row does something:
 * a review opens the request on its approve view, an invoice opens the payment
 * page, a call opens the meeting. Nothing here is a count with no door.
 *
 * States, all five of them:
 *   loading   the tile holds its shape with pulsing rows (TASKS CT.3b - never
 *             "nothing waiting on you" while the fetch is still in flight).
 *             NOT .tahi-shimmer: that class is unlayered in globals.css and
 *             its gradient is opaque --color-bg-tertiary, so on this forest
 *             tile it painted a pale mint slab. See portal-home.css.
 *   error     the reads behind the tile failed, so it says so and offers a
 *             Try again rather than falling through to "All quiet"
 *   populated the ranked rows plus a real "+N more waiting" expander
 *   empty     a calm LIGHT card, "All quiet in the studio."
 *   read-only every write control disabled, with the lens note saying why
 *
 * Colour: the tile is fixed forest (documented in portal-home.css beside the
 * sidebar exemption); the empty card is entirely token-driven so dark mode is
 * free.
 */

import { useState } from 'react'
import { Icon, OfficialLeaf, type IconName } from '@/components/tahi/overview/ov-kit'
import './portal-home.css'

export interface WaitingAction {
  label: string
  /** Omitted (or undefined) renders the control disabled: a read-only lens, or
   *  an action this seat is not allowed to take. */
  onAct?: () => void
}

export interface WaitingItem {
  /** Stable key: the request / invoice / call id. */
  key: string
  kind: 'review' | 'invoice' | 'call'
  ic: IconName
  title: string
  sub: string
  /** The plain door to the underlying record, under the copy. */
  open?: { label: string; onOpen: () => void }
  primary: WaitingAction
  secondary?: WaitingAction
}

export interface WaitingOnYouProps {
  items: WaitingItem[]
  /** True until every read this tile depends on has answered one way or another. */
  loading?: boolean
  /** Read-only lens (an admin previewing a client). Disables every write. */
  ro?: boolean
  previewName?: string | null
  /** Empty-state CTA: opens the New request dialog. */
  onStart?: () => void
  /** True for a client with no requests at all, which gets the warmer copy. */
  isFirstRun?: boolean
  /** True when a read behind this tile failed (403 / 500 / offline). Beats
   *  every other state: a failed read must never read as "all quiet". */
  failed?: boolean
  /** Revalidates the failed reads. */
  onRetry?: () => void
}

const VISIBLE = 3

export function WaitingOnYou({
  items,
  loading,
  ro,
  previewName,
  onStart,
  isFirstRun,
  failed,
  onRetry,
}: WaitingOnYouProps) {
  const [expanded, setExpanded] = useState(false)

  // Loading first, always. A client with three deliveries waiting must never
  // read "All quiet in the studio." for the length of a round trip.
  if (loading) {
    return (
      <section className="pfh-tile is-loading" aria-busy="true" aria-label="Waiting on you, loading">
        <span className="pfh-tile-clip" aria-hidden="true">
          <span className="pfh-tile-leaf">
            <OfficialLeaf size={112} color="#eef6e9" />
          </span>
        </span>
        <div className="pfh-head">
          <h2>Waiting on you</h2>
        </div>
        <div className="pfh-skel-block" style={{ marginTop: '0.875rem' }}>
          <span className="pfh-skel-row" style={{ width: '78%' }} />
          <span className="pfh-skel-row" style={{ width: '54%' }} />
          <span className="pfh-skel-row" style={{ width: '66%' }} />
        </div>
        <span className="sr-only">Loading what needs you</span>
      </section>
    )
  }

  // A failed read outranks the empty state. "All quiet in the studio." to a
  // client whose requests route just 403'd is the same lie as saying it while
  // the fetch is still in flight, one round trip later.
  if (failed && items.length === 0) {
    return (
      <section className="pfh-err" aria-label="Waiting on you">
        <b>Your overview did not load.</b>
        <p>
          That is on us, not you. Nothing here is a reading of your account yet, so try again in a
          moment.
        </p>
        {onRetry && (
          <button type="button" className="pfh-err-cta tahi-focus-ring" onClick={onRetry}>
            Try again
          </button>
        )}
      </section>
    )
  }

  if (items.length === 0) {
    return (
      <section className="pfh-quiet" aria-label="Waiting on you">
        <span className="pfh-quiet-leaf" aria-hidden="true">
          <OfficialLeaf size={18} />
        </span>
        <div className="pfh-quiet-t">
          <b>All quiet in the studio.</b>
          <p>
            {isFirstRun
              ? 'Nothing here yet. Send us the first thing and you will watch every step of it from this page.'
              : 'Nothing is waiting on you right now. We will tell you the moment there is something to look at.'}
          </p>
          {onStart && (
            <button
              type="button"
              className="pfh-quiet-cta tahi-focus-ring"
              disabled={ro}
              onClick={ro ? undefined : onStart}
              title={ro ? `Read-only while you are viewing as ${previewName ?? 'the client'}` : undefined}
            >
              <Icon n="plus" s={15} />
              {isFirstRun ? 'Make your first request' : 'Start a request'}
            </button>
          )}
        </div>
      </section>
    )
  }

  // The expander is real: it shows the rest of the list rather than routing to
  // a page and asking the reader to find the same rows again.
  const shown = expanded ? items : items.slice(0, VISIBLE)
  const extra = items.length - VISIBLE

  return (
    <section className="pfh-tile" aria-label="Waiting on you">
      <span className="pfh-tile-clip" aria-hidden="true">
        <span className="pfh-tile-leaf">
          <OfficialLeaf size={112} color="#eef6e9" />
        </span>
      </span>

      <div className="pfh-head">
        <h2>Waiting on you</h2>
        <span className="pfh-count">{items.length}</span>
        <p>Everything below moves the moment you touch it.</p>
      </div>

      <ul className="pfh-list">
        {shown.map(it => (
          <li className="pfh-row" key={it.key}>
            <span className="pfh-row-ic" aria-hidden="true">
              <Icon n={it.ic} s={17} />
            </span>
            <span className="pfh-row-t">
              <b>{it.title}</b>
              <small>{it.sub}</small>
              {it.open && (
                <button type="button" className="pfh-open" onClick={it.open.onOpen}>
                  {it.open.label}
                  <Icon n="arrow" s={13} />
                </button>
              )}
            </span>
            <span className="pfh-acts">
              <WaitingButton kind="primary" action={it.primary} ro={ro} previewName={previewName} />
              {it.secondary && (
                <WaitingButton kind="ghost" action={it.secondary} ro={ro} previewName={previewName} />
              )}
            </span>
          </li>
        ))}
      </ul>

      {extra > 0 && (
        <button
          type="button"
          className="pfh-more"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show fewer' : `${extra} more waiting`}
          <Icon n={expanded ? 'up' : 'down'} s={13} />
        </button>
      )}

      {ro && (
        <p className="pfh-ro">
          <Icon n="clock" s={13} />
          You are reading this as {previewName ?? 'the client'}. Every action here is read-only in client view.
        </p>
      )}
    </section>
  )
}

function WaitingButton({
  kind,
  action,
  ro,
  previewName,
}: {
  kind: 'primary' | 'ghost'
  action: WaitingAction
  ro?: boolean
  previewName?: string | null
}) {
  // Disabled in the markup, not only by a CSS pointer rule: a keyboard walks
  // straight past pointer-events:none, and these are actions taken in somebody
  // else's name.
  const disabled = !!ro || !action.onAct
  return (
    <button
      type="button"
      className={`pfh-btn ${kind}`}
      disabled={disabled}
      onClick={disabled ? undefined : action.onAct}
      title={ro ? `Read-only while you are viewing as ${previewName ?? 'the client'}` : undefined}
    >
      {action.label}
    </button>
  )
}
