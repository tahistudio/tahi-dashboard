'use client'

/**
 * The phone reading of a Clients row, handed to <DataTable mobileCard>. Below
 * md the table is replaced by these, so this card also has to carry the row
 * actions the 3-dots column would have carried: the card itself opens the
 * client, and the two buttons under it are 2.75rem targets in their own right.
 */

import * as React from 'react'
import { ArrowUpRight, Eye } from 'lucide-react'
import { RelativeTime } from '@/components/tahi/relative-time'
import { PlanBadge } from '@/components/tahi/status-badge'
import {
  ClientCell,
  ClientHealthBadge,
  ClientMoneyCell,
  ClientStatusBadge,
  ClientTagChips,
  OpenWorkCell,
  TrackMeterCell,
} from './client-chips'
import type { ClientRow } from './clients-views'

export function ClientMobileCard({
  row,
  canSeeMoney,
  selected,
  onToggleSelect,
  onOpen,
  onViewAs,
}: {
  row: ClientRow
  canSeeMoney: boolean
  selected: boolean
  onToggleSelect: () => void
  onOpen: () => void
  onViewAs: (() => void) | null
}) {
  const activity = row.updatedAt ?? row.createdAt
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        padding: '0.875rem 1rem',
        border: `1px solid ${selected ? 'var(--color-brand)' : 'var(--color-border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        background: selected ? 'var(--color-brand-50)' : 'var(--color-bg)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? `Deselect ${row.name}` : `Select ${row.name}`}
          onClick={onToggleSelect}
          className="tahi-focus-ring inline-flex items-center justify-center"
          style={{
            flexShrink: 0,
            width: '2.75rem',
            height: '2.75rem',
            margin: '-0.5rem 0 -0.5rem -0.5rem',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            background: 'transparent',
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '1.125rem',
              height: '1.125rem',
              boxSizing: 'border-box',
              borderRadius: 'var(--radius-sm)',
              border: `1px solid ${selected ? 'var(--color-brand)' : 'var(--color-border)'}`,
              background: selected ? 'var(--color-brand)' : 'var(--color-bg)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {selected && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-on-dark)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12.5l5.5 5.5L20 6.5" />
              </svg>
            )}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpen}
          className="tahi-focus-ring"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'block',
            padding: 0,
            border: 'none',
            background: 'transparent',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <ClientCell row={row} size="md" />
        </button>

        <span style={{ flexShrink: 0 }}>
          <ClientHealthBadge row={row} />
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem 0.625rem' }}>
        <ClientStatusBadge status={row.status} />
        <PlanBadge plan={row.planType} />
        <TrackMeterCell tracks={row.tracks} engagement={row.engagement} />
        {canSeeMoney && <ClientMoneyCell row={row} />}
        <OpenWorkCell row={row} />
      </div>

      <ClientTagChips tags={row.tags} max={3} />

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginRight: 'auto' }}>
          {activity ? <>Active <RelativeTime date={activity} /></> : 'No activity yet'}
        </span>
        <MobileAction label="Open" icon={<ArrowUpRight size={14} aria-hidden="true" />} onClick={onOpen} />
        {onViewAs && (
          <MobileAction label="View as client" icon={<Eye size={14} aria-hidden="true" />} onClick={onViewAs} />
        )}
      </div>
    </div>
  )
}

function MobileAction({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tahi-focus-ring inline-flex items-center"
      style={{
        gap: '0.375rem',
        minHeight: '2.75rem',
        padding: '0 0.75rem',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-bg)',
        fontFamily: 'inherit',
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        cursor: 'pointer',
        transition: 'border-color var(--motion-quick) var(--ease-out), color var(--motion-quick) var(--ease-out)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--color-brand)'
        e.currentTarget.style.color = 'var(--color-brand-dark)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.color = 'var(--color-text-muted)'
      }}
    >
      {icon}
      {label}
    </button>
  )
}
