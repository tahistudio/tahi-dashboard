'use client'

/**
 * The portfolio lens: the same facts as the list, one tile per account, health
 * first. Reads the identical <ClientRow> and the identical chips as the list,
 * so switching view can never change what a client appears to be.
 *
 * The tile is a real button, so it is reachable by keyboard and its focus ring
 * is the shared one. Nothing inside it is hover-only.
 */

import * as React from 'react'
import { PlanBadge } from '@/components/tahi/status-badge'
import { RelativeTime } from '@/components/tahi/relative-time'
import { Avatar } from '@/components/tahi/avatar'
import {
  ClientHealthBadge,
  ClientMoneyCell,
  ClientStatusBadge,
  ClientTagChips,
  TrackMeterCell,
} from './client-chips'
import { ENGAGEMENT_LABEL, healthReasons, type ClientRow } from './clients-views'

export function ClientsCardsView({
  rows,
  canSeeMoney,
  onOpen,
}: {
  rows: readonly ClientRow[]
  canSeeMoney: boolean
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
        <ClientCard key={row.id} row={row} canSeeMoney={canSeeMoney} onOpen={() => onOpen(row)} />
      ))}
    </div>
  )
}

function ClientCard({ row, canSeeMoney, onOpen }: { row: ClientRow; canSeeMoney: boolean; onOpen: () => void }) {
  const why = healthReasons(row)[0] ?? 'Nothing to report.'
  const activity = row.updatedAt ?? row.createdAt
  return (
    <button
      type="button"
      onClick={onOpen}
      className="tahi-focus-ring"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        minHeight: '2.75rem',
        padding: '0.9375rem 1rem 1rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-bg)',
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'border-color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-brand)'
        e.currentTarget.style.background = 'var(--color-bg-secondary)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.background = 'var(--color-bg)'
      }}
    >
      <span style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
        <Avatar name={row.name} size="lg" />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.1875rem' }}>
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
        </span>
        <ClientHealthBadge row={row} />
      </span>

      <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.5rem' }}>
        <Stat label={canSeeMoney ? 'MRR' : 'Engagement'}>
          {canSeeMoney
            ? <ClientMoneyCell row={row} />
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
      </span>

      <span
        style={{
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          fontSize: '0.78125rem',
          lineHeight: 1.45,
          color: 'var(--color-text-muted)',
        }}
      >
        {why}
      </span>

      <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <ClientTagChips tags={row.tags} max={2} />
        <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
          {activity ? <>Active <RelativeTime date={activity} /></> : 'No activity yet'}
        </span>
      </span>
    </button>
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
