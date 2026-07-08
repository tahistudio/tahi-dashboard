/**
 * lib/plan-catalog-shared.ts - client-safe half of the plan catalogue.
 *
 * Pure constants and types shared by the server loader (lib/plan-catalog.ts)
 * and the settings UI. No db imports so client components can use it without
 * dragging drizzle into the browser bundle.
 *
 * The catalogue persists in the settings K/V store under PLAN_CATALOG_KEY as
 * the design shape [{ id, name, base, track, rec, tag, feats[] }]. Stored
 * base/track prices win; when a stored plan omits them the merge in
 * lib/plan-catalog.ts falls back to lib/billing (PLAN_MONTHLY_RATES) and the
 * per-plan track rates below (mirroring lib/stripe-plans.ts), so legacy copies
 * still price correctly.
 */

export const PLAN_CATALOG_KEY = 'plan_catalog'

/** Per-plan parallel-track add-on monthly rate fallback (mirrors STRIPE_PLANS). */
export const PLAN_TRACK_RATES: Readonly<Record<string, number>> = {
  maintain: 1000,
  scale: 1500,
}

export interface PlanCopy {
  id: string
  name: string
  tag: string
  feats: string[]
  rec: boolean
  /** Monthly base price in NZD. Optional in stored JSON (falls back to lib/billing). */
  base?: number
  /** Monthly per-extra-track price in NZD. Optional in stored JSON. */
  track?: number
}

export interface PlanCatalogEntry extends PlanCopy {
  /** Resolved monthly base rate (stored base, else lib/billing fallback). */
  monthlyRate: number
  /** Resolved monthly per-extra-track rate (stored track, else fallback). */
  trackRate: number
}

export const DEFAULT_PLAN_COPY: PlanCopy[] = [
  {
    id: 'maintain',
    name: 'Maintain',
    base: 1500,
    track: 1000,
    rec: false,
    tag: 'Steady upkeep, handled.',
    feats: ['One active track of work', 'Design & build, ongoing', '48-hour response', 'Monthly check-in'],
  },
  {
    id: 'scale',
    name: 'Scale',
    base: 4000,
    track: 1500,
    rec: true,
    tag: 'Ongoing design & build, handled.',
    feats: ['Multiple tracks in parallel', 'Priority design & build', 'Same-day response', 'Strategy & roadmap'],
  },
]

function toFiniteNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

/** Validate an untrusted parsed JSON blob into PlanCopy[], or null. */
export function sanitisePlanCopy(raw: unknown): PlanCopy[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: PlanCopy[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const p = item as Record<string, unknown>
    if (typeof p.id !== 'string' || typeof p.name !== 'string') return null
    out.push({
      id: p.id,
      name: p.name,
      tag: typeof p.tag === 'string' ? p.tag : '',
      feats: Array.isArray(p.feats) ? p.feats.filter((f): f is string => typeof f === 'string') : [],
      rec: p.rec === true,
      base: toFiniteNumber(p.base),
      track: toFiniteNumber(p.track),
    })
  }
  return out
}
