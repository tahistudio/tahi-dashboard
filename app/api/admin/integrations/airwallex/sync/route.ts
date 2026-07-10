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
import { eq, inArray, sql } from 'drizzle-orm'
import { listBalances, listTransactions, AirwallexNotConfiguredError, getAirwallexToken } from '@/lib/airwallex'
import { logCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  // Auth: admin session OR cron secret.
  const cronHeader = req.headers.get('x-cron-secret')
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.TAHI_CRON_SECRET ?? process.env.CRON_SECRET
  const hasCronAuth = !!cronSecret && (cronHeader === cronSecret || authHeader === `Bearer ${cronSecret}`)
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

  // Chunk size for multi-row upserts. Kept well under D1's bound-parameter
  // ceiling (balances ~7 cols/row, txns ~10 cols/row) and small enough that a
  // single statement stays cheap. Batching the writes this way is the whole
  // fix: the old per-row SELECT-then-UPDATE/INSERT fired ~2 D1 round-trips per
  // balance and per transaction, so once the window widened past ~14 days the
  // cumulative round-trips blew the Worker execution budget and threw an
  // unhandled (unlogged, empty-body 500) error.
  const CHUNK = 15

  let balanceUpserts = 0
  let created = 0
  let updated = 0
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
    for (let i = 0; i < balanceRows.length; i += CHUNK) {
      const slice = balanceRows.slice(i, i + CHUNK)
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
    for (let i = 0; i < txnIds.length; i += 200) {
      const chunk = txnIds.slice(i, i + 200)
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
    for (let i = 0; i < txnRows.length; i += CHUNK) {
      const slice = txnRows.slice(i, i + CHUNK)
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
  }
  await logCronRun(database, 'sync-airwallex', 'success', Date.now() - t0, summary, null)
  return NextResponse.json(summary)
}
