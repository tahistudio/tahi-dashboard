'use client'

/**
 * <TracksConfig>. Auto / custom / off, and how many small and large tracks a
 * client gets when it is custom.
 *
 * This is configuration, not a view, so it lives on Settings while the lanes
 * themselves render on Overview. Both sit on the same
 * `/api/admin/capacity?orgId=` SWR key: saving here revalidates that key, so
 * the Overview lanes cannot disagree with the counts set here.
 */

import { useCallback, useEffect, useState } from 'react'
import useSWR from 'swr'
import { Minus, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { TahiButton } from '@/components/tahi/tahi-button'
import { useToast } from '@/components/tahi/toast'
import { CLIENT_CAPACITY_KEY, fetchCapacity, type CapacityWithMode } from './overview-tracks'

export const MAX_TRACKS = 4
export type TracksMode = 'auto' | 'custom' | 'off'

export function TracksConfig({
  clientId,
  writeDisabled,
}: {
  clientId: string
  writeDisabled: boolean
}) {
  const { showToast } = useToast()
  const [mode, setMode] = useState<TracksMode>('auto')
  const [smallCount, setSmallCount] = useState(0)
  const [largeCount, setLargeCount] = useState(0)
  const [saving, setSaving] = useState(false)

  const { data, mutate } = useSWR<CapacityWithMode>(
    CLIENT_CAPACITY_KEY(clientId),
    fetchCapacity,
  )

  // Mirror the server answer into the editable fields. `custom` stages locally
  // until Save, so the admin can set both counts before either is written.
  useEffect(() => {
    if (!data) return
    setMode((data.tracksMode ?? 'auto') as TracksMode)
    setSmallCount(data.customSmallTracks ?? 0)
    setLargeCount(data.customLargeTracks ?? 0)
  }, [data])

  // Called as `void save(...)`, so an uncaught rejection here would be an
  // unhandled one. A refused save is reported rather than left to look applied
  // until the next revalidate snaps the counts back.
  const save = useCallback(async (next: { tracksMode: TracksMode; customSmallTracks?: number; customLargeTracks?: number }) => {
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: string } | null
        showToast(json?.error ?? 'The track settings did not save. Please try again.', 'error')
      }
      await mutate()
    } catch {
      showToast('The track settings did not save. Please try again.', 'error')
      await mutate()
    } finally {
      setSaving(false)
    }
  }, [clientId, mutate, showToast])

  const total = smallCount + largeCount
  const busy = saving || writeDisabled

  const options: { value: TracksMode; label: string; hint: string }[] = [
    { value: 'auto', label: 'Auto', hint: 'From the plan, with upsell' },
    { value: 'custom', label: 'Custom', hint: 'Set track counts' },
    { value: 'off', label: 'Off', hint: 'One board, no upsell' },
  ]

  return (
    <div className="flex flex-col" style={{ gap: '0.875rem' }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between" style={{ gap: '0.75rem' }}>
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          Overrides the plan default for this client only.
        </p>
        <div
          role="group"
          aria-label="Tracks mode"
          style={{
            display: 'inline-flex',
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--color-border-strong)',
            overflow: 'hidden',
            alignSelf: 'flex-start',
          }}
        >
          {options.map(opt => {
            const active = mode === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setMode(opt.value)
                  // custom stages locally so the counts can be set first.
                  if (opt.value === 'auto' || opt.value === 'off') void save({ tracksMode: opt.value })
                }}
                disabled={busy}
                title={opt.hint}
                aria-pressed={active}
                className="tahi-focus-ring"
                style={{
                  minHeight: '2.75rem',
                  padding: '0 0.875rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  background: active ? 'var(--color-brand)' : 'var(--color-bg)',
                  color: active ? '#ffffff' : 'var(--color-text-muted)',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {mode === 'custom' && (
        <div className="flex flex-col sm:flex-row sm:items-center" style={{ gap: '0.75rem' }}>
          <Stepper
            label="Large tracks"
            value={largeCount}
            onChange={n => setLargeCount(Math.max(0, Math.min(n, MAX_TRACKS - smallCount)))}
            disabled={busy}
            atMax={total >= MAX_TRACKS}
          />
          <Stepper
            label="Small tracks"
            value={smallCount}
            onChange={n => setSmallCount(Math.max(0, Math.min(n, MAX_TRACKS - largeCount)))}
            disabled={busy}
            atMax={total >= MAX_TRACKS}
          />
          <span style={{ fontSize: '0.75rem', color: total >= MAX_TRACKS ? 'var(--color-warning)' : 'var(--color-text-subtle)' }}>
            {total} of {MAX_TRACKS} used
          </span>
          <TahiButton
            size="sm"
            className="sm:ml-auto"
            disabled={busy}
            onClick={() => void save({ tracksMode: 'custom', customSmallTracks: smallCount, customLargeTracks: largeCount })}
          >
            {saving ? 'Saving...' : 'Save'}
          </TahiButton>
        </div>
      )}
    </div>
  )
}

function Stepper({ label, value, onChange, disabled, atMax }: {
  label: string
  value: number
  onChange: (n: number) => void
  disabled: boolean
  atMax: boolean
}) {
  const btn: React.CSSProperties = {
    minWidth: '2.75rem',
    minHeight: '2.75rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '1px solid var(--color-border-strong)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 'var(--radius-button)',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', minWidth: '5.5rem' }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <button
          type="button"
          className="tahi-focus-ring"
          style={{ ...btn, opacity: disabled || value <= 0 ? 0.5 : 1 }}
          disabled={disabled || value <= 0}
          onClick={() => onChange(value - 1)}
          aria-label={`Decrease ${label}`}
        >
          <Minus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
        <span
          className="tabular-nums"
          style={{ minWidth: '1.25rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}
        >
          {value}
        </span>
        <button
          type="button"
          className="tahi-focus-ring"
          style={{ ...btn, opacity: disabled || atMax ? 0.5 : 1 }}
          disabled={disabled || atMax}
          onClick={() => onChange(value + 1)}
          aria-label={`Increase ${label}`}
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
