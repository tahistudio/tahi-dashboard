import { requireFeature } from '@/lib/require-feature'
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { hasCronSecretAuth, logCronRun } from '@/lib/cron-runs'
import { SUPPORTED_CURRENCIES } from '@/lib/currency'
import { fxFreshness } from '@/lib/fx-freshness'

const REFRESH_TIMEOUT_MS = 15_000
const MAX_SOURCE_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000

interface ProviderRates {
  updatedAt: string
  rates: Array<{ currency: string; rateToUsd: number; updatedAt: string }>
}

function parseProviderRates(data: unknown): ProviderRates {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid exchange rate response')
  }
  const payload = data as Record<string, unknown>
  if (payload.base !== undefined && payload.base !== 'USD') {
    throw new Error('Exchange rate provider must use USD as its base')
  }
  const sourceMs = typeof payload.timestamp === 'number' ? payload.timestamp * 1000 : NaN
  const now = Date.now()
  if (!Number.isSafeInteger(payload.timestamp) || !Number.isFinite(sourceMs)
    || sourceMs < now - MAX_SOURCE_AGE_MS || sourceMs > now + MAX_FUTURE_SKEW_MS) {
    throw new Error('Exchange rate provider timestamp is missing, stale or invalid')
  }
  if (!payload.rates || typeof payload.rates !== 'object' || Array.isArray(payload.rates)) {
    throw new Error('Invalid exchange rate response')
  }
  const sourceRates = payload.rates as Record<string, unknown>
  const updatedAt = new Date(sourceMs).toISOString()
  const rates = SUPPORTED_CURRENCIES.map(({ code: currency }) => {
    const rateToUsd = currency === 'USD' && sourceRates.USD === undefined ? 1 : sourceRates[currency]
    if (typeof rateToUsd !== 'number' || !Number.isFinite(rateToUsd) || rateToUsd <= 0
      || (currency === 'USD' && rateToUsd !== 1)) {
      throw new Error(`Exchange rate provider is missing a valid ${currency} rate`)
    }
    return { currency, rateToUsd, updatedAt }
  })
  return { updatedAt, rates }
}

async function fetchProviderRates(appId: string): Promise<ProviderRates> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const url = new URL('https://openexchangerates.org/api/latest.json')
        url.searchParams.set('app_id', appId)
        url.searchParams.set('symbols', SUPPORTED_CURRENCIES.map(({ code }) => code).join(','))
        let response: Response
        try {
          response = await fetch(url, { signal: controller.signal })
        } catch {
          throw new Error('Failed to fetch exchange rates')
        }
        if (!response.ok) throw new Error('Failed to fetch exchange rates')
        let payload: unknown
        try {
          payload = await response.json()
        } catch {
          throw new Error('Invalid exchange rate response')
        }
        return parseProviderRates(payload)
      })(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Exchange rate refresh timed out'))
          controller.abort()
        }, REFRESH_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

// GET /api/admin/exchange-rates - list all cached rates
export async function GET(req: NextRequest) {
  const { orgId, userId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const featureDenied = await requireFeature({ userId, orgId }, 'financial_reports')
  if (featureDenied) return featureDenied

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

  return NextResponse.json({ rates: nzdRates, baseCurrency: 'NZD', fxFreshness: fxFreshness(rates) })
}

// POST /api/admin/exchange-rates, manual or scheduled refresh from OpenExchangeRates.
export async function POST(req: NextRequest) {
  if (!hasCronSecretAuth(req)) {
    const { orgId, userId } = await getRequestAuth(req)
    if (!isTahiAdmin(orgId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const featureDenied = await requireFeature({ userId, orgId }, 'financial_reports')
    if (featureDenied) return featureDenied
  }

  const database = await db()
  const startedAt = Date.now()
  const appId = process.env.OPEN_EXCHANGE_RATES_APP_ID
  if (!appId) {
    const error = 'OPEN_EXCHANGE_RATES_APP_ID not configured'
    await logCronRun(database, 'refresh-exchange-rates', 'error', Date.now() - startedAt, null, error)
    return NextResponse.json(
      { error },
      { status: 500 },
    )
  }

  let provider: ProviderRates
  try {
    provider = await fetchProviderRates(appId)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch exchange rates'
    await logCronRun(database, 'refresh-exchange-rates', 'error', Date.now() - startedAt, null, message)
    return NextResponse.json({ error: message }, { status: 502 })
  }

  try {
    // D1 batch is transactional: one failed rate leaves the complete previous set.
    const writes = provider.rates.map(r =>
      database
        .insert(schema.exchangeRates)
        .values(r)
        .onConflictDoUpdate({
          target: schema.exchangeRates.currency,
          set: { rateToUsd: r.rateToUsd, updatedAt: r.updatedAt },
        })
    )
    await database.batch([writes[0], ...writes.slice(1)])
  } catch {
    const error = 'Failed to save exchange rates'
    await logCronRun(database, 'refresh-exchange-rates', 'error', Date.now() - startedAt, null, error)
    return NextResponse.json({ error }, { status: 500 })
  }

  const usdToNzd = provider.rates.find(r => r.currency === 'NZD')!.rateToUsd
  const summary = { count: provider.rates.length, updatedAt: provider.updatedAt }
  await logCronRun(database, 'refresh-exchange-rates', 'success', Date.now() - startedAt, summary, null)
  return NextResponse.json({
    rates: provider.rates.map(r => ({
      currency: r.currency,
      rateToUsd: r.rateToUsd,
      rateToNzd: r.rateToUsd / usdToNzd,
      updatedAt: r.updatedAt,
    })),
    baseCurrency: 'NZD',
    updatedAt: provider.updatedAt,
    fxFreshness: fxFreshness(provider.rates),
    source: 'openexchangerates.org',
  })
}
