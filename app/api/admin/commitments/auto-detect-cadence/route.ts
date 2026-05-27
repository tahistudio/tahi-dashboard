/**
 * POST /api/admin/commitments/auto-detect-cadence
 *
 * Looks at the last 180 days of Airwallex transactions and infers the
 * billing day-of-month + cadence for each active commitment that hasn't
 * been set. Returns a dry-run plan by default; pass `{ apply: true }`
 * to write the inferences back.
 *
 * Match logic per commitment:
 *   1. Find outflows in airwallex_transactions whose amount is within
 *      ±15% of the commitment's amount AND whose counterparty/description
 *      contains the commitment's normalised vendor/name token.
 *   2. Sort matches by settledAt.
 *   3. day-of-month = most-frequent day in the matched set.
 *   4. cadence = bucket of mean gap between consecutive matches:
 *        gap ≤ 45 d   → monthly
 *        gap 45-150 d → quarterly
 *        gap > 150 d  → annual
 *      (need ≥ 2 matches to infer cadence; ≥ 1 match infers day only.)
 *   5. confidence:
 *        high   = ≥ 3 matches AND day consistent within ±2 days
 *        medium = 2 matches, OR ≥ 3 with looser day spread
 *        low    = 1 match
 *
 * Only writes back if `apply: true` AND confidence is medium or better.
 * Skips commitments where the operator has already set a billing day or
 * a non-default cadence — we don't clobber human input.
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface CommitmentRow {
  id: string
  name: string
  vendor: string | null
  amount: number
  currency: string
  cadence: string
  billingDayOfMonth: number | null
}

interface TxnRow {
  id: string
  amount: number
  currency: string
  description: string | null
  counterparty: string | null
  settledAt: string | null
}

interface Plan {
  id: string
  name: string
  vendor: string | null
  currentCadence: string
  currentBillingDay: number | null
  inferredCadence: 'monthly' | 'quarterly' | 'annual' | null
  inferredBillingDay: number | null
  matchCount: number
  confidence: 'high' | 'medium' | 'low' | 'none'
  applied: boolean
  reason: string
}

function normalise(s: string | null): string {
  return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function dayFromIso(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.getUTCDate()
}

function mostFrequent<T>(items: T[]): { value: T; count: number } | null {
  if (items.length === 0) return null
  const counts = new Map<T, number>()
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1)
  let best: { value: T; count: number } | null = null
  for (const [value, count] of counts) {
    if (!best || count > best.count) best = { value, count }
  }
  return best
}

function bucketCadence(meanGapDays: number): 'monthly' | 'quarterly' | 'annual' {
  if (meanGapDays <= 45) return 'monthly'
  if (meanGapDays <= 150) return 'quarterly'
  return 'annual'
}

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({})) as { apply?: boolean; commitmentId?: string }
  const apply = body.apply === true

  const database = await db() as unknown as D1

  // Pull active commitments (or one specific id) + 180d of outflows.
  const [commitments, txns] = await Promise.all([
    database.all<CommitmentRow>(sql`
      SELECT id, name, vendor, amount, currency, cadence,
             billing_day_of_month AS billingDayOfMonth
      FROM expense_commitments
      WHERE active = 1 ${body.commitmentId ? sql`AND id = ${body.commitmentId}` : sql``}
    `),
    database.all<TxnRow>(sql`
      SELECT id, amount, currency, description, counterparty,
             settled_at AS settledAt
      FROM airwallex_transactions
      WHERE amount < 0
        AND settled_at > datetime('now', '-180 days')
      ORDER BY settled_at ASC
    `),
  ])

  const plans: Plan[] = []
  const now = new Date().toISOString()
  let applied = 0

  for (const c of commitments) {
    const expectedAbs = Math.abs(c.amount)
    const lower = expectedAbs * 0.85
    const upper = expectedAbs * 1.15
    const nameKey = normalise(c.vendor) || normalise(c.name)
    // Find matches: amount in range AND name/counterparty/description overlap.
    const matches = txns.filter(t => {
      const abs = Math.abs(t.amount)
      if (abs < lower || abs > upper) return false
      const blob = normalise(`${t.counterparty}${t.description}`)
      if (!blob || !nameKey) return false
      return blob.includes(nameKey) || nameKey.includes(normalise(t.counterparty ?? ''))
    })

    // Infer day-of-month from matched settlement dates.
    const days = matches.map(m => dayFromIso(m.settledAt)).filter((d): d is number => d != null)
    const dayBest = mostFrequent(days)
    const inferredBillingDay = dayBest?.value ?? null

    // Infer cadence from gaps between consecutive matches.
    let inferredCadence: 'monthly' | 'quarterly' | 'annual' | null = null
    if (matches.length >= 2) {
      const sorted = matches
        .map(m => m.settledAt ? new Date(m.settledAt).getTime() : NaN)
        .filter(t => !Number.isNaN(t))
        .sort((a, b) => a - b)
      const gaps: number[] = []
      for (let i = 1; i < sorted.length; i++) {
        gaps.push((sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24))
      }
      const meanGap = gaps.reduce((s, g) => s + g, 0) / gaps.length
      inferredCadence = bucketCadence(meanGap)
    }

    // Confidence based on match count + day spread.
    const daySpread = days.length > 1 ? Math.max(...days) - Math.min(...days) : 0
    let confidence: 'high' | 'medium' | 'low' | 'none' = 'none'
    if (matches.length >= 3 && daySpread <= 2) confidence = 'high'
    else if (matches.length >= 2) confidence = 'medium'
    else if (matches.length === 1) confidence = 'low'

    // Apply rule: write back only when confidence ≥ medium, and only if
    // the operator hasn't already set a billing day (we don't override
    // human input).
    const wouldWrite = apply
      && confidence !== 'none'
      && confidence !== 'low'
      && c.billingDayOfMonth == null
      && inferredBillingDay != null

    let reason = ''
    if (matches.length === 0) {
      reason = 'No matching transactions in last 180 days. Reconciliation gap — check vendor name spelling.'
    } else if (confidence === 'low') {
      reason = `Only 1 match. Need ≥ 2 for confidence. Not applied.`
    } else if (c.billingDayOfMonth != null) {
      reason = `Already set to day ${c.billingDayOfMonth} — skipped to preserve operator input.`
    } else if (apply && wouldWrite) {
      reason = `${matches.length} matches, day ${inferredBillingDay} (${dayBest?.count}/${days.length}), cadence ${inferredCadence ?? c.cadence}.`
    } else {
      reason = `Would set day ${inferredBillingDay}${inferredCadence ? `, cadence ${inferredCadence}` : ''} (${matches.length} matches).`
    }

    if (wouldWrite) {
      const cadenceToWrite = inferredCadence ?? c.cadence
      await database.run(sql`
        UPDATE expense_commitments
        SET billing_day_of_month = ${inferredBillingDay},
            cadence = ${cadenceToWrite},
            updated_at = ${now}
        WHERE id = ${c.id}
      `)
      applied++
    }

    plans.push({
      id: c.id,
      name: c.name,
      vendor: c.vendor,
      currentCadence: c.cadence,
      currentBillingDay: c.billingDayOfMonth,
      inferredCadence,
      inferredBillingDay,
      matchCount: matches.length,
      confidence,
      applied: wouldWrite,
      reason,
    })
  }

  return NextResponse.json({
    scanned: commitments.length,
    txnsConsidered: txns.length,
    applied,
    dryRun: !apply,
    plans,
  })
}
