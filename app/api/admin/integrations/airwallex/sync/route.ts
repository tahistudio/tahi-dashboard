/**
 * POST /api/admin/integrations/airwallex/sync
 *
 * Pulls current balances + recent transactions from Airwallex and
 * upserts into airwallex_balances + airwallex_transactions.
 *
 * Window: by default, last 30 days of transactions. Pass ?days=N to
 * widen the window (e.g. ?days=90 on the first sync to backfill).
 *
 * Idempotent: uses Airwallex's own transaction id as the primary key,
 * so a re-sync of an existing window just refreshes the same rows.
 *
 * Auth: admin session OR Bearer cron secret (so the daily GH Action
 * can fire it).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { requireFeature } from '@/lib/require-feature'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray, like, sql } from 'drizzle-orm'
import { listBalances, listTransactions, AirwallexNotConfiguredError, getAirwallexToken } from '@/lib/airwallex'
import { logCronRun, hasCronSecretAuth } from '@/lib/cron-runs'
import { recordYieldHeld, YIELD_HOLDINGS_KEY } from '@/lib/yield-history'
import { readXeroYieldHoldings, YIELD_ACCOUNT_IDS_KEY, type YieldReadResult } from '@/lib/yield-holdings'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  // Auth: admin session OR cron secret.
  const hasCronAuth = hasCronSecretAuth(req)
  if (!hasCronAuth) {
    const auth = await getRequestAuth(req)
    if (!isTahiAdmin(auth.orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const denied = await requireFeature(auth, 'settings.integrations')
    if (denied) return denied
  }

  const url = new URL(req.url)
  // Default 14 days. 30+ was hitting Cloudflare Workers' execution
  // budget on the contiguous D1 writes (Airwallex can return hundreds
  // of txns over 30 days). 14 days is enough for daily-sync freshness;
  // pass ?days=N up to 365 for an explicit backfill.
  const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') ?? '14', 10)))
  const fromCreatedAt = new Date(Date.now() - days * 86400_000).toISOString()
  const toCreatedAt = new Date().toISOString()

  const accountId = process.env.AIRWALLEX_ACCOUNT_ID ?? null

  let balances, transactions
  try {
    // Warm the cached token FIRST. Without this, listBalances() and
    // listTransactions() race for the login → both try INSERT-on-empty
    // into integrations(service='airwallex') and one fails the UNIQUE
    // constraint. Sequential pre-warm fixes it cheaply.
    await getAirwallexToken()
    ;[balances, transactions] = await Promise.all([
      listBalances(),
      listTransactions({ fromCreatedAt, toCreatedAt }),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = err instanceof AirwallexNotConfiguredError ? 412 : 502
    const database = await db() as unknown as D1
    await logCronRun(database, 'sync-airwallex', 'error', Date.now() - t0, null, msg)
    return NextResponse.json({ error: msg }, { status })
  }

  const database = await db() as unknown as D1
  const nowIso = new Date().toISOString()

  // D1 caps bound parameters at 100 per statement, so size each multi-row
  // upsert by its column count to stay safely under that (a 90-param budget
  // leaves margin). Batching the writes this way is the whole fix: the old
  // per-row SELECT-then-UPDATE/INSERT fired ~2 D1 round-trips per balance and
  // per transaction, so once the window widened past ~14 days the cumulative
  // round-trips blew the Worker execution budget and threw an unhandled
  // (unlogged, empty-body 500) error.
  const PARAM_BUDGET = 90
  const balChunk = Math.max(1, Math.floor(PARAM_BUDGET / 7))   // 7 cols/row -> 12
  const txnChunk = Math.max(1, Math.floor(PARAM_BUDGET / 10))  // 10 cols/row -> 9

  let balanceUpserts = 0
  let created = 0
  let updated = 0
  let yieldRows = 0
  let yieldMalformed = false
  let yieldMarked = false
  let yieldRefresh: YieldReadResult | null = null
  try {
    // Balances: one row per currency, keyed on accountId. Bulk upsert in
    // chunks; on conflict refresh the amounts + timestamps from the new row.
    const balanceRows = balances.map(b => ({
      accountId: `${accountId ?? 'default'}:${b.currency}`,
      accountName: `Airwallex ${b.currency}`,
      currency: b.currency,
      balance: b.total_amount,
      availableBalance: b.available_amount,
      asOf: nowIso,
      updatedAt: nowIso,
    }))
    for (let i = 0; i < balanceRows.length; i += balChunk) {
      const slice = balanceRows.slice(i, i + balChunk)
      if (slice.length === 0) break
      await database.insert(schema.airwallexBalances).values(slice).onConflictDoUpdate({
        target: schema.airwallexBalances.accountId,
        set: {
          accountName: sql`excluded.account_name`,
          balance: sql`excluded.balance`,
          availableBalance: sql`excluded.available_balance`,
          asOf: sql`excluded.as_of`,
          updatedAt: sql`excluded.updated_at`,
        },
      })
    }
    balanceUpserts = balanceRows.length

    // Transactions: pre-fetch existing ids (chunked SELECTs, cheap) purely to
    // report created-vs-updated counts; the writes themselves are bulk
    // upserts keyed on the Airwallex transaction id. On conflict we refresh
    // the mutable fields but never reset reconciliation_status / created_at.
    const txnIds = transactions.map(t => t.id)
    const existingTxnIds = new Set<string>()
    for (let i = 0; i < txnIds.length; i += PARAM_BUDGET) {
      const chunk = txnIds.slice(i, i + PARAM_BUDGET)
      if (chunk.length === 0) break
      const rows = await database
        .select({ id: schema.airwallexTransactions.id })
        .from(schema.airwallexTransactions)
        .where(inArray(schema.airwallexTransactions.id, chunk))
      rows.forEach(r => existingTxnIds.add(r.id))
    }

    const txnRows = transactions.map(t => {
      // Airwallex transaction direction: deposits positive, withdrawals
      // negative. Their API sometimes returns absolute values with a
      // separate sign, so normalise here.
      const signedAmount = (t.transaction_type ?? t.source_type ?? '').toLowerCase().includes('with')
        || (t.transaction_type ?? '').toLowerCase().includes('fee')
        || (t.transaction_type ?? '').toLowerCase().includes('payout')
        ? -Math.abs(t.amount)
        : t.amount
      if (existingTxnIds.has(t.id)) updated++
      else created++
      return {
        id: t.id,
        accountId: accountId ?? 'default',
        amount: signedAmount,
        currency: t.currency,
        type: (t.transaction_type ?? t.source_type ?? 'unknown').toLowerCase(),
        description: t.description ?? t.reference ?? null,
        counterparty: t.source ?? null,
        settledAt: t.posted_at ?? null,
        reconciliationStatus: 'orphan',
        createdAt: t.created_at ?? nowIso,
      }
    })
    for (let i = 0; i < txnRows.length; i += txnChunk) {
      const slice = txnRows.slice(i, i + txnChunk)
      if (slice.length === 0) break
      await database.insert(schema.airwallexTransactions).values(slice).onConflictDoUpdate({
        target: schema.airwallexTransactions.id,
        set: {
          amount: sql`excluded.amount`,
          currency: sql`excluded.currency`,
          type: sql`excluded.type`,
          description: sql`excluded.description`,
          counterparty: sql`excluded.counterparty`,
          settledAt: sql`excluded.settled_at`,
        },
      })
    }

    // Yield holdings (Airwallex Capital). The public Airwallex API only
    // exposes wallet balances. Read the documented Xero AWX Yield USD/AUD
    // accounts every sync and retain the saved setting when either cannot
    // be read. Xero BankSummary reports base-currency amounts, never native
    // USD/AUD amounts. Each sync materialises the setting's currency/amount
    // as extra airwallex_balances rows (accountId 'yield:CUR') so every
    // reader (overview cash, financial-reports summary, bank-balances,
    // forward snapshots) includes them with no special cases. Rows for
    // currencies removed from the setting are deleted. The snapshot
    // BACKFILL and the Xero drift check both exclude 'yield:' rows by key,
    // and the first holding any sync sees is recorded in
    // finance.yieldFirstHeldAt, which nothing clears.
    const yieldSettings = await database
      .select({ key: schema.settings.key, value: schema.settings.value, updatedAt: schema.settings.updatedAt })
      .from(schema.settings)
      .where(inArray(schema.settings.key, [YIELD_HOLDINGS_KEY, YIELD_ACCOUNT_IDS_KEY]))
    const savedYieldSetting = yieldSettings.find(setting => setting.key === YIELD_HOLDINGS_KEY)
    // finance.yieldAccountIds may pin USD and/or AUD IDs when account names change.
    // A malformed pin retains the last good holdings rather than selecting another account.
    const pinnedAccounts = yieldSettings.find(setting => setting.key === YIELD_ACCOUNT_IDS_KEY)
    yieldRefresh = await readXeroYieldHoldings(nowIso, pinnedAccounts?.value)
    const yieldSetting = yieldRefresh.ok
      ? { value: JSON.stringify(yieldRefresh.holdings), updatedAt: nowIso }
      : savedYieldSetting
    // A missing setting or an empty array means "no yield held" and clears
    // the materialised rows. A document that fails to parse, or contains
    // ANY invalid entry, means "don't touch anything": the last good
    // holdings keep counting until the setting is fixed. One typo'd entry
    // must never silently delete a real position from every cash surface.
    // Multiple tranches of the same currency sum into one 'yield:CUR' row.
    const holdingsByCurrency = new Map<string, number>()
    let holdingsReadable = true
    if (yieldSetting?.value) {
      try {
        const parsed = JSON.parse(yieldSetting.value) as unknown
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            const rec = entry && typeof entry === 'object'
              ? entry as { currency?: unknown; amount?: unknown }
              : null
            const cur = typeof rec?.currency === 'string' ? rec.currency.trim().toUpperCase() : ''
            const amt = typeof rec?.amount === 'number' ? rec.amount : Number.NaN
            if (!rec || !/^[A-Z]{3}$/.test(cur) || !Number.isFinite(amt) || amt < 0) {
              holdingsReadable = false
              break
            }
            const combined = (holdingsByCurrency.get(cur) ?? 0) + amt
            if (!Number.isFinite(combined)) {
              holdingsReadable = false
              break
            }
            holdingsByCurrency.set(cur, combined)
          }
        } else {
          holdingsReadable = false
        }
      } catch {
        holdingsReadable = false
      }
    }
    yieldMalformed = !holdingsReadable
    const existingYield = await database
      .select({ accountId: schema.airwallexBalances.accountId, balance: schema.airwallexBalances.balance,
        asOf: schema.airwallexBalances.asOf, updatedAt: schema.airwallexBalances.updatedAt })
      .from(schema.airwallexBalances)
      .where(like(schema.airwallexBalances.accountId, 'yield:%'))
    if (!yieldSetting?.value && existingYield.length > 0) {
      holdingsReadable = false
      yieldMalformed = true
    }
    // Before any yield row is written or deleted: a holding seen here, in
    // the rows or in the setting, is recorded for good in
    // finance.yieldFirstHeldAt, so the month-end cash rebuild still knows
    // yield was held after the setting is emptied and the rows go
    // (lib/yield-history.ts).
    // A saved holding may already have been withdrawn in Xero before any
    // sync wrote its durable history marker. Preserve that evidence too.
    const previouslyHeld: number[] = []
    if (yieldRefresh.ok && savedYieldSetting?.value) {
      try {
        const previous = JSON.parse(savedYieldSetting.value) as unknown
        if (Array.isArray(previous)) {
          for (const entry of previous) {
            const amount = entry && typeof entry === 'object'
              ? (entry as { amount?: unknown }).amount
              : null
            if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) previouslyHeld.push(amount)
          }
        }
      } catch { /* Materialised rows still preserve the last known holding. */ }
    }
    yieldMarked = await recordYieldHeld(
      database,
      [...existingYield.map(r => r.balance), ...previouslyHeld, ...(holdingsReadable ? holdingsByCurrency.values() : [])],
      nowIso,
    )
    if (holdingsReadable) {
      const wanted = new Set([...holdingsByCurrency.keys()].map(cur => `yield:${cur}`))
      const stale = existingYield.map(r => r.accountId).filter(id => !wanted.has(id))
      const deletes = Array.from({ length: Math.ceil(stale.length / PARAM_BUDGET) }, (_, index) => database
        .delete(schema.airwallexBalances)
        .where(inArray(schema.airwallexBalances.accountId, stale.slice(index * PARAM_BUDGET, (index + 1) * PARAM_BUDGET))))
      const yieldRowValues = [...holdingsByCurrency.entries()].map(([cur, amount]) => {
        const existing = existingYield.find(row => row.accountId === `yield:${cur}`)
        const unchanged = !yieldRefresh?.ok && existing?.balance === amount
        return {
          accountId: `yield:${cur}`,
          accountName: `Airwallex ${cur} Yield`,
          currency: cur,
          balance: amount,
          availableBalance: amount,
          asOf: unchanged ? existing.asOf : yieldSetting?.updatedAt ?? nowIso,
          updatedAt: unchanged ? existing.updatedAt : yieldSetting?.updatedAt ?? nowIso,
        }
      })
      const upserts = Array.from({ length: Math.ceil(yieldRowValues.length / balChunk) }, (_, index) => database
        .insert(schema.airwallexBalances).values(yieldRowValues.slice(index * balChunk, (index + 1) * balChunk)).onConflictDoUpdate({
          target: schema.airwallexBalances.accountId,
          set: {
            accountName: sql`excluded.account_name`,
            currency: sql`excluded.currency`,
            balance: sql`excluded.balance`,
            availableBalance: sql`excluded.available_balance`,
            asOf: sql`excluded.as_of`,
            updatedAt: sql`excluded.updated_at`,
          },
        }))
      const value = yieldSetting?.value ?? '[]'
      const settingWrites = yieldRefresh.ok
        ? [database.insert(schema.settings).values({ key: YIELD_HOLDINGS_KEY, value, updatedAt: nowIso })
          .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: nowIso } })]
        : []
      const writes = [...deletes, ...upserts, ...settingWrites]
      // D1 batch is transactional: a failed currency-row replacement cannot
      // remove cash or stamp an unmaterialised holding as freshly read.
      if (writes.length > 0) await database.batch([writes[0], ...writes.slice(1)])
      yieldRows = yieldRowValues.length
    }

    // Stamp lastSyncedAt on the integration row so /settings/crons +
    // anomaly checks can spot stale data.
    const [existingInt] = await database
      .select({ id: schema.integrations.id })
      .from(schema.integrations)
      .where(eq(schema.integrations.service, 'airwallex'))
      .limit(1)
    if (existingInt) {
      await database
        .update(schema.integrations)
        .set({ lastSyncedAt: nowIso, updatedAt: nowIso })
        .where(eq(schema.integrations.id, existingInt.id))
    }
  } catch (err) {
    // The DB-write section used to be unguarded, so any failure here surfaced
    // as an opaque empty-body 500 and never reached logCronRun (which is why
    // cron_runs went silent after the last success). Record it and return a
    // real error instead.
    const msg = err instanceof Error ? err.message : String(err)
    await logCronRun(database, 'sync-airwallex', 'error', Date.now() - t0, { days, phase: 'db-write' }, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const summary = {
    days,
    balances: balanceUpserts,
    transactions: { fetched: transactions.length, created, updated },
    yieldRows,
    yieldMalformed,
    yieldMarked,
    yieldRefresh: yieldRefresh?.ok
      ? { refreshed: true, source: 'xero_awx_yield', currencyBasis: yieldRefresh.currencyBasis }
      : { refreshed: false, source: 'saved_holdings', warning: yieldRefresh?.warning },
  }
  await logCronRun(database, 'sync-airwallex', 'success', Date.now() - t0, summary, null)
  return NextResponse.json(summary)
}
