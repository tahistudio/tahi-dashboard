-- Migration 0038: People (canonical person identity) + person_id on leads/contacts/team_members
--
-- Companion to 0037. Introduces a single source-of-truth identity
-- table for any human in the CRM — leads, contacts, team members,
-- affiliates, subscribers, gmail thread participants all eventually
-- link via person_id. Same human, many roles, one place to look up.
--
-- New role tables (affiliates, subscribers — Phase C / D) will
-- declare person_id on creation. Existing contacts + team_members
-- get a nullable person_id now; a backfill script later matches by
-- email to populate.
--
-- Numbered 0038 to match the inline-runner numbering in
-- app/api/admin/db/migrate/route.ts (which authoritatively applies
-- migrations on Webflow Cloud). Files are kept for documentation +
-- local Drizzle workflows.

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  avatar_url TEXT,
  linkedin_url TEXT,
  enrichment_data TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_people_email ON people(email);
--> statement-breakpoint
ALTER TABLE leads ADD COLUMN person_id TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_leads_person ON leads(person_id);
--> statement-breakpoint
ALTER TABLE contacts ADD COLUMN person_id TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_contacts_person ON contacts(person_id);
--> statement-breakpoint
ALTER TABLE team_members ADD COLUMN person_id TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_team_members_person ON team_members(person_id);
