-- Migration 0063: blog_backfill_log
--
-- Audit table for Phase I · Slice 6.5 — the one-time (resumable) backfill
-- of all existing Tahi blog posts with FAQs + Key Takeaways + Schema +
-- AI Summary Prompt + hreflang block. One row per item touched per run.
--
-- runId groups all per-run items so the dashboard can list recent runs
-- and re-run only the failures. `fieldsWritten` is a JSON array of the
-- Webflow CMS slugs we successfully PATCH'd, so a partially-applied row
-- still tells us exactly what landed.
--
-- Strictly additive: no existing tables touched. Idempotent via
-- IF NOT EXISTS so re-running the migration is a no-op.

CREATE TABLE IF NOT EXISTS blog_backfill_log (
  id TEXT PRIMARY KEY NOT NULL,
  webflow_item_id TEXT NOT NULL,
  post_url TEXT NOT NULL,
  post_title TEXT,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  fields_written TEXT,
  error_message TEXT,
  faqs_generated INTEGER,
  takeaways_generated INTEGER,
  schema_chars_written INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_blog_backfill_run ON blog_backfill_log(run_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_blog_backfill_status ON blog_backfill_log(status);
