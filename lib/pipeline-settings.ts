/**
 * pipeline-settings.ts — DB-aware accessors for the
 * `pipeline.*` settings keys. Kept separate from `lib/pipeline-math.ts`
 * (which is pure) so the math module stays D1-free.
 */

import { eq } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { DEFAULT_FORECAST_HORIZON_MONTHS } from '@/lib/pipeline-math'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Read `pipeline.forecastHorizonMonths` from the settings table. Falls
 * back to {@link DEFAULT_FORECAST_HORIZON_MONTHS} if unset, blank, or
 * non-numeric. Always returns a positive integer.
 */
export async function readForecastHorizonMonths(database: D1): Promise<number> {
  try {
    const rows = await database
      .select({ value: schema.settings.value })
      .from(schema.settings)
      .where(eq(schema.settings.key, 'pipeline.forecastHorizonMonths'))
      .limit(1)
    const raw = rows[0]?.value
    const parsed = raw != null ? parseInt(raw, 10) : NaN
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  } catch {
    // Setting lookup failed — fall through to default.
  }
  return DEFAULT_FORECAST_HORIZON_MONTHS
}
