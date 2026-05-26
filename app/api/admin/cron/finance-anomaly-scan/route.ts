/**
 * POST /api/admin/cron/finance-anomaly-scan
 *
 * Sonnet walks the finance picture and surfaces anomalies the operator
 * should know about — subscriptions creep, missing tax reserve,
 * dry-pipeline gaps, recurring commitments with no recent bank hit,
 * cost-mix drift, etc. Output drops into notifications as
 * eventType='finance_anomaly' so the UI on /financial-reports can list
 * unresolved findings.
 *
 * Cadence: weekly (Monday early) for soft signals, monthly (1st) for
 * deeper trend checks. Idempotent via dedup on (eventType, entityId).
 *
 * Auth: admin session OR Bearer cron secret.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { and, eq, sql } from 'drizzle-orm'
import { assertCronAuth, logCronRun } from '@/lib/cron-runs'

export const dynamic = 'force-dynamic'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

interface AnomalyFinding {
  category: string
  severity: 'info' | 'watch' | 'action'
  title: string
  detail: string
  entityRef?: string  // dedup key — same category+title+ref hashed
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()
  const auth = await assertCronAuth(req)
  if (!auth.ok) return auth.response!

  const database = await db() as unknown as D1
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    await logCronRun(database, 'finance-anomaly-scan', 'skipped', Date.now() - t0, { skipped: 'ANTHROPIC_API_KEY missing' }, null)
    return NextResponse.json({ skipped: 'ANTHROPIC_API_KEY missing' })
  }

  // Resolve default lead owner so we know who to ping.
  const [ownerRow] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, 'leads.defaultLeadOwnerId'))
    .limit(1)
  const recipient = ownerRow?.value?.trim()
  if (!recipient) {
    await logCronRun(database, 'finance-anomaly-scan', 'skipped', Date.now() - t0, { skipped: 'No leads.defaultLeadOwnerId' }, null)
    return NextResponse.json({ skipped: 'No leads.defaultLeadOwnerId — nowhere to send findings' })
  }

  // Gather context. Each block is intentionally compact — Sonnet works
  // better on summarised numbers than on raw rows.
  const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString()
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

  const [
    bankRows,
    reserveRows,
    commitments,
    recentOutflows,
    ytdInvoiceRows,
    monthInvoiceRows,
    activeMrrRows,
    wonDealsRows,
    overdueInvoiceRows,
  ] = await Promise.all([
    database.all<{ currency: string; available: number }>(sql`
      SELECT currency, available_balance AS available FROM airwallex_balances
      UNION ALL
      SELECT currency, balance AS available FROM xero_bank_balances
    `),
    database.all<{ name: string; category: string; accruedAmount: number; targetAmount: number | null; accrualRate: number | null }>(sql`
      SELECT name, category, accrued_amount AS accruedAmount, target_amount AS targetAmount, accrual_rate AS accrualRate
      FROM reserves WHERE active = 1
    `),
    database.all<{ name: string; vendor: string | null; amount: number; cadence: string; category: string; lastReconciledAt: string | null }>(sql`
      SELECT name, vendor, amount, cadence, category, last_reconciled_at AS lastReconciledAt
      FROM expense_commitments WHERE active = 1
    `),
    database.all<{ amount: number; description: string | null; counterparty: string | null; settledAt: string | null }>(sql`
      SELECT amount, description, counterparty, settled_at AS settledAt
      FROM airwallex_transactions
      WHERE amount < 0 AND settled_at > datetime('now', '-30 days')
      ORDER BY settled_at DESC
      LIMIT 60
    `),
    database.all<{ total: number | null; cnt: number }>(sql`
      SELECT COALESCE(SUM(total_usd), 0) AS total, COUNT(*) AS cnt
      FROM invoices WHERE paid_at IS NOT NULL AND paid_at >= ${yearStart}
    `),
    database.all<{ total: number | null; cnt: number }>(sql`
      SELECT COALESCE(SUM(total_usd), 0) AS total, COUNT(*) AS cnt
      FROM invoices WHERE paid_at IS NOT NULL AND paid_at >= ${monthStart}
    `),
    database.all<{ name: string; mrr: number }>(sql`
      SELECT name, COALESCE(custom_mrr, 0) AS mrr
      FROM organisations
      WHERE status = 'active' AND custom_mrr IS NOT NULL AND custom_mrr > 0
      ORDER BY custom_mrr DESC
    `),
    database.all<{ cnt: number }>(sql`
      SELECT COUNT(*) AS cnt
      FROM deals d INNER JOIN pipeline_stages s ON d.stage_id = s.id
      WHERE s.is_closed_won = 1 AND d.closed_at > datetime('now', '-60 days')
    `),
    database.all<{ cnt: number; total: number | null }>(sql`
      SELECT COUNT(*) AS cnt, COALESCE(SUM(total_usd), 0) AS total
      FROM invoices WHERE status = 'overdue'
    `),
  ])

  const context = {
    banks: bankRows,
    reserves: reserveRows,
    commitments: commitments.map(c => ({
      ...c,
      monthlyEquivalent: c.cadence === 'annual' ? c.amount / 12
        : c.cadence === 'quarterly' ? c.amount / 3
        : c.amount,
    })),
    recentOutflowCount: recentOutflows.length,
    recentOutflowTotal: recentOutflows.reduce((s, t) => s + Math.abs(t.amount), 0),
    ytd: {
      revenue: Number(ytdInvoiceRows[0]?.total ?? 0),
      invoiceCount: Number(ytdInvoiceRows[0]?.cnt ?? 0),
    },
    thisMonth: {
      revenue: Number(monthInvoiceRows[0]?.total ?? 0),
      invoiceCount: Number(monthInvoiceRows[0]?.cnt ?? 0),
    },
    activeRetainers: activeMrrRows,
    wonDealsLast60d: Number(wonDealsRows[0]?.cnt ?? 0),
    overdue: {
      count: Number(overdueInvoiceRows[0]?.cnt ?? 0),
      total: Number(overdueInvoiceRows[0]?.total ?? 0),
    },
  }

  // Call Sonnet.
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  const systemPrompt = `You are the finance lieutenant for a small NZ-based web agency (Tahi Studio).
Your job: scan the agency's finance snapshot and surface 0-8 anomalies worth the owner's attention.

What counts as an anomaly:
- A recurring outflow with no recent bank hit (subscription you stopped using)
- Tax reserves missing or under-set against NZ corporate rate (28%)
- Pipeline drought: no won deals in 60 days + MRR isn't growing
- Cost-mix drift: subscriptions trending up vs the same month last year
- Single-client concentration > 50% of MRR (loss-risk)
- Overdue AR > 20% of MRR
- "Huh, this number doesn't add up" — invoice that paid for an inactive client, etc.

Don't flag normal operating state. Don't flag the same anomaly twice with different wording.
Don't suggest hiring — the owner runs the spend calculator for that themselves.

Output format: STRICT JSON array. No other text. Each item:
{
  "category": "subscriptions" | "tax" | "pipeline" | "concentration" | "ar" | "other",
  "severity": "info" | "watch" | "action",
  "title": "Short title (under 80 chars)",
  "detail": "1-2 sentence explanation, specific numbers, what to do next",
  "entityRef": "stable_key_for_dedup"
}

If no anomalies, return [].`

  let rawText: string
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(context, null, 2) }],
    })
    const block = response.content.find(b => b.type === 'text')
    rawText = block && 'text' in block ? block.text : '[]'
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await logCronRun(database, 'finance-anomaly-scan', 'error', Date.now() - t0, null, msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  // Parse — accept either a fenced ```json block or raw JSON.
  let findings: AnomalyFinding[] = []
  try {
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned) as unknown
    if (Array.isArray(parsed)) {
      findings = parsed.filter((f): f is AnomalyFinding =>
        !!f && typeof f === 'object'
        && typeof (f as AnomalyFinding).title === 'string'
        && typeof (f as AnomalyFinding).detail === 'string',
      ).slice(0, 8)
    }
  } catch {
    // Sonnet returned malformed JSON. Log + skip; next run will retry.
  }

  // Dedup against unresolved finance_anomaly notifications from the
  // last 30 days. Same entityRef + same title = skip.
  const recentNotifs = await database.all<{ entityId: string | null; title: string }>(sql`
    SELECT entity_id AS entityId, title FROM notifications
    WHERE event_type = 'finance_anomaly'
      AND created_at > datetime('now', '-30 days')
  `)
  const seen = new Set(recentNotifs.map(n => `${n.entityId ?? ''}|${n.title.toLowerCase()}`))

  const nowIso = new Date().toISOString()
  let inserted = 0
  for (const f of findings) {
    const key = `${f.entityRef ?? ''}|${f.title.toLowerCase()}`
    if (seen.has(key)) continue
    await database.insert(schema.notifications).values({
      id: crypto.randomUUID(),
      userId: recipient,
      userType: 'team_member',
      eventType: 'finance_anomaly',
      title: f.title,
      body: f.detail,
      entityType: 'finance_anomaly',
      entityId: f.entityRef ?? null,
      read: false,
      createdAt: nowIso,
    })
    inserted++
  }

  const summary = {
    findingsRaw: findings.length,
    inserted,
    deduped: findings.length - inserted,
  }
  await logCronRun(database, 'finance-anomaly-scan', 'success', Date.now() - t0, summary, null)
  return NextResponse.json(summary)
}
