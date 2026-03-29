'use client'

import { Lock, ArrowUpRight, Zap } from 'lucide-react'

const BRAND = '#5A824E'
const BRAND_DARK = '#425F39'

interface TrackCapacityCardProps {
  planType: string | null
  smallTracksUsed: number
  smallTracksTotal: number
  largeTracksUsed: number
  largeTracksTotal: number
  hasPriority: boolean
}

interface SlotProps {
  label: string
  used: number
  total: number
  colour: string
  available: boolean
  upsellText?: string
}

function CapacitySlot({ label, used, total, colour, available, upsellText }: SlotProps) {
  if (!available) {
    return (
      <div
        className="rounded-xl flex flex-col items-center justify-center text-center"
        style={{
          padding: '1.25rem 1rem',
          border: '2px dashed var(--color-border)',
          opacity: 0.55,
          background: 'var(--color-bg-secondary)',
        }}
      >
        <Lock size={18} style={{ color: 'var(--color-text-subtle)', marginBottom: '0.5rem' }} />
        <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>{label}</p>
        {upsellText && (
          <button
            type="button"
            className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-80"
            style={{
              marginTop: '0.5rem',
              padding: '0.375rem 0.75rem',
              background: BRAND,
              color: 'white',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: 'pointer',
            }}
          >
            {upsellText}
            <ArrowUpRight size={12} />
          </button>
        )}
      </div>
    )
  }

  const pct = total > 0 ? (used / total) * 100 : 0

  return (
    <div
      className="rounded-xl"
      style={{
        padding: '1rem',
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg)',
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
        <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{label}</p>
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
          {used}/{total} used
        </span>
      </div>
      {/* Progress bar */}
      <div style={{ height: '0.5rem', background: 'var(--color-bg-tertiary)', borderRadius: '0.25rem', overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: colour,
            borderRadius: '0.25rem',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <p className="text-xs" style={{ color: 'var(--color-text-subtle)', marginTop: '0.375rem' }}>
        {total - used} {total - used === 1 ? 'slot' : 'slots'} available
      </p>
    </div>
  )
}

export function TrackCapacityCard({
  planType,
  smallTracksUsed,
  smallTracksTotal,
  largeTracksUsed,
  largeTracksTotal,
  hasPriority,
}: TrackCapacityCardProps) {
  const plan = planType?.toLowerCase() ?? 'none'
  const isMaintain = plan === 'maintain'
  const isScale = plan === 'scale'

  // Determine what is available vs upsell
  const hasSmall = smallTracksTotal > 0
  const hasLarge = largeTracksTotal > 0

  return (
    <div
      className="rounded-xl"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        padding: '1.25rem',
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
          Track Capacity
        </h3>
        {planType && (
          <span
            className="text-xs font-medium capitalize"
            style={{
              padding: '0.125rem 0.5rem',
              background: 'var(--color-brand-50)',
              color: BRAND_DARK,
              borderRadius: '1rem',
            }}
          >
            {planType}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {/* Small tracks */}
        <CapacitySlot
          label="Small Tracks"
          used={smallTracksUsed}
          total={smallTracksTotal}
          colour={BRAND}
          available={hasSmall}
          upsellText={!hasSmall ? 'Add small tracks' : undefined}
        />

        {/* Large tracks */}
        <CapacitySlot
          label="Large Tracks"
          used={largeTracksUsed}
          total={largeTracksTotal}
          colour="#6366f1"
          available={hasLarge}
          upsellText={!hasLarge && isMaintain ? 'Upgrade to Scale' : (!hasLarge ? 'Add large tracks' : undefined)}
        />

        {/* Priority support */}
        {!hasPriority ? (
          <div
            className="rounded-xl flex items-center gap-3"
            style={{
              padding: '0.875rem 1rem',
              border: '2px dashed var(--color-border)',
              opacity: 0.55,
              background: 'var(--color-bg-secondary)',
            }}
          >
            <Lock size={16} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>Priority Support</p>
              <p className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>Get faster turnaround times</p>
            </div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-80 flex-shrink-0"
              style={{
                padding: '0.375rem 0.75rem',
                background: BRAND,
                color: 'white',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
              }}
            >
              <Zap size={12} />
              Add
            </button>
          </div>
        ) : (
          <div
            className="rounded-xl flex items-center gap-3"
            style={{
              padding: '0.875rem 1rem',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
            }}
          >
            <Zap size={16} style={{ color: BRAND, flexShrink: 0 }} />
            <div className="flex-1">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Priority Support</p>
              <p className="text-xs" style={{ color: 'var(--color-success)' }}>Active</p>
            </div>
          </div>
        )}

        {/* Extra capacity upsell for Scale plan */}
        {isScale && (
          <div
            className="rounded-xl flex items-center gap-3"
            style={{
              padding: '0.875rem 1rem',
              border: '2px dashed var(--color-border)',
              opacity: 0.55,
              background: 'var(--color-bg-secondary)',
            }}
          >
            <Lock size={16} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>Need more capacity?</p>
            </div>
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-semibold transition-opacity hover:opacity-80 flex-shrink-0"
              style={{
                padding: '0.375rem 0.75rem',
                background: BRAND,
                color: 'white',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
              }}
            >
              Add Tracks
              <ArrowUpRight size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
