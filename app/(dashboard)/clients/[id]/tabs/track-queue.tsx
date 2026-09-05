'use client'

/** The client Track Queue tab: the per-track lanes plus the auto / custom /
 *  off override editor that decides how many tracks this client has. */

import { useCallback, useState } from 'react'
import useSWR from 'swr'
import { ListOrdered, Minus, Plus } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { EmptyState } from '@/components/tahi/empty-state'
import { TahiButton } from '@/components/tahi/tahi-button'
import { TrackQueueView, type TrackLanes } from '@/components/tahi/track-queue-view'
import { bucketTracks, bucketUnified, type CapacityResponse } from '@/lib/track-lanes'

// ── Track Queue tab ───────────────────────────────────────────────────────────

export const MAX_TRACKS = 4
export type TracksMode = 'auto' | 'custom' | 'off'

export function TrackQueueTab({ clientId }: { clientId: string }) {
  const [tracks, setTracks] = useState<TrackLanes[]>([])
  const [unified, setUnified] = useState(false)
  const [mode, setMode] = useState<TracksMode>('auto')
  const [smallCount, setSmallCount] = useState(0)
  const [largeCount, setLargeCount] = useState(0)
  const [saving, setSaving] = useState(false)

  // Capacity is cached via SWR. The server response drives several pieces of
  // local state (mode + counts are editable before save), so onSuccess mirrors
  // the response into state exactly as the old fetch did. `mutate` (aliased
  // fetchTracks) re-syncs after a save.
  const { isLoading: loading, mutate: fetchTracks } = useSWR<
    CapacityResponse & { customSmallTracks?: number; customLargeTracks?: number }
  >(
    `/api/admin/capacity?orgId=${clientId}`,
    async (path: string) => {
      const res = await fetch(apiPath(path))
      if (!res.ok) throw new Error('Failed to load capacity')
      return res.json()
    },
    {
      onSuccess: (data) => {
        const m = (data.tracksMode ?? 'auto') as TracksMode
        setMode(m)
        setSmallCount(data.customSmallTracks ?? 0)
        setLargeCount(data.customLargeTracks ?? 0)
        if (m === 'off') {
          setUnified(true)
          setTracks([bucketUnified(data)])
        } else {
          setUnified(false)
          setTracks(bucketTracks(data))
        }
      },
      onError: () => { setTracks([]) },
    },
  )

  const saveOverride = useCallback(async (next: { tracksMode: TracksMode; customSmallTracks?: number; customLargeTracks?: number }) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${clientId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      await fetchTracks()
    } catch {
      // leave current state; a refetch on next mount will resync
    } finally {
      setSaving(false)
    }
  }, [clientId, fetchTracks])

  const total = smallCount + largeCount

  return (
    <div className="space-y-4">
      <TracksOverrideControls
        mode={mode}
        smallCount={smallCount}
        largeCount={largeCount}
        saving={saving}
        onPickMode={m => {
          setMode(m)
          if (m === 'auto' || m === 'off') void saveOverride({ tracksMode: m })
          // 'custom' is staged locally until Save (lets the admin set counts first)
        }}
        onSmall={n => setSmallCount(Math.max(0, Math.min(n, MAX_TRACKS - largeCount)))}
        onLarge={n => setLargeCount(Math.max(0, Math.min(n, MAX_TRACKS - smallCount)))}
        onSaveCustom={() => void saveOverride({ tracksMode: 'custom', customSmallTracks: smallCount, customLargeTracks: largeCount })}
      />

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map(i => (
            <div key={i} className="animate-pulse bg-[var(--color-bg)] rounded-xl border border-[var(--color-border)] p-6">
              <div className="h-5 w-32 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
              <div className="mt-4 h-16 rounded" style={{ background: 'var(--color-bg-tertiary)' }} />
            </div>
          ))}
        </div>
      ) : tracks.length === 0 ? (
        <EmptyState
          icon={<ListOrdered className="w-7 h-7" />}
          title={mode === 'custom' && total === 0 ? 'No tracks configured' : 'No tracks found'}
          description={mode === 'custom' && total === 0
            ? 'Set a small or large track count above to give this client tracks.'
            : 'This client does not have any active tracks.'}
        />
      ) : (
        <TrackQueueView tracks={tracks} basePath="/requests" unified={unified} />
      )}
    </div>
  )
}

export function TracksOverrideControls({ mode, smallCount, largeCount, saving, onPickMode, onSmall, onLarge, onSaveCustom }: {
  mode: TracksMode
  smallCount: number
  largeCount: number
  saving: boolean
  onPickMode: (m: TracksMode) => void
  onSmall: (n: number) => void
  onLarge: (n: number) => void
  onSaveCustom: () => void
}) {
  const total = smallCount + largeCount
  const options: { value: TracksMode; label: string; hint: string }[] = [
    { value: 'auto', label: 'Auto', hint: 'From the plan, with upsell' },
    { value: 'custom', label: 'Custom', hint: 'Set track counts' },
    { value: 'off', label: 'Off', hint: 'One board, no upsell' },
  ]
  return (
    <div style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', background: 'var(--color-bg)', padding: '1rem' }}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <p style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Track configuration</p>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0.125rem 0 0 0' }}>Overrides the plan default for this client only.</p>
        </div>
        <div role="group" aria-label="Tracks mode" style={{ display: 'inline-flex', borderRadius: 'var(--radius-button)', border: '1px solid var(--color-border)', overflow: 'hidden', alignSelf: 'flex-start' }}>
          {options.map(opt => {
            const active = mode === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onPickMode(opt.value)}
                disabled={saving}
                title={opt.hint}
                style={{
                  padding: '0.4375rem 0.875rem', fontSize: '0.75rem', fontWeight: 600,
                  border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
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
        <div className="flex flex-col sm:flex-row sm:items-center gap-3" style={{ marginTop: '0.875rem', paddingTop: '0.875rem', borderTop: '1px solid var(--color-border-subtle)' }}>
          <Stepper label="Large tracks" value={largeCount} onChange={onLarge} disabled={saving} atMax={total >= MAX_TRACKS} />
          <Stepper label="Small tracks" value={smallCount} onChange={onSmall} disabled={saving} atMax={total >= MAX_TRACKS} />
          <span style={{ fontSize: '0.75rem', color: total >= MAX_TRACKS ? 'var(--color-warning)' : 'var(--color-text-subtle)' }}>
            {total} of {MAX_TRACKS} used
          </span>
          <TahiButton size="sm" onClick={onSaveCustom} disabled={saving} className="sm:ml-auto">
            {saving ? 'Saving...' : 'Save'}
          </TahiButton>
        </div>
      )}
    </div>
  )
}

function Stepper({ label, value, onChange, disabled, atMax }: {
  label: string; value: number; onChange: (n: number) => void; disabled: boolean; atMax: boolean
}) {
  const btn: React.CSSProperties = {
    width: '1.75rem', height: '1.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)',
    cursor: disabled ? 'not-allowed' : 'pointer', borderRadius: 'var(--radius-button)',
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', minWidth: '5.5rem' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <button type="button" style={{ ...btn, opacity: disabled || value <= 0 ? 0.5 : 1 }} disabled={disabled || value <= 0} onClick={() => onChange(value - 1)} aria-label={`Decrease ${label}`}>
          <Minus className="w-3.5 h-3.5" />
        </button>
        <span style={{ minWidth: '1.25rem', textAlign: 'center', fontSize: '0.875rem', fontWeight: 700, color: 'var(--color-text)' }}>{value}</span>
        <button type="button" style={{ ...btn, opacity: disabled || atMax ? 0.5 : 1 }} disabled={disabled || atMax} onClick={() => onChange(value + 1)} aria-label={`Increase ${label}`}>
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

