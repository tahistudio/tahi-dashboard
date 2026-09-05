'use client'

/**
 * The small pieces a Clients row is built out of: the identity cell, the
 * status pill, the health badge with its evidence, the track meter, the open
 * work count and the money cell.
 *
 * Every one of them is shared by the list rows, the mobile cards and the
 * portfolio cards, which is what keeps the three readings of a client saying
 * exactly the same thing. Nothing here fetches; they all take a ClientRow.
 */

import * as React from 'react'
import { Building2, Globe, MessageSquare } from 'lucide-react'
import { Avatar } from '@/components/tahi/avatar'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Money } from '@/components/tahi/money'
import { Tooltip } from '@/components/tahi/tooltip'
import {
  CLIENT_HEALTH_LABELS,
  CLIENT_STATUS_LABELS,
  ENGAGEMENT_LABEL,
  healthKeyOf,
  healthReasons,
  type ClientRow,
  type ClientTracks,
} from './clients-views'

// -- Status ------------------------------------------------------------------

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'positive',
  paused: 'warning',
  churned: 'danger',
  archived: 'neutral',
  prospect: 'info',
}

export function ClientStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} variant="soft" size="sm" dot={false}>
      {CLIENT_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}

// -- Health ------------------------------------------------------------------

const HEALTH_TONE: Record<string, BadgeTone> = {
  red: 'danger',
  amber: 'warning',
  green: 'positive',
  none: 'neutral',
}

/**
 * The badge is the claim; the bubble is the evidence. `showOnTap` is set so a
 * phone can reach the reasons too: a health verdict a touch user cannot open
 * would be a hover-only affordance, which the house rules forbid.
 */
export function ClientHealthBadge({ row, compact = false }: { row: ClientRow; compact?: boolean }) {
  const key = healthKeyOf(row)
  const reasons = compact ? [] : healthReasons(row)
  const badge = (
    <Badge tone={HEALTH_TONE[key] ?? 'neutral'} variant="soft" size="sm" dot>
      {CLIENT_HEALTH_LABELS[key]}
    </Badge>
  )
  if (reasons.length === 0) return badge
  return (
    <Tooltip
      showOnTap
      asChild
      side="top"
      label={
        <span style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', maxWidth: '16rem', textAlign: 'left' }}>
          <span style={{ fontWeight: 700 }}>{CLIENT_HEALTH_LABELS[key]}</span>
          {reasons.map(reason => (
            <span key={reason} style={{ fontWeight: 500, opacity: 0.85 }}>{reason}</span>
          ))}
        </span>
      }
    >
      {badge}
    </Tooltip>
  )
}

// -- Track meter -------------------------------------------------------------

/**
 * One segment per configured track, wide for a large track and narrow for a
 * small one. It reads the client's track CONFIGURATION, not live occupancy:
 * the clients list endpoint carries tracks_mode and the custom counts, and
 * nothing about what is sitting on a track right now. Saying "2 tracks" and
 * meaning it beats filling segments from a number that does not exist.
 */
export function TrackMeterCell({ tracks, engagement }: { tracks: ClientTracks; engagement: ClientRow['engagement'] }) {
  if (tracks.total === 0) {
    return (
      <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
        {tracks.mode === 'off' ? 'Tracks off' : ENGAGEMENT_LABEL[engagement]}
      </span>
    )
  }
  const segments: React.ReactNode[] = []
  for (let i = 0; i < tracks.large; i += 1) {
    segments.push(<Segment key={`l${i}`} wide />)
  }
  for (let i = 0; i < tracks.small; i += 1) {
    segments.push(<Segment key={`s${i}`} />)
  }
  const label = `${tracks.total} ${tracks.total === 1 ? 'track' : 'tracks'}`
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
      title={`${tracks.large} large, ${tracks.small} small${tracks.mode === 'custom' ? ', set by hand' : ''}`}
    >
      <span style={{ display: 'inline-flex', gap: '0.1875rem' }} aria-hidden="true">{segments}</span>
      <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
        {label}
      </span>
    </span>
  )
}

function Segment({ wide = false }: { wide?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: wide ? '1.125rem' : '0.625rem',
        height: '0.375rem',
        borderRadius: 'var(--radius-full)',
        background: wide ? 'var(--color-brand)' : 'var(--color-brand-light)',
      }}
    />
  )
}

// -- Identity ----------------------------------------------------------------

/** The name, what they do, and how many brands sit under them. `data-private`
 *  stays on the name and the website: Private view blurs on that attribute
 *  alone, and a rewritten cell that drops it leaks a client in a screen share. */
export function ClientCell({ row, size = 'sm' }: { row: ClientRow; size?: 'sm' | 'md' | 'lg' }) {
  const website = row.website ? row.website.replace(/^https?:\/\//, '').replace(/\/$/, '') : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', minWidth: 0 }}>
      <Avatar name={row.name} size={size} />
      <div style={{ minWidth: 0 }}>
        <div
          data-private
          style={{
            fontWeight: 600,
            fontSize: '0.8125rem',
            color: row.status === 'active' ? 'var(--color-text)' : 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.name}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            fontSize: '0.6875rem',
            color: 'var(--color-text-subtle)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {row.industry && <span>{row.industry}</span>}
          {row.industry && website && <span aria-hidden="true">.</span>}
          {website && (
            <span data-private style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <Globe size={10} aria-hidden="true" />
              {website}
            </span>
          )}
          {row.brandCount > 1 && (
            <>
              <span aria-hidden="true">.</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                <Building2 size={10} aria-hidden="true" />
                {row.brandCount} brands
              </span>
            </>
          )}
          {!row.industry && !website && row.brandCount <= 1 && <span>No details yet</span>}
        </div>
      </div>
    </div>
  )
}

// -- Open work ---------------------------------------------------------------

export function OpenWorkCell({ row }: { row: ClientRow }) {
  const n = row.openRequestCount
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3125rem',
        fontSize: '0.75rem',
        fontWeight: n > 0 ? 600 : 500,
        color: n > 0 ? 'var(--color-text)' : 'var(--color-text-subtle)',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <MessageSquare size={11} aria-hidden="true" />
      {n === 0 ? 'None open' : n}
    </span>
  )
}

// -- Money -------------------------------------------------------------------

/**
 * MRR, or the engagement word when there is none to show. Never a dash: a
 * project client has no monthly figure, and saying so is more use than an
 * empty cell. `sensitive` puts data-private on the figure.
 */
export function ClientMoneyCell({ row, unknownLabel }: { row: ClientRow; unknownLabel?: string }) {
  if (row.mrrNzd != null && row.mrrNzd > 0) {
    return (
      <Money
        nzd={row.mrrNzd}
        sensitive
        style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--color-text)' }}
      />
    )
  }
  const fallback = unknownLabel
    ?? (row.engagement === 'retainer' ? 'Not set' : ENGAGEMENT_LABEL[row.engagement])
  return (
    <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
      {fallback}
    </span>
  )
}

// -- Tags --------------------------------------------------------------------

export function ClientTagChips({ tags, max = 2 }: { tags: readonly string[]; max?: number }) {
  if (tags.length === 0) return null
  const shown = tags.slice(0, max)
  const extra = tags.length - shown.length
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap' }}>
      {shown.map(tag => (
        <Badge key={tag} tone="neutral" variant="outline" size="sm" dot={false}>{tag}</Badge>
      ))}
      {extra > 0 && (
        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)' }}>
          +{extra}
        </span>
      )}
    </span>
  )
}
