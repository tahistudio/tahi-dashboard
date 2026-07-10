/**
 * lib/plan-catalog.ts - server loader for the client-facing retainer
 * catalogue. The catalogue (name, tagline, features, "most popular", base and
 * per-track prices) persists as JSON under PLAN_CATALOG_KEY in the settings
 * table; when a stored plan omits a price the merge falls back to lib/billing
 * (PLAN_MONTHLY_RATES) and the mirrored track rates so legacy copies never
 * lose pricing. Pure constants and types live in lib/plan-catalog-shared.ts
 * (client-safe).
 */

import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'
import { PLAN_MONTHLY_RATES } from '@/lib/billing'
import {
  DEFAULT_PLAN_COPY,
  PLAN_CATALOG_KEY,
  PLAN_TRACK_RATES,
  sanitisePlanCopy,
  type PlanCatalogEntry,
  type PlanCopy,
} from '@/lib/plan-catalog-shared'

export {
  DEFAULT_PLAN_COPY,
  PLAN_CATALOG_KEY,
  PLAN_TRACK_RATES,
  type PlanCatalogEntry,
  type PlanCopy,
}

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Load the stored catalogue (settings key, falling back to defaults) and
 *  resolve final rates. Unknown plan ids surface with rate 0 rather than
 *  being hidden (no silent drop - the admin editor flags them). */
export async function loadPlanCatalog(drizzle: D1): Promise<PlanCatalogEntry[]> {
  let copy: PlanCopy[] = DEFAULT_PLAN_COPY
  try {
    const [row] = await drizzle
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, PLAN_CATALOG_KEY))
      .limit(1)
    if (row?.value) {
      const parsed = sanitisePlanCopy(JSON.parse(row.value))
      if (parsed) copy = parsed
    }
  } catch {
    copy = DEFAULT_PLAN_COPY
  }
  return copy.map((p) => ({
    ...p,
    monthlyRate: p.base ?? PLAN_MONTHLY_RATES[p.id] ?? 0,
    trackRate: p.track ?? PLAN_TRACK_RATES[p.id] ?? 0,
  }))
}
