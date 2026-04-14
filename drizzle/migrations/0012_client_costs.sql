CREATE TABLE IF NOT EXISTS client_costs (
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
);

CREATE INDEX IF NOT EXISTS idx_client_costs_org_id ON client_costs(org_id);
CREATE INDEX IF NOT EXISTS idx_client_costs_date ON client_costs(date);
