/**
 * POST /api/admin/integrations/airwallex/sync
 *
 * Pulls current balances + recent transactions from Airwallex and
 * upserts into airwallex_balances + airwallex_transactions.
 *
 * Window: by default, last 30 days of transactions. Pass ?days=N to
 * widen the window (e.g. ?days=90 on the first sync to backfill).
 *
 * Idempotent — uses Airwallex's own transaction id as the primary key,
 * so a re-sync of an existing window just refreshes the same rows.
 *
 * Auth: admin session OR Bearer cron secret (so the daily GH Action
 * can fire it).
 */

import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray } from 'drizzle-orm'
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
  }

  const url = new URL(req.url)
  const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get('days') ?? '30', 10)))
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

  // Balances: upsert one row per currency. We key on accountId (the
  // env-configured one) + currency since Airwallex returns one balance
  // entry per currency under a single account.
  let balanceUpserts = 0
  for (const b of balances) {
    const id = `${accountId ?? 'default'}:${b.currency}`
    const existing = await database
      .select({ accountId: schema.airwallexBalances.accountId })
      .from(schema.airwallexBalances)
      .where(eq(schema.airwallexBalances.accountId, id))
      .limit(1)
    if (existing.length > 0) {
      await database.update(schema.airwallexBalances).set({
        accountName: `Airwallex ${b.currency}`,
        balance: b.total_amount,
        availableBalance: b.available_amount,
        asOf: nowIso,
        updatedAt: nowIso,
      }).where(eq(schema.airwallexBalances.accountId, id))
    } else {
      await database.insert(schema.airwallexBalances).values({
        accountId: id,
        accountName: `Airwallex ${b.currency}`,
        currency: b.currency,
        balance: b.total_amount,
        availableBalance: b.available_amount,
        asOf: nowIso,
        updatedAt: nowIso,
      })
    }
    balanceUpserts++
  }

  // Transactions: upsert by Airwallex id. We pre-fetch existing ids in
  // chunks of 200 to keep query size sane.
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

  let created = 0
  let updated = 0
  for (const t of transactions) {
    // Airwallex transaction direction: deposits positive, withdrawals
    // negative. Their API sometimes returns absolute values with a
    // separate sign — normalise here.
    const signedAmount = (t.transaction_type ?? t.source_type ?? '').toLowerCase().includes('with')
      || (t.transaction_type ?? '').toLowerCase().includes('fee')
      || (t.transaction_type ?? '').toLowerCase().includes('payout')
      ? -Math.abs(t.amount)
      : t.amount
    const desc = t.description ?? t.reference ?? null
    const counterparty = t.source ?? null
    const txnType = (t.transaction_type ?? t.source_type ?? 'unknown').toLowerCase()
    const settledAt = t.posted_at ?? null

    if (existingTxnIds.has(t.id)) {
      await database.update(schema.airwallexTransactions).set({
        amount: signedAmount,
        currency: t.currency,
        type: txnType,
        description: desc,
        counterparty,
        settledAt,
      }).where(eq(schema.airwallexTransactions.id, t.id))
      updated++
    } else {
      await database.insert(schema.airwallexTransactions).values({
        id: t.id,
        accountId: accountId ?? 'default',
        amount: signedAmount,
        currency: t.currency,
        type: txnType,
        description: desc,
        counterparty,
        settledAt,
        reconciliationStatus: 'orphan',
        createdAt: t.created_at ?? nowIso,
      })
      created++
    }
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

  const summary = {
    days,
    balances: balanceUpserts,
    transactions: { fetched: transactions.length, created, updated },
  }
  await logCronRun(database, 'sync-airwallex', 'success', Date.now() - t0, summary, null)
  return NextResponse.json(summary)
}
