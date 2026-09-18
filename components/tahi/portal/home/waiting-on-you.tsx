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
 *   empty     the SAME dark forest tile as every other state, body swapped
 *             for the calm "All quiet in the studio." copy plus, only when
 *             there is genuinely nothing open, a plain text link. This used
 *             to drop to a separate light card with its own leaf badge, so
 *             the one surface that is supposed to stay fixed-dark went pale
 *             the moment a client had nothing waiting. One panel now, two
 *             bodies.
 *   read-only every write control disabled, with the lens note saying why
 *
 * Colour: the tile is fixed forest in every one of these states, including
 * empty (documented in portal-home.css beside the sidebar exemption). Nothing
 * on this component reads a light surface any more.
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
  /** 'handoff' is Liam's client hand-off feature: a request the studio has
   *  explicitly handed to this contact for a reason (approval, content,
   *  access, a decision, a file, or something else). Distinct from 'review',
   *  which is always the client_review status regardless of who it is
   *  addressed to. */
  kind: 'review' | 'invoice' | 'call' | 'handoff'
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
  /**
   * True when the client has at least one open request already. The header
   * above this tile, and the work board below it, both carry their own
   * "New request" door: offering a THIRD one here to a client who already has
   * work in flight reads as spam. Only a client with zero open requests sees
   * the plain text link; anyone else gets the empty-state copy with nothing
   * to press.
   */
  hasOpenRequests?: boolean
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
  hasOpenRequests,
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
      <section className="pfh-tile" aria-label="Waiting on you">
        <span className="pfh-tile-clip" aria-hidden="true">
          <span className="pfh-tile-leaf">
            <OfficialLeaf size={112} color="#eef6e9" />
          </span>
        </span>

        <div className="pfh-head">
          <h2>Waiting on you</h2>
        </div>

        <div className="pfh-quiet-body">
          <b>All quiet in the studio.</b>
          <p>
            {isFirstRun
              ? 'Nothing here yet. Send us the first thing and you will watch every step of it from this page.'
              : 'Nothing is waiting on you right now. We will tell you the moment there is something to look at.'}
          </p>
          {/* The header above already carries the one primary "New request"
              CTA. Offering a second one here, to a client who has open work
              in flight, is the exact spam this tile used to be part of: a
              plain text link, and only when there is genuinely nothing open
              to start from. Anyone with an open request reads plain copy and
              nothing to press. */}
          {onStart && !hasOpenRequests && (
            <button
              type="button"
              className="pfh-quiet-link"
              disabled={ro}
              onClick={ro ? undefined : onStart}
              title={ro ? `Read-only while you are viewing as ${previewName ?? 'the client'}` : undefined}
            >
              {isFirstRun ? 'Make your first request' : 'Start a request'}
            </button>
          )}
        </div>

        {ro && (
          <p className="pfh-ro">
            <Icon n="clock" s={13} />
            You are reading this as {previewName ?? 'the client'}. Every action here is read-only in client view.
          </p>
        )}
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

// ── "Also waiting on your team" ─────────────────────────────────────────────

/**
 * <WaitingOnTeam>. The org admin's quiet sibling to <WaitingOnYou>: the same
 * hand-off pointers, but addressed to a colleague at the same org rather
 * than to the caller. Read-only and informational, so it is a plain light
 * card under the dark forest hero rather than a second dark tile competing
 * with it, and it carries no action buttons of its own: an org admin can see
 * what the team is waiting on, not act on somebody else's behalf.
 *
 * Renders nothing while loading and nothing when the list is empty, since an
 * "also waiting" card with zero rows under a tile that has already said "All
 * quiet" or listed the caller's own items would only repeat the page.
 */
export interface WaitingOnTeamItem {
  /** Stable key: the request id. */
  key: string
  /** The colleague this item is addressed to, first name is enough. */
  contactName: string
  requestTitle: string
  /** Short reason word ("approval", "content", ...), not the full sentence:
   *  this list is a scan, not a read. */
  reasonLabel: string
  daysWaiting: number
  onOpen?: () => void
}

export interface WaitingOnTeamProps {
  items: WaitingOnTeamItem[]
  loading?: boolean
}

export function WaitingOnTeam({ items, loading }: WaitingOnTeamProps) {
  if (loading) {
    return (
      <section
        aria-busy="true"
        aria-label="Also waiting on your team, loading"
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-bg)',
          padding: '0.875rem 1rem',
          marginTop: '0.75rem',
        }}
      >
        <div className="flex flex-col animate-pulse" style={{ gap: '0.375rem' }}>
          <span style={{ height: '0.75rem', width: '40%', borderRadius: '0.25rem', background: 'var(--color-bg-tertiary)' }} />
          <span style={{ height: '0.75rem', width: '70%', borderRadius: '0.25rem', background: 'var(--color-bg-tertiary)' }} />
        </div>
      </section>
    )
  }

  if (items.length === 0) return null

  return (
    <section
      aria-label="Also waiting on your team"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg)',
        padding: '0.875rem 1rem',
        marginTop: '0.75rem',
      }}
    >
      <h3
        style={{
          margin: '0 0 0.5rem',
          fontSize: '0.71875rem',
          fontWeight: 700,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
        }}
      >
        Also waiting on your team
      </h3>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        {items.map(it => (
          <li key={it.key}>
            <button
              type="button"
              onClick={it.onOpen}
              disabled={!it.onOpen}
              className="tahi-focus-ring"
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                minHeight: '2.75rem',
                gap: '0.5rem',
                padding: '0.375rem 0.5rem',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
                cursor: it.onOpen ? 'pointer' : 'default',
                textAlign: 'left',
              }}
            >
              <span
                style={{
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'var(--color-text)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {it.requestTitle}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', flexShrink: 0 }}>
                {it.contactName} · {it.reasonLabel} · {it.daysWaiting}d
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
