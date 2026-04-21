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
  {
    name: '0015',
    description: 'commitment start/end dates + billing day of month',
    statements: [
      `ALTER TABLE expense_commitments ADD COLUMN start_date text`,
      `ALTER TABLE expense_commitments ADD COLUMN end_date text`,
      `ALTER TABLE expense_commitments ADD COLUMN billing_day_of_month integer`,
    ],
  },
  {
    name: '0016',
    description: 'org billing model + retainer dates + team member cost tracking',
    statements: [
      `ALTER TABLE organisations ADD COLUMN billing_model text DEFAULT 'none'`,
      `ALTER TABLE organisations ADD COLUMN retainer_start_date text`,
      `ALTER TABLE organisations ADD COLUMN retainer_end_date text`,
      `ALTER TABLE team_members ADD COLUMN hourly_cost_rate real`,
      `ALTER TABLE team_members ADD COLUMN compensation_type text DEFAULT 'annual'`,
      `ALTER TABLE team_members ADD COLUMN annual_salary real`,
    ],
  },
  {
    name: '0017',
    description: 'deal value range (min/max) + value_nzd range + activity metadata JSON',
    statements: [
      `ALTER TABLE deals ADD COLUMN value_min integer`,
      `ALTER TABLE deals ADD COLUMN value_max integer`,
      `ALTER TABLE deals ADD COLUMN value_min_nzd integer`,
      `ALTER TABLE deals ADD COLUMN value_max_nzd integer`,
      `ALTER TABLE activities ADD COLUMN metadata text`,
      `CREATE INDEX IF NOT EXISTS idx_activities_type ON activities(type)`,
      `CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at)`,
    ],
  },
  // Request V3 architecture is split across 0018 → 0021 so no single
  // invocation runs into D1's per-request timeout. Apply individually
  // (not via "all") : 0018, 0019, 0020, 0021.
  {
    name: '0018',
    description: 'Request V3 : new columns on requests (size, parent_request_id, sub_position, scope_flag_reason) + size backfill',
    statements: [
      `ALTER TABLE requests ADD COLUMN size text DEFAULT 'small'`,
      `ALTER TABLE requests ADD COLUMN parent_request_id text`,
      `ALTER TABLE requests ADD COLUMN sub_position integer`,
      `ALTER TABLE requests ADD COLUMN scope_flag_reason text`,
      `CREATE INDEX IF NOT EXISTS idx_requests_parent ON requests(parent_request_id)`,
      // Backfill size from legacy type. Idempotent : touches all 'small'
      // (default) rows and assigns 'large' where appropriate.
      `UPDATE requests
         SET size = CASE
           WHEN type IN ('small_task', 'bug_fix', 'content_update', 'consultation') THEN 'small'
           ELSE 'large'
         END
         WHERE size IS NULL OR size = 'small'`,
    ],
  },
  {
    name: '0019',
    description: 'time_entries supports scalar / range / live-tracked modes + task_id',
    statements: [
      `ALTER TABLE time_entries ADD COLUMN task_id text`,
      `ALTER TABLE time_entries ADD COLUMN started_at text`,
      `ALTER TABLE time_entries ADD COLUMN ended_at text`,
      `ALTER TABLE time_entries ADD COLUMN source text NOT NULL DEFAULT 'manual'`,
      `CREATE INDEX IF NOT EXISTS idx_time_request ON time_entries(request_id)`,
      `CREATE INDEX IF NOT EXISTS idx_time_task ON time_entries(task_id)`,
    ],
  },
  {
    name: '0020',
    description: 'Request V3 : request_participants table (multi-assignee / PM / follower model) + backfill from requests.assignee_id',
    statements: [
      `CREATE TABLE IF NOT EXISTS request_participants (
        id text PRIMARY KEY NOT NULL,
        request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        participant_id text NOT NULL,
        participant_type text NOT NULL,
        role text NOT NULL,
        added_by_id text,
        added_by_type text,
        added_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        removed_at text
      )`,
      `CREATE INDEX IF NOT EXISTS idx_req_part_request ON request_participants(request_id)`,
      `CREATE INDEX IF NOT EXISTS idx_req_part_participant ON request_participants(participant_id, participant_type)`,
      `CREATE INDEX IF NOT EXISTS idx_req_part_role ON request_participants(role)`,
      // Backfill existing requests.assignee_id rows into participants.
      // UUID generated via SQLite randomblob trick.  NOT EXISTS makes it safe to re-run.
      `INSERT INTO request_participants (id, request_id, participant_id, participant_type, role, added_at)
         SELECT
           lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
           r.id, r.assignee_id, 'team_member', 'assignee', r.created_at
         FROM requests r
         WHERE r.assignee_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM request_participants rp
             WHERE rp.request_id = r.id
               AND rp.participant_id = r.assignee_id
               AND rp.participant_type = 'team_member'
               AND rp.role = 'assignee'
           )`,
    ],
  },
  {
    name: '0021',
    description: 'Request V3 : request_reads (per-user unread tracking) + active_timers (live time tracker, one per user)',
    statements: [
      `CREATE TABLE IF NOT EXISTS request_reads (
        id text PRIMARY KEY NOT NULL,
        request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
        user_id text NOT NULL,
        user_type text NOT NULL,
        last_read_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_req_reads_request ON request_reads(request_id)`,
      `CREATE INDEX IF NOT EXISTS idx_req_reads_user ON request_reads(user_id, user_type)`,
      `CREATE TABLE IF NOT EXISTS active_timers (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        request_id text REFERENCES requests(id) ON DELETE CASCADE,
        task_id text,
        started_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        paused_at text,
        paused_seconds integer NOT NULL DEFAULT 0,
        last_ping_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        notes text
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_timer_per_user ON active_timers(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_active_timers_request ON active_timers(request_id)`,
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

  const results: Array<{ name: string; status: 'applied' | 'error'; error?: string; statementCount?: number; skippedAlreadyExists?: number }> = []

  for (const m of targets) {
    let applied = 0
    let skippedAlreadyExists = 0
    try {
      for (const stmt of m.statements) {
        try {
          await drizzle.run(sql.raw(stmt))
          applied++
        } catch (stmtErr) {
          const msg = stmtErr instanceof Error ? stmtErr.message : String(stmtErr)
          // SQLite: "duplicate column name" means the ALTER already ran.
          // Treat as success so the migration is idempotent.
          if (msg.includes('duplicate column name') || msg.includes('already exists')) {
            skippedAlreadyExists++
          } else {
            throw stmtErr
          }
        }
      }
      results.push({ name: m.name, status: 'applied', statementCount: applied, skippedAlreadyExists })
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

/**
 * GET without args → list available migrations.
 * GET with ?run=0018 (or any name) → apply that single migration (same as
 * POST body). Useful so admins can run migrations by visiting a URL in
 * the browser without needing devtools / curl.
 *
 *   GET /api/admin/db/migrate
 *   GET /api/admin/db/migrate?run=0018
 *   GET /api/admin/db/migrate?run=0019
 *   ...
 */
export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const run = searchParams.get('run')

  if (!run) {
    return NextResponse.json({
      migrations: MIGRATIONS.map(m => ({
        name: m.name,
        description: m.description,
        statementCount: m.statements.length,
      })),
      hint: 'Append ?run=<name> to execute a single migration. For V3 schema apply 0018, 0019, 0020, 0021 one at a time.',
    })
  }

  const targets = run === 'all' ? MIGRATIONS : MIGRATIONS.filter(m => m.name === run)
  if (targets.length === 0) {
    return NextResponse.json({
      error: `Unknown migration "${run}". Known: ${MIGRATIONS.map(m => m.name).join(', ')} or "all".`,
    }, { status: 400 })
  }

  const drizzle = (await db()) as D1
  const results: Array<{ name: string; status: 'applied' | 'error'; error?: string; statementCount?: number; skippedAlreadyExists?: number }> = []

  for (const m of targets) {
    let applied = 0
    let skippedAlreadyExists = 0
    try {
      for (const stmt of m.statements) {
        try {
          await drizzle.run(sql.raw(stmt))
          applied++
        } catch (stmtErr) {
          const msg = stmtErr instanceof Error ? stmtErr.message : String(stmtErr)
          if (msg.includes('duplicate column name') || msg.includes('already exists')) {
            skippedAlreadyExists++
          } else {
            throw stmtErr
          }
        }
      }
      results.push({ name: m.name, status: 'applied', statementCount: applied, skippedAlreadyExists })
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
