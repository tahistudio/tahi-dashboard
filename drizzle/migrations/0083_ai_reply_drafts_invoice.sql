-- Migration 0083: Overdue-invoice chase drafts on ai_reply_drafts
--
-- The overdue-invoice chase-draft feature reuses the existing
-- ai_reply_drafts table (proven lead draft-reply triad: pending draft ->
-- human edits -> explicit send). Exactly one of lead_id / invoice_id is
-- populated per row. This adds the nullable invoice_id column plus an index
-- so a pending chase draft can be resolved per invoice.
--
-- ALTER TABLE ADD COLUMN cannot use IF NOT EXISTS in SQLite; the runtime
-- runner (app/api/admin/db/migrate) swallows the "duplicate column name"
-- error so re-running is safe. The index CREATE is IF NOT EXISTS.
ALTER TABLE ai_reply_drafts ADD COLUMN invoice_id text;
CREATE INDEX IF NOT EXISTS idx_ai_reply_drafts_invoice ON ai_reply_drafts(invoice_id);
