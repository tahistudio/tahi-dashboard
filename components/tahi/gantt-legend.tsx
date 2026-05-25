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
  // Hardcoded hex (no CSS vars) so the legend renders correctly on
  // public deliverable pages where dashboard tokens aren't loaded.
  const subtleColor = light ? '#8a9987' : 'rgba(255,255,255,0.55)'
  const labelColor = light ? '#5a6657' : 'rgba(255,255,255,0.85)'
  const surfaceBg = light ? '#f5f7f5' : 'rgba(255,255,255,0.06)'
  const surfaceBorder = light ? '#e8f0e6' : 'rgba(255,255,255,0.12)'

  return (
    <div
      className="flex flex-wrap items-center"
      style={{
        gap: compact ? '0.875rem' : '1.125rem',
        padding: compact ? '0.75rem 0.875rem' : '0.875rem 1rem',
        background: surfaceBg,
        border: `1px solid ${surfaceBorder}`,
        borderRadius: '0.5rem',
        fontSize: compact ? '0.75rem' : '0.8125rem',
        color: labelColor,
        rowGap: '0.625rem',
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
      {/* Risk overlay sits over CLIENT (dark) bars in practice — that's
          where the risk-of-delay flag actually appears most often (client-
          owned dependencies). Showing it over Tahi-green was confusing
          because it suggested Tahi was at risk, not the client task. */}
      <Item label="Risk of delay" swatch={<Swatch baseColor="#1f2c1a" overlay={RISK_OVERLAY} />} />
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
  // When both baseColor + overlay are set (risk-of-delay case), we need
  // backgroundColor to win for the base and then layer overlay on top.
  // Setting `background` shorthand resets backgroundColor, so we order
  // them explicitly via two property names.
  const style: React.CSSProperties = {
    display: 'inline-block',
    width: '1.5rem',
    height: '0.75rem',
    borderRadius: '0.1875rem',
    flexShrink: 0,
  }
  if (overlay && baseColor) {
    // Layer: baseColor underneath, overlay on top via `background-image`.
    style.backgroundColor = baseColor
    style.backgroundImage = overlay
  } else if (color) {
    style.backgroundColor = color
  }
  return <span aria-hidden="true" style={style} />
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
