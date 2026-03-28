import { cn } from '@/lib/utils'

interface Track {
  id: string
  type: 'small' | 'large'
  isPriorityTrack: boolean
  currentRequestId: string | null
  currentRequestTitle?: string | null
}

interface TrackMeterProps {
  tracks: Track[]
  className?: string
  compact?: boolean
}

/**
 * TrackMeter: shows visual fill bars for small and large tracks.
 *
 * Small tracks: shown as a row of pill slots (used = brand green, free = gray)
 * Large tracks: shown as a wider slot with "In use" / "Available" label
 */
export function TrackMeter({ tracks, className, compact = false }: TrackMeterProps) {
  const smallTracks = tracks.filter(t => t.type === 'small')
  const largeTracks = tracks.filter(t => t.type === 'large')

  if (tracks.length === 0) {
    return (
      <div className={cn('text-xs text-[var(--color-text-subtle)]', className)}>
        No tracks configured
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {smallTracks.length > 0 && (
        <TrackRow
          label="Small"
          tracks={smallTracks}
          compact={compact}
          colour="brand"
        />
      )}
      {largeTracks.length > 0 && (
        <TrackRow
          label="Large"
          tracks={largeTracks}
          compact={compact}
          colour="indigo"
        />
      )}
    </div>
  )
}

function TrackRow({
  label,
  tracks,
  compact,
  colour,
}: {
  label: string
  tracks: Track[]
  compact: boolean
  colour: 'brand' | 'indigo'
}) {
  const used = tracks.filter(t => t.currentRequestId !== null).length
  const total = tracks.length

  const colours = {
    brand:  { used: 'bg-[var(--color-brand)]',   free: 'bg-[var(--color-border)]', text: 'text-[var(--color-brand-dark)]' },
    indigo: { used: 'bg-indigo-500',              free: 'bg-[var(--color-border)]', text: 'text-indigo-700' },
  }[colour]

  return (
    <div className="flex items-center gap-2">
      {!compact && (
        <span className="text-xs text-[var(--color-text-muted)] w-10 flex-shrink-0">{label}</span>
      )}

      {/* Slot pills */}
      <div className="flex items-center gap-1">
        {tracks.map((track) => {
          const isUsed = track.currentRequestId !== null
          return (
            <div
              key={track.id}
              className={cn(
                'rounded-full transition-colors',
                compact ? 'w-3 h-3' : 'w-4 h-4',
                isUsed ? colours.used : colours.free,
              )}
              title={
                isUsed
                  ? `In use: ${track.currentRequestTitle ?? 'Request'}`
                  : `${label} track available`
              }
            />
          )
        })}
      </div>

      {!compact && (
        <span className={cn('text-xs font-medium', colours.text)}>
          {used}/{total} {used === total && total > 0 ? '· Full' : used > 0 ? '· Active' : '· Free'}
        </span>
      )}
    </div>
  )
}

// ─── Inline summary string ───────────────────────────────────────────────────

export function trackSummary(tracks: Track[]): string {
  const small = tracks.filter(t => t.type === 'small')
  const large = tracks.filter(t => t.type === 'large')
  const smallUsed = small.filter(t => t.currentRequestId).length
  const largeUsed = large.filter(t => t.currentRequestId).length

  const parts: string[] = []
  if (small.length > 0) parts.push(`${smallUsed}/${small.length} small`)
  if (large.length > 0) parts.push(`${largeUsed}/${large.length} large`)
  return parts.join(' · ') || 'No tracks'
}
