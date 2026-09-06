-- Migration 0093: the external-id spine for the ManyRequests import.
--
-- A scan of all 114 tables found NO external-id column anywhere: no
-- manyrequests_id, no external_id, no source_id. Until these columns exist the
-- import has no idempotency key, and a second run duplicates all 329 requests,
-- all 44 contacts and all 20 invoices. This file is therefore step 0 of the
-- import and nothing else in it may run first.
--
-- WHAT IS ADDED
--
--   <table>.manyrequests_id            text, nullable, on ten tables
--     The ManyRequests primary key, stored as TEXT even where the source id is
--     an integer, because two of the ten are not integers: an invoice is keyed
--     on its number ("INV-2025000024") and a comment has no id at all on the
--     API shape, so lib/import/manyrequests/map.ts derives a stable composite
--     ("mr:comment:<requestId>:<createdAt>:<authorSlug>"). One column type for
--     all ten keeps the upsert generic.
--
--     UNIQUE on nine of the ten. SQLite treats NULLs as DISTINCT in a unique
--     index, so every pre-existing row (all of which are NULL here) coexists
--     happily and only imported rows are constrained. invoice_items is the
--     exception and gets a PLAIN index: ManyRequests exposes no line-item id,
--     so its key is positional ("<invoiceNumber>#<lineIndex>") and a source
--     invoice whose lines are reordered upstream would collide. Line items are
--     reconciled against their parent instead: each position is upserted and
--     an IMPORTED line that no longer exists upstream is deleted, so the ledger
--     row keeps adding up without a unique constraint the key cannot honour.
--
--   organisations.mr_hours_remaining / mr_hours_purchased   real, nullable
--     The retainer hour bank, which has no other home in D1: tracks and
--     custom_small_tracks / custom_large_tracks are a different model
--     entirely. This is real commercial state (Elevate 98.13 of 100 remaining,
--     Glasswall 15 of 21, Greyhive 20 of 102, Dante Media 10 of 48, and the
--     overdrawn Physitrack -22.65, BCS -18.9, Stride -10.25, Blank Space
--     -6.57, ISG -1.51, Tahi Studio -2) and it vanishes silently without these
--     two columns. Nothing reads them yet; the import writes them so the
--     numbers survive the cutover and a later slice can surface them.
--
--   subscriptions.mr_service_name / hours_per_period / credits_per_period /
--   billed_contact_id
--     A ManyRequests subscription carries a service NAME ("Glasswall Custom
--     Retainer", "Elevate custom hourly"), an hours-per-period allowance, a
--     credits allowance and the member it is billed to. D1's subscriptions row
--     has none of those: plan_type is a five-value vocabulary
--     (none|launch|maintain|scale|hourly) that cannot hold "Glasswall Custom
--     Retainer" without inventing a mapping, and there is no hours column at
--     all. mr_service_name keeps the source label verbatim next to whatever
--     plan_type the mapper picks, so the guess is always auditable against the
--     original. billed_contact_id is a plain text column with no REFERENCES
--     clause on purpose: Glasswall's live retainer is billed to "Suzy Toth", a
--     SOFT-DELETED ManyRequests client, and a foreign key would refuse the row
--     that records that fact.
--
-- WHAT IS NOT ADDED. No new value is written to invoices.source by this file;
-- the column is plain text with no CHECK constraint, so the importer writing
-- 'manyrequests' alongside the existing manual / stripe / xero needs no schema
-- change. db/schema.ts documents the fourth value in its comment.
--
-- ALTER TABLE ADD COLUMN cannot use IF NOT EXISTS in SQLite; the runtime
-- runner (app/api/admin/db/migrate) swallows the "duplicate column name" error
-- so re-running is safe. Every CREATE INDEX is IF NOT EXISTS. Nothing is
-- backfilled and no existing row is touched, so this is purely additive.
--
-- MERGE ORDER, NOT OPTIONAL. Apply this to staging and then production D1
-- BEFORE the code that references the columns is deployed, not after. Drizzle
-- expands a bare .select() into an explicit column list from db/schema.ts, so
-- from the moment the new schema ships every bare select breaks on a database
-- without these columns ("no such column: manyrequests_id" -> 500). The one in
-- the tree today is the admin data export
-- (app/api/admin/danger/export/route.ts), which bare-selects organisations,
-- contacts, team_members, requests, invoices, invoice_items, subscriptions and
-- messages: eight of the ten tables below. The columns are additive and
-- nullable, so applying them AHEAD of the deploy is harmless to the running
-- code, which is why the order is this way round and not the other.
--
-- The runtime runner (POST /api/admin/db/migrate) cannot go first: the "0093"
-- entry lives in app/api/admin/db/migrate/route.ts and does not exist until
-- that deploy lands, so calling it beforehand answers 400 Unknown migration.
-- Apply the file directly with wrangler instead. wrangler.json carries both
-- database ids (staging b91cd27f, production 3bfa4848), so the names below
-- resolve without any extra flags:
--   1. wrangler d1 execute tahi-db-staging --remote --file=drizzle/migrations/0093_manyrequests_external_ids.sql
--   2. deploy, then POST /api/admin/import/manyrequests {"dryRun":true} and
--      check every entity reports a plan instead of a "no such column" error
--   3. wrangler d1 execute tahi-db --remote --file=drizzle/migrations/0093_manyrequests_external_ids.sql
--   4. approve the production deploy, then run the same dry run
--
-- POST /api/admin/db/migrate {"name":"0093"} is the after-the-fact fallback,
-- usable once the deploy that carries the entry is live.

-- 1. The ten external-id columns.
ALTER TABLE organisations ADD COLUMN manyrequests_id text;
ALTER TABLE contacts ADD COLUMN manyrequests_id text;
ALTER TABLE team_members ADD COLUMN manyrequests_id text;
ALTER TABLE requests ADD COLUMN manyrequests_id text;
ALTER TABLE messages ADD COLUMN manyrequests_id text;
ALTER TABLE invoices ADD COLUMN manyrequests_id text;
ALTER TABLE invoice_items ADD COLUMN manyrequests_id text;
ALTER TABLE subscriptions ADD COLUMN manyrequests_id text;
ALTER TABLE brands ADD COLUMN manyrequests_id text;
ALTER TABLE services ADD COLUMN manyrequests_id text;

-- 2. The retainer hour bank, which has no other home.
ALTER TABLE organisations ADD COLUMN mr_hours_remaining real;
ALTER TABLE organisations ADD COLUMN mr_hours_purchased real;

-- 3. The four subscription columns a ManyRequests plan needs.
ALTER TABLE subscriptions ADD COLUMN mr_service_name text;
ALTER TABLE subscriptions ADD COLUMN hours_per_period real;
ALTER TABLE subscriptions ADD COLUMN credits_per_period real;
ALTER TABLE subscriptions ADD COLUMN billed_contact_id text;

-- 4. The idempotency keys. UNIQUE everywhere the source id is exposed and
--    stable; a plain index on invoice_items, whose key is positional.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orgs_manyrequests ON organisations(manyrequests_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_manyrequests ON contacts(manyrequests_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_manyrequests ON team_members(manyrequests_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_manyrequests ON requests(manyrequests_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_manyrequests ON messages(manyrequests_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_manyrequests ON invoices(manyrequests_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_manyrequests ON subscriptions(manyrequests_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_brands_manyrequests ON brands(manyrequests_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_manyrequests ON services(manyrequests_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_manyrequests ON invoice_items(manyrequests_id);
