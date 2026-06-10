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

// ─── Per-client tracks override ───────────────────────────────────────────────
//
// A client's effective tracks come from one of three modes (organisations.tracks_mode):
//   auto   → derive from the plan entitlements, show the ghost upsell
//   custom → use explicit small/large counts (total clamped to 4), no upsell
//   off    → one unified board, no per-track split, no upsell
// The override always wins over the plan default, for any client.

export const MAX_TRACKS = 4

export type TracksMode = 'auto' | 'custom' | 'off'

export interface TracksOverride {
  tracksMode?: string | null
  customSmallTracks?: number | null
  customLargeTracks?: number | null
}

export interface TracksConfig {
  mode: TracksMode
  smallTracks: number
  largeTracks: number
  /** Show the greyed-out upgrade ghost cards (auto + retainer plan only). */
  showGhosts: boolean
}

export function resolveTracksConfig(
  override: TracksOverride | null | undefined,
  planType: string | null,
  hasPrioritySupport: boolean,
): TracksConfig {
  const mode: TracksMode =
    override?.tracksMode === 'custom' ? 'custom'
      : override?.tracksMode === 'off' ? 'off'
        : 'auto'

  if (mode === 'off') {
    return { mode, smallTracks: 0, largeTracks: 0, showGhosts: false }
  }

  if (mode === 'custom') {
    let small = Math.max(0, Math.floor(override?.customSmallTracks ?? 0))
    let large = Math.max(0, Math.floor(override?.customLargeTracks ?? 0))
    // Clamp the total to MAX_TRACKS, trimming large first then small.
    if (large > MAX_TRACKS) large = MAX_TRACKS
    if (small + large > MAX_TRACKS) small = MAX_TRACKS - large
    return { mode, smallTracks: small, largeTracks: large, showGhosts: false }
  }

  const e = getTrackEntitlements(planType, hasPrioritySupport)
  return {
    mode,
    smallTracks: e.smallTracks,
    largeTracks: e.largeTracks,
    showGhosts: planType === 'maintain' || planType === 'scale',
  }
}

export interface RealTrackRow {
  id: string
  /** DB column is free text; only 'small' / 'large' rows are placed. */
  type: string
  isPriorityTrack: number | boolean | null
  currentRequestId: string | null
}

export interface EffectiveTrack {
  id: string
  type: 'small' | 'large'
  isPriorityTrack: number | boolean | null
  currentRequestId: string | null
  /** True when this is a placeholder slot with no backing tracks-table row. */
  synthetic: boolean
}

/**
 * Reconcile real track rows to the desired per-type counts. Real rows are kept
 * first (preserving their active slot), then synthetic placeholder slots fill
 * the remainder. Extra real rows beyond the count are trimmed. Synthetic ids are
 * deterministic and never collide with real UUIDs, so they are safe as React
 * keys; reorder is org-scoped so it never looks them up.
 */
export function buildEffectiveTracks(
  real: ReadonlyArray<RealTrackRow>,
  smallTracks: number,
  largeTracks: number,
): EffectiveTrack[] {
  const out: EffectiveTrack[] = []
  for (const type of ['large', 'small'] as const) {
    const want = type === 'large' ? largeTracks : smallTracks
    // Keep rows with an active request first, so a tight custom count never
    // hides in-progress work.
    const rows = real.filter(t => t.type === type)
      .sort((a, b) => (a.currentRequestId ? 0 : 1) - (b.currentRequestId ? 0 : 1))
    for (let i = 0; i < want; i++) {
      const row = rows[i]
      if (row) {
        out.push({ id: row.id, type, isPriorityTrack: row.isPriorityTrack, currentRequestId: row.currentRequestId, synthetic: false })
      } else {
        out.push({ id: `synthetic-${type}-${i}`, type, isPriorityTrack: false, currentRequestId: null, synthetic: true })
      }
    }
  }
  return out
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

/** Override-aware track summary so the header, overview and kanban all agree. */
export function getTracksConfigSummary(config: TracksConfig): string {
  if (config.mode === 'off') return 'One unified board'
  const parts: string[] = []
  if (config.largeTracks > 0) parts.push(`${config.largeTracks} large track${config.largeTracks > 1 ? 's' : ''}`)
  if (config.smallTracks > 0) parts.push(`${config.smallTracks} small track${config.smallTracks > 1 ? 's' : ''}`)
  return parts.length > 0 ? parts.join(' + ') : 'No active tracks'
}

// ─── Ghost-track upsell ───────────────────────────────────────────────────────
//
// The tracks a client would GAIN by upgrading, rendered as greyed-out "ghost"
// cards beside their real tracks so the upgrade path is visual. Lead with the
// capability, not the price (per the Services & Pricing doc).

export interface GhostTrack {
  /** Track type the upgrade would add. */
  type: 'small' | 'large'
  headline: string
  subline: string
  /** CTA label; the view wires it to the upgrade path (/billing or contact). */
  cta: string
}

export function getUpgradeGhostTracks(
  planType: string | null,
  hasPrioritySupport: boolean,
): GhostTrack[] {
  if (planType === 'maintain') {
    if (!hasPrioritySupport) {
      return [
        {
          type: 'small',
          headline: 'Run two projects at once',
          subline: 'A second track means two pieces of work moving in parallel.',
          cta: 'Add priority support',
        },
        {
          type: 'large',
          headline: 'Take on bigger builds',
          subline: 'A large track handles full pages and complex work, not just small tasks.',
          cta: 'Upgrade to Scale',
        },
      ]
    }
    return [
      {
        type: 'large',
        headline: 'Take on bigger builds',
        subline: 'A large track handles full pages and complex work, not just small tasks.',
        cta: 'Upgrade to Scale',
      },
    ]
  }
  if (planType === 'scale') {
    if (!hasPrioritySupport) {
      return [
        {
          type: 'large',
          headline: 'Two big projects in parallel',
          subline: 'A second large track doubles your large-build throughput.',
          cta: 'Add priority support',
        },
      ]
    }
    return [] // top tier
  }
  // No recognised retainer plan: no ghost tracks (the track view only renders
  // for active subscriptions anyway).
  return []
}
