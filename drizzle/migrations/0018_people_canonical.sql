-- Migration 0018: People (canonical person identity) + person_id on leads/contacts
--
-- Companion to 0017. Introduces a single source-of-truth identity
-- table for any human in the CRM — leads, contacts, affiliates,
-- subscribers, gmail thread participants all eventually link via
-- person_id. Same human, many roles, one place to look up.
--
-- New role tables (affiliates, subscribers — Phase C / D) will
-- declare person_id on creation. Existing contacts get a nullable
-- person_id now; a backfill script will later match-by-email to
-- populate.
--
-- Production note: SQLite can't add a column with an inline FK
-- constraint via ALTER TABLE. Drizzle declares the FK at the app
-- level only; D1 doesn't enforce it but queries + relations still
-- work. If ALTER TABLE errors with "duplicate column name" because
-- prod already has the column, mark this migration applied:
--   wrangler d1 execute --command "INSERT INTO d1_migrations
--   (name, applied_at) VALUES ('0018_people_canonical.sql',
--   strftime('%Y-%m-%dT%H:%M:%SZ','now'))"

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
