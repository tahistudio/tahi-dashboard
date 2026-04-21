/**
 * Chart + categorical colour system.
 *
 * Single source of truth for every chart, badge, and stage-indicator
 * colour across the app. Recharts SVG fills and strokes don't resolve
 * CSS variables, so all values here are hex. CSS token equivalents live
 * in `globals.css` under the `--color-*` and `--status-*` families.
 *
 * Rules:
 * - `positive` / `negative` / `neutral` are the only directional colours.
 * - `categorical[]` is the palette for any "group by stage / source / category"
 *   visualisation. Order is intentional so the first few are most distinct.
 * - Stage and source lookups use a stable map (below) so the same stage is
 *   the same colour in every chart (Deals by Stage, Sales Funnel, Stage
 *   Velocity, Pipeline board, Close Rate by Source, etc).
 */

export const CHART = {
  // Core directional colours.
  // `negative` matches --color-danger so every red on the page is the same red.
  positive: '#5A824E',        // brand green : revenue, net profit, won, current
  negative: '#dc2626',        // danger red : expenses, lost, overdue (matches --color-danger)
  neutral: '#94a3b8',         // muted slate : neutral / info / forecast

  // Grid + axis
  grid: '#e8f0e6',
  axis: '#8a9987',

  // Categorical rotation : sources, stages, arbitrary groupings.
  // First colour is always brand green so "group 1" matches positive.
  categorical: [
    '#5A824E', // brand green
    '#60a5fa', // blue
    '#fbbf24', // amber
    '#a78bfa', // purple
    '#06b6d4', // teal
    '#fb923c', // orange
    '#f472b6', // rose
    '#9ca3af', // gray
  ] as const,

  // Aging buckets : 0-30 -> 30-60 -> 60-90 -> 90+ (green to red gradient)
  aging: {
    current: '#5A824E',
    thirtyDays: '#fbbf24',
    sixtyDays: '#fb923c',
    ninetyPlus: '#dc2626',
  },
}

// ── Stage colour lookup ──────────────────────────────────────────────────
// Every chart that shows pipeline stages must use this map so "Discovery"
// is the same colour in Deals by Stage, Sales Funnel, Stage Velocity,
// and the Pipeline kanban board. Any stage not in the map falls back to
// CHART.categorical at its position index.

const STAGE_COLOUR_MAP: Record<string, string> = {
  // standard sales pipeline stages (lowercase keys for case-insensitive match)
  lead:            '#60a5fa', // blue : new / incoming
  inquiry:         '#60a5fa',
  qualified:       '#60a5fa',
  discovery:       '#a78bfa', // purple : investigation phase
  research:        '#a78bfa',
  proposal:        '#fbbf24', // amber : needs review
  quote:           '#fbbf24',
  negotiation:     '#06b6d4', // teal : active back-and-forth
  'verbal commit': '#fb923c', // orange : warming up, close to won (distinct from teal)
  verbal_commit:   '#fb923c',
  verbal:          '#fb923c',
  stalled:         '#9ca3af', // gray : paused
  paused:          '#9ca3af',
  on_hold:         '#9ca3af',
  'closed won':    '#5A824E', // brand green : done, positive
  closed_won:      '#5A824E',
  won:             '#5A824E',
  'closed lost':   '#dc2626', // danger red : done, negative
  closed_lost:     '#dc2626',
  lost:            '#dc2626',
}

export function stageColour(stageName: string | null | undefined, fallbackIndex = 0): string {
  if (!stageName) return CHART.categorical[fallbackIndex % CHART.categorical.length]
  const key = stageName.toLowerCase().trim()
  return STAGE_COLOUR_MAP[key] ?? CHART.categorical[fallbackIndex % CHART.categorical.length]
}

// ── Source colour lookup ─────────────────────────────────────────────────
// Same idea for acquisition sources. Kept stable so "Webflow Partner" is
// always the same colour in Sources by Revenue, Close Rate by Source, etc.

const SOURCE_COLOUR_MAP: Record<string, string> = {
  direct:            CHART.categorical[0], // brand green
  inbound:           CHART.categorical[0],
  website:           CHART.categorical[1], // blue
  social:            CHART.categorical[2], // amber
  webflow_partner:   CHART.categorical[3], // purple
  'webflow partner': CHART.categorical[3],
  referral:          CHART.categorical[4], // teal
  outbound:          CHART.categorical[5], // orange
  straightin:        CHART.categorical[6], // rose
  other:             CHART.categorical[7], // gray
}

export function sourceColour(source: string | null | undefined, fallbackIndex = 0): string {
  if (!source) return CHART.categorical[fallbackIndex % CHART.categorical.length]
  const key = source.toLowerCase().trim()
  return SOURCE_COLOUR_MAP[key] ?? CHART.categorical[fallbackIndex % CHART.categorical.length]
}

/** Badge style for a source : matching text + subtle tint bg. Used in
 *  Pipeline list + deal detail so every "Webflow Partner" chip looks the
 *  same across the app. '18' hex = ~9% alpha. */
export function sourceBadge(source: string | null | undefined, fallbackIndex = 0): { bg: string; text: string } {
  const c = sourceColour(source, fallbackIndex)
  return { bg: `${c}18`, text: c }
}

/** Same pattern for stages. */
export function stageBadge(stageName: string | null | undefined, fallbackIndex = 0): { bg: string; text: string } {
  const c = stageColour(stageName, fallbackIndex)
  return { bg: `${c}18`, text: c }
}

// ── Request/deal status colours ──────────────────────────────────────────
// Match the status tokens in globals.css. One meaning per colour.

export const STATUS_COLORS: Record<string, string> = {
  draft:         '#9ca3af',  // gray : inactive
  submitted:     '#60a5fa',  // blue : new / incoming
  in_review:     '#fbbf24',  // amber : needs attention
  in_progress:   '#06b6d4',  // teal : working on it
  client_review: '#a78bfa',  // purple : client action
  delivered:     '#22c55e',  // green : done / paid / delivered
  archived:      '#d1d5db',  // light gray : archived
}
