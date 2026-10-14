import { and, desc, isNotNull, lt } from 'drizzle-orm'
import { schema } from '@/db/d1'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/** Live MRR compared with the latest earlier month that recorded real MRR. */
export async function readMrrDelta(database: D1, mrrNzd: number, now = new Date()): Promise<{
  mrrDeltaPct: number | null
  mrrDeltaBasisMonth: string | null
}> {
  const empty = { mrrDeltaPct: null, mrrDeltaBasisMonth: null }
  try {
    const currentMonth = now.toISOString().slice(0, 7)
    const [prior] = await database
      .select({ mrrNzd: schema.financialSnapshots.mrrNzd, monthKey: schema.financialSnapshots.monthKey })
      .from(schema.financialSnapshots)
      .where(and(lt(schema.financialSnapshots.monthKey, currentMonth), isNotNull(schema.financialSnapshots.mrrNzd)))
      .orderBy(desc(schema.financialSnapshots.monthKey))
      .limit(1)
    if (!prior || prior.mrrNzd == null || prior.mrrNzd <= 0 || !Number.isFinite(mrrNzd)) return empty
    return {
      mrrDeltaPct: Math.round(((mrrNzd - prior.mrrNzd) / prior.mrrNzd) * 1000) / 10,
      mrrDeltaBasisMonth: prior.monthKey,
    }
  } catch {
    return empty
  }
}
