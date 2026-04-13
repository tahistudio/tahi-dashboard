-- Nudge email templates
CREATE TABLE IF NOT EXISTS nudge_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  category TEXT,
  is_default INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

-- Deal nudges (sent/scheduled emails)
CREATE TABLE IF NOT EXISTS deal_nudges (
  id TEXT PRIMARY KEY,
  deal_id TEXT REFERENCES deals(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES nudge_templates(id) ON DELETE SET NULL,
  contact_emails TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at TEXT,
  sent_at TEXT,
  trigger_rule TEXT,
  created_by_id TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_nudges_deal ON deal_nudges(deal_id);
CREATE INDEX IF NOT EXISTS idx_nudges_status ON deal_nudges(status);
