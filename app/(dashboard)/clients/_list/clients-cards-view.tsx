'use client'

/**
 * The portfolio lens: the same facts as the list, one tile per account, health
 * first. Reads the identical <ClientRow> and the identical chips as the list,
 * so switching view can never change what a client appears to be.
 *
 * The tile is a link overlay rather than a card-shaped <button>. The health
 * badge carries its own tooltip and its own tab stop, and a tap-interactive,
 * focusable trigger cannot live inside a button: on touch the bubble would
 * open and the same tap would fall straight through to the card. So the card
 * is a plain box, one transparent button fills it and owns the navigation, and
 * the content above it is inert except for the badge.
 */

import * as React from 'react'
import { PlanBadge } from '@/components/tahi/status-badge'
import { RelativeTime } from '@/components/tahi/relative-time'
import { Avatar } from '@/components/tahi/avatar'
import {
  ClientHealthBadge,
  ClientMoneyCell,
  ClientOwnerCell,
  ClientStatusBadge,
  ClientTagChips,
  TrackMeterCell,
} from './client-chips'
import { ENGAGEMENT_LABEL, healthReasons, type ClientRow } from './clients-views'

export function ClientsCardsView({
  rows,
  canSeeMoney,
  mrrUnknown,
  ownersKnown,
  onOpen,
}: {
  rows: readonly ClientRow[]
  canSeeMoney: boolean
  /** The money read failed, so the cell says so rather than "Not set". */
  mrrUnknown: boolean
  ownersKnown: boolean
  onOpen: (row: ClientRow) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(17.5rem, 1fr))',
        gap: '0.875rem',
      }}
    >
      {rows.map(row => (
        <ClientCard
          key={row.id}
          row={row}
          canSeeMoney={canSeeMoney}
          mrrUnknown={mrrUnknown}
          ownersKnown={ownersKnown}
          onOpen={() => onOpen(row)}
        />
      ))}
    </div>
  )
}

function ClientCard({
  row,
  canSeeMoney,
  mrrUnknown,
  ownersKnown,
  onOpen,
}: {
  row: ClientRow
  canSeeMoney: boolean
  mrrUnknown: boolean
  ownersKnown: boolean
  onOpen: () => void
}) {
  const why = healthReasons(row)[0] ?? 'Nothing to report.'
  const activity = row.updatedAt ?? row.createdAt
  const [hover, setHover] = React.useState(false)

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        padding: '0.9375rem 1rem 1rem',
        border: `1px solid ${hover ? 'var(--color-brand)' : 'var(--color-border)'}`,
        borderRadius: 'var(--radius-lg)',
        background: hover ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
        transition: 'border-color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
      }}
    >
      {/* The whole tile, as one control. It sits under the content, so the
          focus ring draws around the card and every inert pixel opens the
          client. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${row.name}`}
        className="tahi-focus-ring"
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          minHeight: '2.75rem',
          padding: 0,
          border: 'none',
          borderRadius: 'var(--radius-lg)',
          background: 'transparent',
          cursor: 'pointer',
        }}
      />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: '0.625rem', pointerEvents: 'none' }}>
        <Avatar name={row.name} size="lg" />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.1875rem' }}>
          <span
            data-private
            style={{
              fontWeight: 700,
              fontSize: '0.9375rem',
              color: 'var(--color-text)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.name}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
            <PlanBadge plan={row.planType} />
            {row.status !== 'active' && <ClientStatusBadge status={row.status} />}
          </span>
        </div>
        {/* The one live thing above the overlay: the health evidence opens on
            hover, on focus and on tap, and the tap never reaches the card. */}
        <span style={{ pointerEvents: 'auto' }} onClick={e => e.stopPropagation()}>
          <ClientHealthBadge row={row} />
        </span>
      </div>

      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem', pointerEvents: 'none' }}>
        <Stat label={canSeeMoney ? 'MRR' : 'Engagement'}>
          {canSeeMoney
            ? <ClientMoneyCell row={row} unknownLabel={mrrUnknown ? 'Unknown' : undefined} />
            : <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{ENGAGEMENT_LABEL[row.engagement]}</span>}
        </Stat>
        <Stat label="Open">
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {row.openRequestCount}
          </span>
        </Stat>
        <Stat label="Tracks">
          <TrackMeterCell tracks={row.tracks} engagement={row.engagement} />
        </Stat>
      </div>

      <span
        style={{
          position: 'relative',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          fontSize: '0.78125rem',
          lineHeight: 1.45,
          color: 'var(--color-text-muted)',
          pointerEvents: 'none',
        }}
      >
        {why}
      </span>

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', pointerEvents: 'none' }}>
        <ClientOwnerCell row={row} known={ownersKnown} />
        <ClientTagChips tags={row.tags} max={2} />
        <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
          {activity ? <>Active <RelativeTime date={activity} /></> : 'No activity yet'}
        </span>
      </div>
    </div>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.1875rem',
        minWidth: 0,
        padding: '0.5rem 0.625rem',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg-secondary)',
      }}
    >
      <span
        style={{
          fontSize: '0.625rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
        }}
      >
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', minWidth: 0, color: 'var(--color-text)' }}>
        {children}
      </span>
    </span>
  )
}
