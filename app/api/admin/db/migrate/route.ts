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
