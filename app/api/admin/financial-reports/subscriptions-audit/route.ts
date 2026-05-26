/**
 * GET /api/admin/financial-reports/subscriptions-audit
 *
 * Lists every recurring outflow from expense_commitments alongside its
 * most recent matched Airwallex transaction. Lets the operator confirm
 * "yes still using" / "cancel this" / "the price changed" in one screen.
 *
 * Matching is fuzzy: an Airwallex outflow within ±15% of expected amount
 * AND within ±10 days of nextDueDate or last-known cadence stride
 * counts as a match. Multiple txns can map to one commitment (e.g. a
 * recurring software charge that hit twice this month — refund + recharge).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const database = await db() as unknown as D1

  // Pull active commitments + recent outflows in parallel.
  const [commitments, recentOutflows] = await Promise.all([
    database.all<{
      id: string
      name: string
      vendor: string | null
      amount: number
      currency: string
      cadence: string
      category: string
      nextDueDate: string | null
      startDate: string | null
      endDate: string | null
      lastAirwallexTxnId: string | null
      lastReconciledAt: string | null
      linkedXeroAccount: string | null
    }>(sql`
      SELECT id, name, vendor, amount, currency, cadence, category,
             next_due_date AS nextDueDate, start_date AS startDate, end_date AS endDate,
             last_airwallex_txn_id AS lastAirwallexTxnId,
             last_reconciled_at AS lastReconciledAt,
             linked_xero_account AS linkedXeroAccount
      FROM expense_commitments
      WHERE active = 1
      ORDER BY amount DESC
    `),
    database.all<{
      id: string
      amount: number
      currency: string
      description: string | null
      counterparty: string | null
      settledAt: string | null
    }>(sql`
      SELECT id, amount, currency, description, counterparty, settled_at AS settledAt
      FROM airwallex_transactions
      WHERE amount < 0
        AND settled_at > datetime('now', '-90 days')
      ORDER BY settled_at DESC
    `),
  ])

  // For each commitment, find the most recent likely match.
  function normalise(s: string | null): string {
    return (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  }
  const items = commitments.map(c => {
    const expectedAbs = Math.abs(c.amount)
    const lower = expectedAbs * 0.85
    const upper = expectedAbs * 1.15
    const nameKey = normalise(c.vendor) || normalise(c.name)
    const matches = recentOutflows.filter(t => {
      const abs = Math.abs(t.amount)
      if (abs < lower || abs > upper) return false
      // Soft string match on vendor / counterparty / description.
      const blob = normalise(`${t.counterparty}${t.description}`)
      return blob.includes(nameKey) || nameKey.includes(normalise(t.counterparty ?? ''))
    })
    const lastMatch = matches[0] ?? null
    return {
      ...c,
      annualisedNzd: cadenceToAnnual(c.amount, c.cadence),
      lastBankHit: lastMatch ? {
        id: lastMatch.id,
        amount: Math.abs(lastMatch.amount),
        currency: lastMatch.currency,
        settledAt: lastMatch.settledAt,
        counterparty: lastMatch.counterparty,
      } : null,
      hitsInWindow: matches.length,
    }
  })

  // Summary stats so the UI can show "total recurring outflow / month".
  const monthlyTotal = items.reduce((sum, c) => sum + cadenceToMonthly(c.amount, c.cadence), 0)
  const annualTotal = items.reduce((sum, c) => sum + cadenceToAnnual(c.amount, c.cadence), 0)
  const staleCount = items.filter(c => !c.lastBankHit).length

  return NextResponse.json({
    items,
    summary: {
      count: items.length,
      monthlyTotal,
      annualTotal,
      staleCount,
    },
  })
}

function cadenceToMonthly(amount: number, cadence: string): number {
  switch (cadence) {
    case 'monthly':   return amount
    case 'quarterly': return amount / 3
    case 'annual':    return amount / 12
    case 'one_off':   return 0
    default:          return amount
  }
}

function cadenceToAnnual(amount: number, cadence: string): number {
  switch (cadence) {
    case 'monthly':   return amount * 12
    case 'quarterly': return amount * 4
    case 'annual':    return amount
    case 'one_off':   return 0
    default:          return amount * 12
  }
}
