import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sql } from 'drizzle-orm'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * One-shot migration runner.
 *
 * Cloudflare Workers don't have filesystem access, so wrangler-driven
 * migrations need the production database_id (which Webflow Cloud
 * doesn't expose in a copyable way). This endpoint ships known
 * migrations as inline SQL constants so they can be applied via a
 * simple admin POST.
 *
 * All statements use IF NOT EXISTS so re-running is safe.
 *
 * Usage:
 *   POST /api/admin/db/migrate { "name": "0012" }
 *   POST /api/admin/db/migrate { "name": "0013" }
 *   POST /api/admin/db/migrate { "name": "all" }   — applies every known migration
 *
 * To add a new migration, append it to MIGRATIONS below.
 */

interface Migration {
  name: string
  description: string
  statements: string[]
}

const MIGRATIONS: Migration[] = [
  {
    name: '0012',
    description: 'client_costs table for gross margin tracking',
    statements: [
      `CREATE TABLE IF NOT EXISTS client_costs (
        id text PRIMARY KEY NOT NULL,
        org_id text NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
        description text NOT NULL,
        amount real NOT NULL,
        currency text NOT NULL DEFAULT 'NZD',
        category text NOT NULL DEFAULT 'other',
        date text NOT NULL,
        recurring integer DEFAULT 0,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_client_costs_org_id ON client_costs(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_client_costs_date ON client_costs(date)`,
    ],
  },
  {
    name: '0013',
    description: 'Xero P&L snapshots, expense categories, bank balances',
    statements: [
      `CREATE TABLE IF NOT EXISTS xero_pnl_snapshots (
        month_key text PRIMARY KEY NOT NULL,
        period_start text NOT NULL,
        period_end text NOT NULL,
        total_revenue real NOT NULL DEFAULT 0,
        total_cost_of_sales real NOT NULL DEFAULT 0,
        total_expenses real NOT NULL DEFAULT 0,
        gross_profit real NOT NULL DEFAULT 0,
        net_profit real NOT NULL DEFAULT 0,
        currency text NOT NULL DEFAULT 'NZD',
        raw_json text,
        synced_at text NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS xero_expense_categories (
        id text PRIMARY KEY NOT NULL,
        month_key text NOT NULL,
        account_code text,
        account_name text NOT NULL,
        section text NOT NULL,
        amount real NOT NULL,
        currency text NOT NULL DEFAULT 'NZD',
        is_recurring integer DEFAULT 0,
        synced_at text NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_xero_exp_month ON xero_expense_categories(month_key)`,
      `CREATE INDEX IF NOT EXISTS idx_xero_exp_category ON xero_expense_categories(account_name)`,
      `CREATE TABLE IF NOT EXISTS xero_bank_balances (
        account_id text PRIMARY KEY NOT NULL,
        account_name text NOT NULL,
        currency text NOT NULL DEFAULT 'NZD',
        balance real NOT NULL DEFAULT 0,
        as_of text NOT NULL,
        updated_at text NOT NULL
      )`,
    ],
  },
  {
    name: '0014',
    description: 'expense_commitments table for fixed-cost cash flow projection',
    statements: [
      `CREATE TABLE IF NOT EXISTS expense_commitments (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        vendor text,
        amount real NOT NULL,
        currency text NOT NULL DEFAULT 'NZD',
        cadence text NOT NULL DEFAULT 'monthly',
        category text NOT NULL DEFAULT 'other',
        next_due_date text,
        active integer DEFAULT 1,
        notes text,
        linked_xero_account text,
        created_at text NOT NULL,
        updated_at text NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_commitments_active ON expense_commitments(active)`,
      `CREATE INDEX IF NOT EXISTS idx_commitments_category ON expense_commitments(category)`,
    ],
  },
]

export async function POST(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = (await req.json().catch(() => ({}))) as { name?: string }
  const target = body.name ?? 'all'

  const drizzle = (await db()) as D1

  const targets = target === 'all' ? MIGRATIONS : MIGRATIONS.filter(m => m.name === target)
  if (targets.length === 0) {
    return NextResponse.json({
      error: `Unknown migration "${target}". Known: ${MIGRATIONS.map(m => m.name).join(', ')} or "all".`,
    }, { status: 400 })
  }

  const results: Array<{ name: string; status: 'applied' | 'error'; error?: string; statementCount?: number }> = []

  for (const m of targets) {
    let applied = 0
    try {
      for (const stmt of m.statements) {
        await drizzle.run(sql.raw(stmt))
        applied++
      }
      results.push({ name: m.name, status: 'applied', statementCount: applied })
    } catch (err) {
      results.push({
        name: m.name,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
        statementCount: applied,
      })
    }
  }

  return NextResponse.json({ results })
}

// GET returns the list of available migrations without running anything
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({
    migrations: MIGRATIONS.map(m => ({
      name: m.name,
      description: m.description,
      statementCount: m.statements.length,
    })),
  })
}
