-- Migration 0017: Leads table + activities.lead_id
--
-- Phase A · 1-2 of the lifecycle roadmap (WORKFLOWS.md).
--
-- Adds the `leads` table so pre-qualification prospects can live in
-- the dashboard without polluting pipeline metrics. Once qualified,
-- a lead promotes to a deal (lead.promoted_deal_id is set + status
-- flips to 'promoted'). Keeps the unified `activities` table as the
-- single stream by adding a `lead_id` column there.
--
-- Production note: ALTER TABLE ADD COLUMN errors if the column
-- already exists. If `wrangler d1 migrations apply` errors with
-- "duplicate column name", mark this migration applied via:
--   wrangler d1 execute --command "INSERT INTO d1_migrations
--   (name, applied_at) VALUES ('0017_leads_table.sql',
--   strftime('%Y-%m-%dT%H:%M:%SZ','now'))"

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  job_title TEXT,
  website TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_detail TEXT,
  affiliate_code TEXT,
  brief TEXT,
  estimated_value INTEGER,
  currency TEXT NOT NULL DEFAULT 'NZD',
  status TEXT NOT NULL DEFAULT 'new',
  archive_reason TEXT,
  owner_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
  promoted_deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
  promoted_at TEXT,
  ai_score INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_leads_owner ON leads(owner_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
--> statement-breakpoint
ALTER TABLE activities ADD COLUMN lead_id TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_activities_lead ON activities(lead_id);
