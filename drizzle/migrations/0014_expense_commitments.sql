CREATE TABLE IF NOT EXISTS expense_commitments (
  id text PRIMARY KEY NOT NULL,
  name text NOT NULL,
  vendor text,
  amount real NOT NULL,
  currency text NOT NULL DEFAULT 'NZD',
  cadence text NOT NULL DEFAULT 'monthly',
  category text NOT NULL DEFAULT 'other',
  next_due_date text,
  active integer DEFAULT 1,
  notes text,
  linked_xero_account text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commitments_active ON expense_commitments(active);
CREATE INDEX IF NOT EXISTS idx_commitments_category ON expense_commitments(category);
