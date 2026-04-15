-- Monthly P&L snapshots from Xero
CREATE TABLE IF NOT EXISTS xero_pnl_snapshots (
  month_key text PRIMARY KEY NOT NULL,
  period_start text NOT NULL,
  period_end text NOT NULL,
  total_revenue real NOT NULL DEFAULT 0,
  total_cost_of_sales real NOT NULL DEFAULT 0,
  total_expenses real NOT NULL DEFAULT 0,
  gross_profit real NOT NULL DEFAULT 0,
  net_profit real NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'NZD',
  raw_json text,
  synced_at text NOT NULL
);

-- Per-month per-category expense breakdown
CREATE TABLE IF NOT EXISTS xero_expense_categories (
  id text PRIMARY KEY NOT NULL,
  month_key text NOT NULL,
  account_code text,
  account_name text NOT NULL,
  section text NOT NULL,
  amount real NOT NULL,
  currency text NOT NULL DEFAULT 'NZD',
  is_recurring integer DEFAULT 0,
  synced_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_xero_exp_month ON xero_expense_categories(month_key);
CREATE INDEX IF NOT EXISTS idx_xero_exp_category ON xero_expense_categories(account_name);

-- Bank balances snapshot (overwritten on each sync)
CREATE TABLE IF NOT EXISTS xero_bank_balances (
  account_id text PRIMARY KEY NOT NULL,
  account_name text NOT NULL,
  currency text NOT NULL DEFAULT 'NZD',
  balance real NOT NULL DEFAULT 0,
  as_of text NOT NULL,
  updated_at text NOT NULL
);
