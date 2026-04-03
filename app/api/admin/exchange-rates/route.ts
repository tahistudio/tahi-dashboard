import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq } from 'drizzle-orm'

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

  // Upsert each rate
  for (const [currency, rateToUsd] of Object.entries(data.rates)) {
    const existing = await database
      .select()
      .from(schema.exchangeRates)
      .where(eq(schema.exchangeRates.currency, currency))
      .limit(1)

    if (existing.length > 0) {
      await database
        .update(schema.exchangeRates)
        .set({ rateToUsd, updatedAt: now })
        .where(eq(schema.exchangeRates.currency, currency))
    } else {
      await database
        .insert(schema.exchangeRates)
        .values({ currency, rateToUsd, updatedAt: now })
    }
  }

  // Also ensure USD = 1 is stored
  const usdExists = await database
    .select()
    .from(schema.exchangeRates)
    .where(eq(schema.exchangeRates.currency, 'USD'))
    .limit(1)

  if (usdExists.length === 0) {
    await database.insert(schema.exchangeRates).values({
      currency: 'USD',
      rateToUsd: 1,
      updatedAt: now,
    })
  }

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
