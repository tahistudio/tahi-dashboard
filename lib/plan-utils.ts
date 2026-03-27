// ─── Plan → Track Entitlements ────────────────────────────────────────────────
//
// Track rules:
//   small track → accepts small_task only
//   large track → accepts both small_task AND large_task
//
// Capacity by plan:
//   maintain                   → 1 small track
//   maintain + prioritySupport → 2 small tracks
//   scale                      → 1 large track + 1 small track
//   scale + prioritySupport    → 2 large tracks + 1 small track

export interface TrackEntitlements {
  smallTracks: number
  largeTracks: number
  /** Total simultaneous work slots (large tracks can serve as small) */
  totalSlots: number
  /** Whether large_task requests are allowed */
  canUseLargeTrack: boolean
}

export function getTrackEntitlements(
  planType: string | null,
  hasPrioritySupport: boolean,
): TrackEntitlements {
  switch (planType) {
    case 'maintain':
      return {
        smallTracks: hasPrioritySupport ? 2 : 1,
        largeTracks: 0,
        totalSlots: hasPrioritySupport ? 2 : 1,
        canUseLargeTrack: false,
      }
    case 'scale':
      return {
        smallTracks: 1,
        largeTracks: hasPrioritySupport ? 2 : 1,
        totalSlots: hasPrioritySupport ? 3 : 2,
        canUseLargeTrack: true,
      }
    default:
      return {
        smallTracks: 0,
        largeTracks: 0,
        totalSlots: 0,
        canUseLargeTrack: false,
      }
  }
}

// ─── Request type → track type mapping ───────────────────────────────────────

/** Which track type can handle this request type */
export function getRequiredTrackType(requestType: string): 'small' | 'large' {
  return requestType === 'large_task' ? 'large' : 'small'
}

/** Can a given track type handle a given request type */
export function trackCanHandle(trackType: 'small' | 'large', requestType: string): boolean {
  if (trackType === 'large') return true          // large tracks handle everything
  return requestType !== 'large_task'             // small tracks reject large_task only
}

// ─── Plan display helpers ─────────────────────────────────────────────────────

export function getPlanLabel(planType: string | null): string {
  const labels: Record<string, string> = {
    maintain: 'Maintain',
    scale: 'Scale',
    tune: 'Tune',
    launch: 'Launch',
    hourly: 'Hourly',
    custom: 'Custom',
  }
  return planType ? (labels[planType] ?? planType) : 'No plan'
}

export function getTrackSummary(planType: string | null, hasPrioritySupport: boolean): string {
  const e = getTrackEntitlements(planType, hasPrioritySupport)
  const parts: string[] = []
  if (e.largeTracks > 0) parts.push(`${e.largeTracks} large track${e.largeTracks > 1 ? 's' : ''}`)
  if (e.smallTracks > 0) parts.push(`${e.smallTracks} small track${e.smallTracks > 1 ? 's' : ''}`)
  return parts.length > 0 ? parts.join(' + ') : 'No active tracks'
}
