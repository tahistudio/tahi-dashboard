-- Migration 0084: Settings redesign column adds
--
-- The pixel-perfect Settings rebuild (imported Tahi Settings design) needs a
-- handful of additive columns so every section persists real data:
--   request_forms:  description / audience / sla shown in the form editor
--   task_templates: per-client overrides (org_id) + default assignee
--   organisations:  client-editable brand accent colour
--   announcements:  composer emoji + call-to-action button
--   contacts:       phone captured on the client profile card
--   team_members:   phone captured on the team profile card
--
-- ALTER TABLE ADD COLUMN cannot use IF NOT EXISTS in SQLite; the runtime
-- runner (app/api/admin/db/migrate) swallows the "duplicate column name"
-- error so re-running is safe. Index CREATEs are IF NOT EXISTS.
ALTER TABLE request_forms ADD COLUMN description text;
ALTER TABLE request_forms ADD COLUMN audience text NOT NULL DEFAULT 'all_clients';
ALTER TABLE request_forms ADD COLUMN sla text;
ALTER TABLE task_templates ADD COLUMN org_id text;
ALTER TABLE task_templates ADD COLUMN default_assignee text;
CREATE INDEX IF NOT EXISTS idx_task_templates_org ON task_templates(org_id);
ALTER TABLE organisations ADD COLUMN accent_colour text;
ALTER TABLE announcements ADD COLUMN emoji text;
ALTER TABLE announcements ADD COLUMN cta_label text;
ALTER TABLE announcements ADD COLUMN cta_url text;
ALTER TABLE contacts ADD COLUMN phone text;
ALTER TABLE team_members ADD COLUMN phone text;
