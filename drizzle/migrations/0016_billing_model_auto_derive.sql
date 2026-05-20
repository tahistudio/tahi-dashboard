-- Migration 0016: Billing model + retainer dates + manual override flags
--
-- Why: lets the system derive an org's billing model (retainer | hourly | project | none)
-- and its retainer window from observable signals (Stripe subs, invoices, time entries),
-- with a per-field "is manual" flag so user overrides are respected and not steamrolled
-- by the next auto-derivation pass.
--
-- Production note: the first three columns may already exist on prod (added via MCP
-- before this migration was formalised). If `wrangler d1 migrations apply` errors with
-- "duplicate column name", the column is already there — mark this migration as applied
-- via `wrangler d1 execute --command "INSERT INTO d1_migrations (name, applied_at) VALUES
-- ('0016_billing_model_auto_derive.sql', strftime('%Y-%m-%dT%H:%M:%SZ','now'))"` and re-run.

ALTER TABLE organisations ADD COLUMN billing_model TEXT;
--> statement-breakpoint
ALTER TABLE organisations ADD COLUMN retainer_start_date TEXT;
--> statement-breakpoint
ALTER TABLE organisations ADD COLUMN retainer_end_date TEXT;
--> statement-breakpoint
ALTER TABLE organisations ADD COLUMN billing_model_is_manual INTEGER DEFAULT 0;
--> statement-breakpoint
ALTER TABLE organisations ADD COLUMN retainer_dates_is_manual INTEGER DEFAULT 0;
--> statement-breakpoint
ALTER TABLE organisations ADD COLUMN custom_mrr_is_manual INTEGER DEFAULT 0;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_orgs_billing_model ON organisations(billing_model);
