import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

// GET /api/admin/exchange-rates - list all cached rates
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const database = await db()
  const rates = await database.select().from(schema.exchangeRates)

  // Convert to NZD-based rates for display
  const usdToNzd = rates.find(r => r.currency === 'NZD')?.rateToUsd ?? 1
  const nzdRates = rates.map(r => ({
    currency: r.currency,
    rateToUsd: r.rateToUsd,
    rateToNzd: r.rateToUsd / usdToNzd,
    updatedAt: r.updatedAt,
  }))

  return NextResponse.json({ rates: nzdRates, baseCurrency: 'NZD' })
}

// POST /api/admin/exchange-rates/refresh - fetch latest rates from OpenExchangeRates
export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const appId = process.env.OPEN_EXCHANGE_RATES_APP_ID
  if (!appId) {
    return NextResponse.json(
      { error: 'OPEN_EXCHANGE_RATES_APP_ID not configured' },
      { status: 500 },
    )
  }

  // Fetch from OpenExchangeRates API
  const currencies = ['NZD', 'USD', 'AUD', 'GBP', 'EUR', 'CAD', 'SGD', 'HKD', 'JPY', 'CHF']
  const symbols = currencies.join(',')

  const res = await fetch(
    `https://openexchangerates.org/api/latest.json?app_id=${appId}&symbols=${symbols}`,
  )

  if (!res.ok) {
    return NextResponse.json(
      { error: 'Failed to fetch exchange rates' },
      { status: 502 },
    )
  }

  const data = await res.json() as {
    rates: Record<string, number>
    timestamp: number
  }

  const database = await db()
  const now = new Date().toISOString()

  // Upsert every rate via onConflictDoUpdate on the currency primary key.
  // This drops the per-currency existence SELECT (and the separate USD
  // existence check) and runs the writes in one concurrent wave instead of
  // ~20 sequential round-trips.
  const ratesToUpsert = Object.entries(data.rates).map(([currency, rateToUsd]) => ({
    currency,
    rateToUsd,
    updatedAt: now,
  }))

  // Ensure USD = 1 is represented even if the API omitted it from symbols.
  if (!ratesToUpsert.some(r => r.currency === 'USD')) {
    ratesToUpsert.push({ currency: 'USD', rateToUsd: 1, updatedAt: now })
  }

  await Promise.all(
    ratesToUpsert.map(r =>
      database
        .insert(schema.exchangeRates)
        .values(r)
        .onConflictDoUpdate({
          target: schema.exchangeRates.currency,
          set: { rateToUsd: r.rateToUsd, updatedAt: r.updatedAt },
        })
    )
  )

  // Return NZD-based rates
  const allRates = await database.select().from(schema.exchangeRates)
  const usdToNzd = allRates.find(r => r.currency === 'NZD')?.rateToUsd ?? 1

  return NextResponse.json({
    rates: allRates.map(r => ({
      currency: r.currency,
      rateToUsd: r.rateToUsd,
      rateToNzd: r.rateToUsd / usdToNzd,
    })),
    baseCurrency: 'NZD',
    updatedAt: now,
    source: 'openexchangerates.org',
  })
}
