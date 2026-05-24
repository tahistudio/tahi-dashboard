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
  // (not via "all") : 0018, 0019, 0020, 0021, 0022.
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
  {
    name: '0022',
    description: 'Fix active_timers.user_id FK — it was pointing at team_members(id) but user_id is actually a Clerk user ID (same as request_reads.user_id). Rebuild without the FK.',
    statements: [
      // SQLite can't DROP a FOREIGN KEY, so we rebuild the table. If the
      // table doesn't exist yet (fresh db), these guards all no-op and
      // migration 0021 handled creation. If it does exist with the bad
      // FK, we rename → create fresh → copy rows → drop rename → recreate
      // indexes.
      `ALTER TABLE active_timers RENAME TO active_timers_old`,
      `CREATE TABLE active_timers (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        request_id text REFERENCES requests(id) ON DELETE CASCADE,
        task_id text,
        started_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        paused_at text,
        paused_seconds integer NOT NULL DEFAULT 0,
        last_ping_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        notes text
      )`,
      `INSERT INTO active_timers (id, user_id, request_id, task_id, started_at, paused_at, paused_seconds, last_ping_at, notes)
       SELECT id, user_id, request_id, task_id, started_at, paused_at, paused_seconds, last_ping_at, notes FROM active_timers_old`,
      `DROP TABLE active_timers_old`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_timer_per_user ON active_timers(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_active_timers_request ON active_timers(request_id)`,
    ],
  },
  {
    name: '0023',
    description: 'Deal value model: split single `value` into upfront (project portion) + monthly (retainer portion) + recurring start date. Backfill from existing value/engagement_type so reports keep working.',
    statements: [
      // New columns. Idempotent via the ADD COLUMN duplicate-name catch.
      `ALTER TABLE deals ADD COLUMN upfront_value integer`,
      `ALTER TABLE deals ADD COLUMN upfront_value_nzd integer`,
      `ALTER TABLE deals ADD COLUMN monthly_value integer`,
      `ALTER TABLE deals ADD COLUMN monthly_value_nzd integer`,
      // Optional explicit start date for the recurring portion. When null,
      // resolution rules at compute time fall back to engagement_end_date,
      // then to closed_at / expected_close_date.
      `ALTER TABLE deals ADD COLUMN recurring_start_date text`,

      // Backfill — best-effort split of the legacy single `value` field:
      //   * engagement_type = 'retainer' → value was monthly; copy to monthly_value
      //   * everything else (project / null) → value was upfront; copy to upfront_value
      // The user can correct individual deals after rollout.
      // Only backfill rows that haven't been touched yet (NULL guard) so re-runs are safe.
      `UPDATE deals
         SET monthly_value = COALESCE(monthly_value, value),
             monthly_value_nzd = COALESCE(monthly_value_nzd, value_nzd)
         WHERE engagement_type = 'retainer'
           AND monthly_value IS NULL`,
      `UPDATE deals
         SET upfront_value = COALESCE(upfront_value, value),
             upfront_value_nzd = COALESCE(upfront_value_nzd, value_nzd)
         WHERE (engagement_type IS NULL OR engagement_type = 'project')
           AND upfront_value IS NULL`,
      // Defaults for the other half of the split — so every row has both
      // numbers populated rather than NULL on one side.
      `UPDATE deals SET upfront_value = 0, upfront_value_nzd = 0
         WHERE engagement_type = 'retainer' AND upfront_value IS NULL`,
      `UPDATE deals SET monthly_value = 0, monthly_value_nzd = 0
         WHERE (engagement_type IS NULL OR engagement_type = 'project') AND monthly_value IS NULL`,

      `CREATE INDEX IF NOT EXISTS idx_deals_monthly_value ON deals(monthly_value)`,
    ],
  },
  {
    name: '0024',
    description: 'Project schedules (gantt) — phase 1 of proposal/contract suite. Adds project_schedules + schedule_rows tables with public-share-token support.',
    statements: [
      `CREATE TABLE IF NOT EXISTS project_schedules (
        id text PRIMARY KEY NOT NULL,
        org_id text REFERENCES organisations(id) ON DELETE CASCADE,
        deal_id text REFERENCES deals(id) ON DELETE SET NULL,
        title text NOT NULL,
        subtitle text,
        prepared_for text,
        prepared_by text,
        effective_date text,
        target_launch_date text,
        number_of_weeks integer NOT NULL DEFAULT 12,
        overview_html text,
        status text NOT NULL DEFAULT 'draft',
        public_share_token text,
        public_shared_at text,
        created_by_id text NOT NULL,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_schedules_org ON project_schedules(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_schedules_deal ON project_schedules(deal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_schedules_token ON project_schedules(public_share_token)`,
      `CREATE TABLE IF NOT EXISTS schedule_rows (
        id text PRIMARY KEY NOT NULL,
        schedule_id text NOT NULL REFERENCES project_schedules(id) ON DELETE CASCADE,
        row_type text NOT NULL,
        label text NOT NULL,
        owner text,
        start_week integer,
        end_week integer,
        risk_flag integer NOT NULL DEFAULT 0,
        position integer NOT NULL DEFAULT 0,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_schedule_rows_schedule ON schedule_rows(schedule_id)`,
      `CREATE INDEX IF NOT EXISTS idx_schedule_rows_position ON schedule_rows(schedule_id, position)`,
    ],
  },
  {
    name: '0025',
    description: 'Share-view analytics — track who viewed public-shared schedules / proposals / contracts, when, for how long, and which pages.',
    statements: [
      `CREATE TABLE IF NOT EXISTS share_view_events (
        id text PRIMARY KEY NOT NULL,
        resource_type text NOT NULL,
        resource_id text NOT NULL,
        share_token text NOT NULL,
        session_id text NOT NULL,
        viewer_name text,
        viewer_email text,
        viewer_ip_hash text,
        viewer_country text,
        viewer_ua text,
        referrer text,
        pages_viewed text,
        started_at text NOT NULL,
        ended_at text,
        duration_ms integer,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_share_view_events_resource ON share_view_events(resource_type, resource_id)`,
      `CREATE INDEX IF NOT EXISTS idx_share_view_events_session ON share_view_events(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_share_view_events_started_at ON share_view_events(started_at)`,
    ],
  },
  {
    name: '0026',
    description: 'Schedules become sectioned: project_schedules now have N ordered scheduleSections (overview | gantt | risk_register | raci_matrix | text). Existing schedule_rows are backfilled to a default gantt section per schedule. Risk/RACI/text content is stored as JSON in section.data.',
    statements: [
      `CREATE TABLE IF NOT EXISTS schedule_sections (
        id text PRIMARY KEY NOT NULL,
        schedule_id text NOT NULL REFERENCES project_schedules(id) ON DELETE CASCADE,
        type text NOT NULL,
        title text,
        subtitle text,
        start_week integer,
        end_week integer,
        data text,
        position integer NOT NULL DEFAULT 0,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_schedule_sections_schedule ON schedule_sections(schedule_id)`,
      `CREATE INDEX IF NOT EXISTS idx_schedule_sections_position ON schedule_sections(schedule_id, position)`,

      // Add section_id to schedule_rows. Tolerate the duplicate-column
      // error so re-runs are idempotent.
      `ALTER TABLE schedule_rows ADD COLUMN section_id text`,
      `CREATE INDEX IF NOT EXISTS idx_schedule_rows_section ON schedule_rows(section_id)`,

      // ── Backfill ──
      // Every existing schedule gets exactly one default 'gantt' section
      // titled "Project schedule". UUID generated via SQLite's randomblob
      // trick (matches migration 0020's request_participants backfill).
      // Idempotent: NOT EXISTS guards re-runs.
      `INSERT INTO schedule_sections (id, schedule_id, type, title, position, created_at, updated_at)
         SELECT
           lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
           s.id, 'gantt', 'Project schedule', 0,
           strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
           strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         FROM project_schedules s
         WHERE NOT EXISTS (
           SELECT 1 FROM schedule_sections WHERE schedule_id = s.id
         )`,
      // Assign every row without a section to its schedule's default section.
      `UPDATE schedule_rows
         SET section_id = (
           SELECT id FROM schedule_sections
            WHERE schedule_id = schedule_rows.schedule_id
            ORDER BY position ASC LIMIT 1
         )
         WHERE section_id IS NULL`,
    ],
  },
  {
    name: '0027',
    description: 'Phase 2: proposals — premium 16:9 slide-deck client proposals with 1-3 variants (Good/Better/Best), public token link, accept/decline audit trail. Reuses sections + share-tracking primitives.',
    statements: [
      `CREATE TABLE IF NOT EXISTS proposals (
        id text PRIMARY KEY NOT NULL,
        org_id text REFERENCES organisations(id) ON DELETE CASCADE,
        deal_id text REFERENCES deals(id) ON DELETE SET NULL,
        title text NOT NULL,
        subtitle text,
        prepared_for text,
        prepared_by text,
        effective_date text,
        expires_at text,
        status text NOT NULL DEFAULT 'draft',
        public_share_token text,
        public_shared_at text,
        decided_at text,
        decided_variant_id text,
        created_by_id text NOT NULL,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_proposals_org ON proposals(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_proposals_deal ON proposals(deal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_proposals_token ON proposals(public_share_token)`,
      `CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status)`,

      `CREATE TABLE IF NOT EXISTS proposal_sections (
        id text PRIMARY KEY NOT NULL,
        proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
        type text NOT NULL,
        title text,
        subtitle text,
        data text,
        position integer NOT NULL DEFAULT 0,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_proposal_sections_proposal ON proposal_sections(proposal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_proposal_sections_position ON proposal_sections(proposal_id, position)`,

      `CREATE TABLE IF NOT EXISTS proposal_variants (
        id text PRIMARY KEY NOT NULL,
        proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
        name text NOT NULL,
        tagline text,
        one_off_amount integer NOT NULL DEFAULT 0,
        monthly_amount integer NOT NULL DEFAULT 0,
        currency text NOT NULL DEFAULT 'NZD',
        scope_html text,
        pricing_notes_html text,
        timeline_schedule_id text REFERENCES project_schedules(id) ON DELETE SET NULL,
        cta_label text,
        is_featured integer NOT NULL DEFAULT 0,
        position integer NOT NULL DEFAULT 0,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_proposal_variants_proposal ON proposal_variants(proposal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_proposal_variants_position ON proposal_variants(proposal_id, position)`,

      `CREATE TABLE IF NOT EXISTS proposal_acceptances (
        id text PRIMARY KEY NOT NULL,
        proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
        variant_id text REFERENCES proposal_variants(id) ON DELETE SET NULL,
        status text NOT NULL,
        acceptor_name text,
        acceptor_email text,
        acceptor_role text,
        comment text,
        acceptor_ip_hash text,
        acceptor_country text,
        acceptor_ua text,
        accepted_at text NOT NULL,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_proposal_acceptances_proposal ON proposal_acceptances(proposal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_proposal_acceptances_status ON proposal_acceptances(status)`,
    ],
  },
  {
    name: '0028',
    description: 'Phase 3: contracts + e-signature. contract_templates (boilerplate with {{variables}}), contract_documents (signed instances with public token), contract_signers (per-document signers with order), contract_signatures (canvas signature data URL + sha256 chain hash for tamper evidence).',
    statements: [
      `CREATE TABLE IF NOT EXISTS contract_templates (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        type text NOT NULL,
        body_html text NOT NULL,
        variable_defs text,
        is_default integer NOT NULL DEFAULT 0,
        description text,
        created_by_id text NOT NULL,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_contract_templates_type ON contract_templates(type)`,

      `CREATE TABLE IF NOT EXISTS contract_documents (
        id text PRIMARY KEY NOT NULL,
        org_id text REFERENCES organisations(id) ON DELETE CASCADE,
        deal_id text REFERENCES deals(id) ON DELETE SET NULL,
        proposal_id text REFERENCES proposals(id) ON DELETE SET NULL,
        template_id text REFERENCES contract_templates(id) ON DELETE SET NULL,
        type text NOT NULL,
        name text NOT NULL,
        status text NOT NULL DEFAULT 'draft',
        body_html text NOT NULL,
        variable_values text,
        public_share_token text,
        public_shared_at text,
        signed_storage_key text,
        sent_at text,
        signed_at text,
        expires_at text,
        final_hash text,
        created_by_id text NOT NULL,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_contract_documents_org ON contract_documents(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_contract_documents_deal ON contract_documents(deal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_contract_documents_token ON contract_documents(public_share_token)`,
      `CREATE INDEX IF NOT EXISTS idx_contract_documents_status ON contract_documents(status)`,

      `CREATE TABLE IF NOT EXISTS contract_signers (
        id text PRIMARY KEY NOT NULL,
        contract_id text NOT NULL REFERENCES contract_documents(id) ON DELETE CASCADE,
        role text NOT NULL,
        name text NOT NULL,
        email text NOT NULL,
        position integer NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'pending',
        signed_at text,
        signature_id text,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_contract_signers_contract ON contract_signers(contract_id)`,
      `CREATE INDEX IF NOT EXISTS idx_contract_signers_email ON contract_signers(email)`,

      `CREATE TABLE IF NOT EXISTS contract_signatures (
        id text PRIMARY KEY NOT NULL,
        contract_id text NOT NULL REFERENCES contract_documents(id) ON DELETE CASCADE,
        signer_id text NOT NULL REFERENCES contract_signers(id) ON DELETE CASCADE,
        signature_data_url text NOT NULL,
        ip_hash text,
        user_agent text,
        country text,
        chain_hash text NOT NULL,
        signed_at text NOT NULL,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_contract_signatures_contract ON contract_signatures(contract_id)`,
      `CREATE INDEX IF NOT EXISTS idx_contract_signatures_signer ON contract_signatures(signer_id)`,
    ],
  },
  {
    name: '0029',
    description: 'Phase 5 cross-linking: project_schedules.proposal_id (a schedule can attach to a proposal as the delivery Gantt). Idempotent — D1 supports IF NOT EXISTS on ADD COLUMN via try/catch on duplicates only, so we use a defensive ALTER and let it no-op if already added.',
    statements: [
      // SQLite doesn't support IF NOT EXISTS on ADD COLUMN. Wrap in a no-op
      // SELECT first so we can detect the column without throwing.
      `ALTER TABLE project_schedules ADD COLUMN proposal_id text REFERENCES proposals(id) ON DELETE SET NULL`,
      `CREATE INDEX IF NOT EXISTS idx_project_schedules_proposal ON project_schedules(proposal_id)`,
    ],
  },
  {
    name: '0030',
    description: 'Phase 7 proposal templates: reusable proposal blueprints. snapshot column stores the frozen sections + variants payload. Instantiated into fresh rows at create time.',
    statements: [
      `CREATE TABLE IF NOT EXISTS proposal_templates (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        description text,
        snapshot text NOT NULL,
        variable_defs text,
        created_by_id text NOT NULL,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
    ],
  },
  {
    name: '0031',
    description: 'Phase 8a deal model: lost_reason (structured enum), next_action_label + next_action_due_at (single concrete next step). Idempotent — duplicate-column errors caught upstream.',
    statements: [
      `ALTER TABLE deals ADD COLUMN lost_reason text`,
      `ALTER TABLE deals ADD COLUMN next_action_label text`,
      `ALTER TABLE deals ADD COLUMN next_action_due_at text`,
    ],
  },
  {
    name: '0032',
    description: 'Phase 9 proposal draft/publish model: published_snapshot (JSON) + published_at. Public viewer reads from the snapshot so admin edits do not leak until Publish.',
    statements: [
      `ALTER TABLE proposals ADD COLUMN published_snapshot text`,
      `ALTER TABLE proposals ADD COLUMN published_at text`,
    ],
  },
  {
    name: '0033',
    description: 'Phase 9 round 2: proposals.cover_theme — light or dark cover. Independent of per-section themes (those live on section.data.theme).',
    statements: [
      `ALTER TABLE proposals ADD COLUMN cover_theme text DEFAULT 'light'`,
    ],
  },
  {
    name: '0034',
    description: 'Schedule templates: reusable schedule blueprints. snapshot column stores frozen sections + rows + meta. Mirrors the proposal template pattern. Instantiated into fresh schedule_sections + schedule_rows at create time.',
    statements: [
      `CREATE TABLE IF NOT EXISTS schedule_templates (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        description text,
        snapshot text NOT NULL,
        is_default integer NOT NULL DEFAULT 0,
        created_by_id text NOT NULL,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
    ],
  },
  {
    name: '0035',
    description: 'Project calculator: stores sized estimates per deal. Inputs + outputs JSON columns capture the snapshot so a calc can be replayed without re-running the math.',
    statements: [
      `CREATE TABLE IF NOT EXISTS project_calculations (
        id text PRIMARY KEY NOT NULL,
        deal_id text,
        org_id text,
        name text NOT NULL,
        is_active integer NOT NULL DEFAULT 1,
        inputs text NOT NULL,
        outputs text NOT NULL,
        linked_artefact_ref text,
        created_by_id text NOT NULL,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_project_calculations_deal ON project_calculations(deal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_project_calculations_org ON project_calculations(org_id)`,
    ],
  },
  {
    name: '0036',
    description: 'Add org_id to active_timers so a timer can be tracked against a client directly (not just a request or task). Exactly one of request_id / task_id / org_id is required at the API layer.',
    statements: [
      `ALTER TABLE active_timers ADD COLUMN org_id text REFERENCES organisations(id) ON DELETE CASCADE`,
      `CREATE INDEX IF NOT EXISTS idx_active_timers_org ON active_timers(org_id)`,
    ],
  },
  {
    name: '0037',
    description: 'Phase A · 1: leads table + activities.lead_id. Pre-qualification prospects live separately from deals; activities table stays unified by sharing the same stream via lead_id.',
    statements: [
      `CREATE TABLE IF NOT EXISTS leads (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        email text,
        phone text,
        company text,
        job_title text,
        website text,
        source text NOT NULL DEFAULT 'manual',
        source_detail text,
        affiliate_code text,
        brief text,
        estimated_value integer,
        currency text NOT NULL DEFAULT 'NZD',
        status text NOT NULL DEFAULT 'new',
        archive_reason text,
        owner_id text REFERENCES team_members(id) ON DELETE SET NULL,
        promoted_deal_id text REFERENCES deals(id) ON DELETE SET NULL,
        promoted_at text,
        ai_score integer,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)`,
      `CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id)`,
      `CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`,
      `CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source)`,
      `ALTER TABLE activities ADD COLUMN lead_id text`,
      `CREATE INDEX IF NOT EXISTS idx_activities_lead ON activities(lead_id)`,
    ],
  },
  {
    name: '0038',
    description: 'Phase A · 1.5: people (canonical person identity) + person_id on leads/contacts/team_members. One human, many roles. Email is the matching key on lookup-or-create.',
    statements: [
      `CREATE TABLE IF NOT EXISTS people (
        id text PRIMARY KEY NOT NULL,
        full_name text NOT NULL,
        email text,
        phone text,
        avatar_url text,
        linkedin_url text,
        enrichment_data text,
        notes text,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_people_email ON people(email)`,
      `ALTER TABLE leads ADD COLUMN person_id text`,
      `CREATE INDEX IF NOT EXISTS idx_leads_person ON leads(person_id)`,
      `ALTER TABLE contacts ADD COLUMN person_id text`,
      `CREATE INDEX IF NOT EXISTS idx_contacts_person ON contacts(person_id)`,
      `ALTER TABLE team_members ADD COLUMN person_id text`,
      `CREATE INDEX IF NOT EXISTS idx_team_members_person ON team_members(person_id)`,
    ],
  },
  {
    name: '0045',
    description: 'Files: add message_id (nullable) + idx_files_message so composer attachments are tied to a specific message, not just the request. Lets POST /api/admin/requests/[id]/messages accept attachmentFileIds[] and tie those files to the new message id.',
    statements: [
      `ALTER TABLE files ADD COLUMN message_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_files_message ON files(message_id)`,
    ],
  },
  {
    name: '0044',
    description: 'Polymorphic discovery_calls: add request_id, task_id, org_id (nullable) so a call can attach to any parent (lead / deal / request / task / org). Unblocks "multiple meetings per deal", "kickoff calls per request", "client check-in calls" etc — same UI component renders on every parent page.',
    statements: [
      `ALTER TABLE discovery_calls ADD COLUMN request_id TEXT`,
      `ALTER TABLE discovery_calls ADD COLUMN task_id TEXT`,
      `ALTER TABLE discovery_calls ADD COLUMN org_id TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_discovery_calls_request ON discovery_calls(request_id)`,
      `CREATE INDEX IF NOT EXISTS idx_discovery_calls_task ON discovery_calls(task_id)`,
      `CREATE INDEX IF NOT EXISTS idx_discovery_calls_org ON discovery_calls(org_id)`,
    ],
  },
  {
    name: '0043',
    description: 'Phase B · 7 discovery_calls table. Pre-call prep + Google Meet linkage + Gemini transcript + outcome tagging + scope/budget/timeline capture. Linked via lead_id (always) and optionally deal_id (after promotion) so a single call row tracks the conversation from "qualifying" through "won".',
    statements: [
      `CREATE TABLE IF NOT EXISTS discovery_calls (
        id TEXT PRIMARY KEY NOT NULL,
        lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
        deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
        google_calendar_event_id TEXT,
        google_meet_url TEXT,
        title TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        attendees TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'scheduled',
        transcript TEXT,
        transcript_source TEXT,
        summary TEXT,
        outcome TEXT,
        outcome_notes TEXT,
        scope_notes TEXT,
        budget_min INTEGER,
        budget_max INTEGER,
        budget_currency TEXT,
        timeline TEXT,
        created_by_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_discovery_calls_lead ON discovery_calls(lead_id)`,
      `CREATE INDEX IF NOT EXISTS idx_discovery_calls_deal ON discovery_calls(deal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_discovery_calls_scheduled ON discovery_calls(scheduled_at)`,
      `CREATE INDEX IF NOT EXISTS idx_discovery_calls_status ON discovery_calls(status)`,
      `CREATE INDEX IF NOT EXISTS idx_discovery_calls_gcal ON discovery_calls(google_calendar_event_id)`,
    ],
  },
  {
    name: '0042',
    description: 'Phase B · 6 lead AI columns: ai_score_reason, ai_summary, ai_sources (JSON), ai_questions (JSON), ai_signals (JSON object — structured deal-sizing signals), enriched_at, last_ai_run_at, ai_tokens_spent, enrich_reprompt_suppressed. Plus settings seeds: leads.defaultLeadOwnerId (best-effort lookup for "Liam Miller") and leads.discoveryQuestionsTemplate (3 always-ask questions covering brand discovery + project goals + current solution).',
    statements: [
      `ALTER TABLE leads ADD COLUMN ai_score_reason TEXT`,
      `ALTER TABLE leads ADD COLUMN ai_summary TEXT`,
      `ALTER TABLE leads ADD COLUMN ai_sources TEXT DEFAULT '[]'`,
      `ALTER TABLE leads ADD COLUMN ai_questions TEXT DEFAULT '[]'`,
      `ALTER TABLE leads ADD COLUMN enriched_at TEXT`,
      `ALTER TABLE leads ADD COLUMN last_ai_run_at TEXT`,
      `ALTER TABLE leads ADD COLUMN ai_tokens_spent INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE leads ADD COLUMN enrich_reprompt_suppressed INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE leads ADD COLUMN ai_signals TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_leads_ai_run ON leads(last_ai_run_at)`,
      // Seed default lead owner — best-effort match on "Liam Miller". If
      // no team-member row matches, the setting stays absent and the
      // POST /api/admin/leads route just falls through to the caller-
      // team-member fallback (which is fine for UI-created leads).
      `INSERT OR IGNORE INTO settings (key, value, updated_at)
        SELECT 'leads.defaultLeadOwnerId', id, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM team_members
        WHERE lower(name) = 'liam miller' OR lower(name) LIKE 'liam %'
        LIMIT 1`,
      // Seed the 3 always-ask discovery questions. Covers brand
      // discovery (why us), competitive context (what isn't working
      // now) and project goals (success in 6 months). JSON array of
      // strings so the UI can render + edit.
      `INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
        ('leads.discoveryQuestionsTemplate',
         '["What made you reach out to Tahi specifically?","How are you currently solving this, and what isn''t working?","What does success look like for this project in 6 months?"]',
         strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
    ],
  },
  {
    name: '0041',
    description: 'Permissions seed: 5 system roles + permission catalogue (resource × action) + role_permission defaults with sensible scope filters. Idempotent via INSERT OR IGNORE.',
    statements: [
      // 1. System roles
      `INSERT OR IGNORE INTO roles (id, name, description, is_system, created_at, updated_at) VALUES
        ('role-super-admin', 'super_admin', 'Full access across every resource. Reserved for org owners.', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('role-admin', 'admin', 'Most actions on most resources. Cannot delete team members, settings or integrations.', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('role-project-manager', 'project_manager', 'Runs accounts and projects. View/create/edit across CRM + read on billing artefacts.', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('role-task-handler', 'task_handler', 'Executes assigned work. Own tasks, comment on requests, log time.', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('role-viewer', 'viewer', 'Read-only across the dashboard.', 1, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,

      // 2. Base resource × action permissions (108 rows).
      //    id format = "resource.action" so role_permissions can
      //    reference them stably across re-runs.
      //    SQLite doesn't support `(VALUES ...) AS t(col)` column
      //    aliasing — use CTEs instead.
      `WITH
        resources(name) AS (
          VALUES ('leads'), ('deals'), ('contacts'), ('people'), ('organisations'),
                 ('requests'), ('tasks'), ('messages'), ('files'), ('time_entries'),
                 ('invoices'), ('contracts'), ('proposals'), ('schedules'), ('calls'),
                 ('activities'), ('docs'), ('subscribers'), ('campaigns'), ('affiliates'),
                 ('reports'), ('sales_analytics'), ('settings'), ('team'), ('integrations'),
                 ('calculator'), ('announcements')
        ),
        actions(name) AS (
          VALUES ('view'), ('create'), ('edit'), ('delete')
        )
      INSERT OR IGNORE INTO permissions (id, resource, action, description, created_at)
      SELECT
        r.name || '.' || a.name,
        r.name,
        a.name,
        a.name || ' ' || r.name,
        strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
      FROM resources r
      CROSS JOIN actions a`,

      // 3. Extra action permissions (resource-specific verbs).
      `INSERT OR IGNORE INTO permissions (id, resource, action, description, created_at) VALUES
        ('leads.promote', 'leads', 'promote', 'Promote a lead to a deal', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('leads.archive', 'leads', 'archive', 'Archive a lead', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('deals.assign', 'deals', 'assign', 'Assign owner to a deal', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('deals.archive', 'deals', 'archive', 'Archive a deal', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('requests.assign', 'requests', 'assign', 'Assign team member to a request', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('requests.comment', 'requests', 'comment', 'Comment on a request thread', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('tasks.assign', 'tasks', 'assign', 'Assign team member to a task', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('tasks.comment', 'tasks', 'comment', 'Comment on a task', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('proposals.share', 'proposals', 'share', 'Share a proposal via public token', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('proposals.publish', 'proposals', 'publish', 'Publish a proposal snapshot', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('contracts.share', 'contracts', 'share', 'Share a contract for signature', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('contracts.sign', 'contracts', 'sign', 'Counter-sign a contract', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('contracts.send', 'contracts', 'send', 'Email a contract to a signer', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('invoices.send', 'invoices', 'send', 'Email an invoice to the client', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('invoices.export', 'invoices', 'export', 'Export invoices to CSV / Xero', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('campaigns.send', 'campaigns', 'send', 'Send a marketing campaign', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('reports.export', 'reports', 'export', 'Export report data', strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ('affiliates.payout', 'affiliates', 'payout', 'Record an affiliate commission payout', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,

      // 4. super_admin: every permission, scope='all'.
      `INSERT OR IGNORE INTO role_permissions (id, role_id, permission_id, scope_type, created_at)
        SELECT
          'role-super-admin:' || p.id,
          'role-super-admin',
          p.id,
          'all',
          strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM permissions p`,

      // 5. admin: every permission EXCEPT team.delete, settings.delete,
      //    integrations.delete. Scope='all'.
      `INSERT OR IGNORE INTO role_permissions (id, role_id, permission_id, scope_type, created_at)
        SELECT
          'role-admin:' || p.id,
          'role-admin',
          p.id,
          'all',
          strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM permissions p
        WHERE NOT (p.resource = 'team' AND p.action = 'delete')
          AND NOT (p.resource = 'settings' AND p.action = 'delete')
          AND NOT (p.resource = 'integrations' AND p.action = 'delete')`,

      // 6. project_manager: CRM operations + read on billing artefacts.
      `INSERT OR IGNORE INTO role_permissions (id, role_id, permission_id, scope_type, created_at)
        SELECT
          'role-project-manager:' || p.id,
          'role-project-manager',
          p.id,
          'all',
          strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM permissions p
        WHERE
          (p.resource = 'leads' AND p.action IN ('view', 'create', 'edit', 'promote', 'archive'))
          OR (p.resource = 'deals' AND p.action IN ('view', 'create', 'edit', 'assign', 'archive'))
          OR (p.resource = 'requests' AND p.action IN ('view', 'create', 'edit', 'assign', 'comment'))
          OR (p.resource = 'tasks' AND p.action IN ('view', 'create', 'edit', 'assign', 'comment'))
          OR (p.resource = 'calls' AND p.action IN ('view', 'create', 'edit'))
          OR (p.resource = 'contacts' AND p.action IN ('view', 'create', 'edit'))
          OR (p.resource = 'organisations' AND p.action IN ('view', 'create', 'edit'))
          OR (p.resource = 'people' AND p.action IN ('view', 'edit'))
          OR (p.resource = 'activities' AND p.action IN ('view', 'create'))
          OR (p.resource = 'messages' AND p.action IN ('view', 'create'))
          OR (p.resource = 'docs' AND p.action IN ('view', 'create', 'edit'))
          OR (p.resource = 'time_entries' AND p.action IN ('view', 'create', 'edit'))
          OR (p.resource = 'invoices' AND p.action = 'view')
          OR (p.resource = 'contracts' AND p.action = 'view')
          OR (p.resource = 'proposals' AND p.action IN ('view', 'create', 'edit'))
          OR (p.resource = 'schedules' AND p.action IN ('view', 'create', 'edit'))
          OR (p.resource = 'reports' AND p.action = 'view')
          OR (p.resource = 'sales_analytics' AND p.action = 'view')
          OR (p.resource = 'team' AND p.action = 'view')
          OR (p.resource = 'calculator' AND p.action IN ('view', 'create', 'edit'))`,

      // 7. task_handler: own tasks + comment on requests + log time.
      //    scope='own' on tasks.view/edit. Everything else scope='all'.
      `INSERT OR IGNORE INTO role_permissions (id, role_id, permission_id, scope_type, created_at)
        SELECT
          'role-task-handler:' || p.id,
          'role-task-handler',
          p.id,
          CASE WHEN p.resource = 'tasks' AND p.action IN ('view', 'edit') THEN 'own' ELSE 'all' END,
          strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM permissions p
        WHERE
          (p.resource = 'tasks' AND p.action IN ('view', 'edit', 'comment'))
          OR (p.resource = 'requests' AND p.action IN ('view', 'comment'))
          OR (p.resource = 'time_entries' AND p.action IN ('view', 'create'))
          OR (p.resource = 'messages' AND p.action IN ('view', 'create'))
          OR (p.resource = 'docs' AND p.action = 'view')
          OR (p.resource = 'activities' AND p.action = 'view')`,

      // 8. viewer: view-only across everything.
      `INSERT OR IGNORE INTO role_permissions (id, role_id, permission_id, scope_type, created_at)
        SELECT
          'role-viewer:' || p.id,
          'role-viewer',
          p.id,
          'all',
          strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        FROM permissions p
        WHERE p.action = 'view'`,
    ],
  },
  {
    name: '0040',
    description: 'Pipeline triage (SQL-based equivalent of /api/admin/leads/triage-pipeline). Moves Lead-stage deals + Stalled-no-engagement deals into the leads table. Idempotent — re-running finds no candidates because matching deals were deleted on the first run, and source_detail is keyed on deal id as a belt-and-braces.',
    statements: [
      // 1. Backfill people rows for deal contacts that don't already
      //    have a matching person by email. Idempotent via NOT EXISTS.
      `INSERT INTO people (id, full_name, email, phone, created_at, updated_at)
         SELECT DISTINCT
           lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
           c.name,
           c.email,
           NULL,
           strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
           strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         FROM contacts c
         JOIN deal_contacts dc ON dc.contact_id = c.id
         JOIN deals d ON d.id = dc.deal_id
         JOIN pipeline_stages ps ON ps.id = d.stage_id
         WHERE
           c.email IS NOT NULL AND c.email != ''
           AND NOT EXISTS (SELECT 1 FROM people p WHERE lower(p.email) = lower(c.email))
           AND (
             lower(ps.name) = 'lead'
             OR (
               lower(ps.name) = 'stalled'
               AND NOT EXISTS (SELECT 1 FROM proposals WHERE deal_id = d.id)
               AND NOT EXISTS (SELECT 1 FROM contract_documents WHERE deal_id = d.id)
             )
           )`,

      // 2. Backfill contacts.person_id from the people table by email.
      `UPDATE contacts
         SET person_id = (SELECT id FROM people WHERE lower(email) = lower(contacts.email) LIMIT 1)
         WHERE person_id IS NULL
           AND email IS NOT NULL AND email != ''
           AND EXISTS (SELECT 1 FROM people WHERE lower(email) = lower(contacts.email))`,

      // 3. Insert leads from each candidate deal. Idempotent — re-running
      //    won't re-insert because the deal will be gone after step 5.
      //    source_detail encodes the original deal id so we never
      //    duplicate even if step 5 fails and step 3 reruns.
      `INSERT INTO leads (id, person_id, name, email, phone, company, source, source_detail, brief, estimated_value, currency, status, created_at, updated_at)
         SELECT
           lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
           c.person_id,
           COALESCE(c.name, o.name, d.title),
           c.email,
           NULL,
           o.name,
           COALESCE(d.source, 'manual'),
           'Demoted from pipeline (was ' || ps.name || ' stage) · deal:' || d.id,
           d.notes,
           COALESCE(d.upfront_value, d.monthly_value, d.value),
           d.currency,
           CASE WHEN lower(ps.name) = 'lead' THEN 'new' ELSE 'nurturing' END,
           strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
           strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         FROM deals d
         JOIN pipeline_stages ps ON ps.id = d.stage_id
         LEFT JOIN deal_contacts pdc ON pdc.deal_id = d.id AND pdc.id = (
           SELECT id FROM deal_contacts WHERE deal_id = d.id ORDER BY id LIMIT 1
         )
         LEFT JOIN contacts c ON c.id = pdc.contact_id
         LEFT JOIN organisations o ON o.id = d.org_id
         WHERE
           (lower(ps.name) = 'lead' OR (
             lower(ps.name) = 'stalled'
             AND NOT EXISTS (SELECT 1 FROM proposals WHERE deal_id = d.id)
             AND NOT EXISTS (SELECT 1 FROM contract_documents WHERE deal_id = d.id)
           ))
           AND NOT EXISTS (SELECT 1 FROM leads l WHERE l.source_detail LIKE '%deal:' || d.id)`,

      // 4. Stamp a lead_demoted activity for every new triage-lead.
      `INSERT INTO activities (id, type, title, description, lead_id, created_by_id, created_at, updated_at)
         SELECT
           lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
           'lead_demoted',
           l.source_detail,
           CASE WHEN l.status = 'nurturing'
                THEN 'No proposal, no contract, no real engagement - moved to leads for nurture.'
                ELSE 'Was sitting at the top of the funnel - moved to leads where it belongs.' END,
           l.id,
           'system',
           strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
           strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
         FROM leads l
         WHERE l.source_detail LIKE 'Demoted from pipeline%'
           AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.lead_id = l.id AND a.type = 'lead_demoted')`,

      // 5. Delete the candidate deals. FK cascade removes deal_contacts
      //    and any deal-scoped activities.
      `DELETE FROM deals
         WHERE id IN (
           SELECT d.id FROM deals d
           JOIN pipeline_stages ps ON ps.id = d.stage_id
           WHERE
             lower(ps.name) = 'lead'
             OR (
               lower(ps.name) = 'stalled'
               AND NOT EXISTS (SELECT 1 FROM proposals WHERE deal_id = d.id)
               AND NOT EXISTS (SELECT 1 FROM contract_documents WHERE deal_id = d.id)
             )
         )`,
    ],
  },
  {
    name: '0039',
    description: 'Phase A · 0: granular permissions foundation (RBAC + ABAC). roles + permissions + role_permissions (with scope filters) + team_member_roles + field_restrictions. Strictly additive — no existing tables touched. Enforcement is a runtime layer that rolls out per feature.',
    statements: [
      `CREATE TABLE IF NOT EXISTS roles (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL UNIQUE,
        description text,
        is_system integer NOT NULL DEFAULT 0,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE TABLE IF NOT EXISTS permissions (
        id text PRIMARY KEY NOT NULL,
        resource text NOT NULL,
        action text NOT NULL,
        description text,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(resource, action)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_permissions_resource ON permissions(resource)`,
      `CREATE TABLE IF NOT EXISTS role_permissions (
        id text PRIMARY KEY NOT NULL,
        role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id text NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        scope_type text NOT NULL DEFAULT 'all',
        scope_value text,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(role_id, permission_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id)`,
      `CREATE INDEX IF NOT EXISTS idx_role_permissions_perm ON role_permissions(permission_id)`,
      `CREATE TABLE IF NOT EXISTS team_member_roles (
        id text PRIMARY KEY NOT NULL,
        team_member_id text NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
        role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        started_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        ended_at text,
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_team_member_roles_member ON team_member_roles(team_member_id)`,
      `CREATE INDEX IF NOT EXISTS idx_team_member_roles_role ON team_member_roles(role_id)`,
      `CREATE INDEX IF NOT EXISTS idx_team_member_roles_active ON team_member_roles(ended_at)`,
      `CREATE TABLE IF NOT EXISTS field_restrictions (
        id text PRIMARY KEY NOT NULL,
        role_id text NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        resource text NOT NULL,
        field text NOT NULL,
        action text NOT NULL DEFAULT 'view',
        created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
        UNIQUE(role_id, resource, field, action)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_field_restrictions_role ON field_restrictions(role_id)`,
      `CREATE INDEX IF NOT EXISTS idx_field_restrictions_resource ON field_restrictions(resource)`,
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
      hint: 'Append ?run=<name> to execute a single migration. For V3 schema apply 0018, 0019, 0020, 0021, then 0022 (fixes timer FK bug). One at a time.',
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
