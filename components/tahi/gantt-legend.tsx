/**
 * <GanttLegend> — shared legend for the project schedule grid. Used by
 * both the admin editor and the public viewer so the visual language
 * stays in sync.
 *
 * Each owner colour is rendered as a tiny bar; the risk overlay is the
 * actual hatched gradient; gates render as the same diamond shapes used
 * in the grid itself.
 */
'use client'

import React from 'react'

const RISK_OVERLAY =
  'repeating-linear-gradient(45deg, rgba(248, 113, 113, 0.95) 0 4px, transparent 4px 8px)'

interface GanttLegendProps {
  /** Compact mode — smaller swatches, denser spacing. */
  compact?: boolean
  /** Light theme — darker text on a pale background. Defaults to true.
   *  Set false when rendering on a dark surface. */
  light?: boolean
}

export function GanttLegend({ compact = false, light = true }: GanttLegendProps) {
  const subtleColor = light ? 'var(--color-text-subtle)' : 'rgba(255,255,255,0.55)'
  const labelColor = light ? 'var(--color-text-muted)' : 'rgba(255,255,255,0.85)'

  return (
    <div
      className="flex flex-wrap items-center"
      style={{
        gap: compact ? '0.625rem' : '1rem',
        padding: compact ? '0.625rem 0.75rem' : '0.875rem 1rem',
        background: light ? 'var(--color-bg-secondary)' : 'rgba(255,255,255,0.06)',
        border: `1px solid ${light ? 'var(--color-border-subtle)' : 'rgba(255,255,255,0.12)'}`,
        borderRadius: 'var(--radius-md)',
        fontSize: compact ? '0.6875rem' : '0.75rem',
        color: labelColor,
        rowGap: '0.5rem',
      }}
    >
      <Item label="Tahi" swatch={<Swatch color="#5A824E" />} />
      <Item label="Client" swatch={<Swatch color="#1f2c1a" />} />
      <Item label="Joint" swatch={<Swatch color="#d4a017" />} />
      <Item label="Tahi parallel" swatch={<Swatch color="#a8c89e" />} />
      <Divider color={subtleColor} />
      <Item label="Sign-off gate" swatch={<Diamond />} />
      <Item label="Critical gate" swatch={<Diamond critical />} />
      <Divider color={subtleColor} />
      <Item label="Risk of delay" swatch={<Swatch baseColor="#5A824E" overlay={RISK_OVERLAY} />} />
    </div>
  )
}

function Item({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center" style={{ gap: '0.4375rem' }}>
      {swatch}
      <span style={{ fontWeight: 500 }}>{label}</span>
    </span>
  )
}

function Swatch({ color, baseColor, overlay }: { color?: string; baseColor?: string; overlay?: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '1.125rem',
        height: '0.625rem',
        background: overlay ?? color,
        backgroundColor: baseColor,
        borderRadius: '0.125rem',
      }}
    />
  )
}

function Diamond({ critical }: { critical?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '0.75rem',
        height: '0.75rem',
        transform: 'rotate(45deg)',
        background: '#ffffff',
        border: critical ? '1.75px solid #dc2626' : '1.75px solid #5A824E',
      }}
    />
  )
}

function Divider({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '1px',
        height: '0.875rem',
        background: color,
      }}
    />
  )
}
