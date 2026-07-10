-- Migration 0085: financial_snapshots
--
-- Monthly point-in-time metric history so the overview can show real
-- trends and honest month-over-month deltas. The dashboard recomputes
-- cash / MRR / owed / runway live and the bank syncs overwrite the
-- underlying balances each run, so nothing is otherwise kept for "last
-- month". This table freezes those figures once per month.
--
-- Keyed on month_key (YYYY-MM, UTC). The daily snapshot cron upserts the
-- CURRENT month's row; when the month rolls over its last write becomes
-- the frozen month-end value. Flow metrics (revenue / expenses / profit)
-- stay in xero_pnl_snapshots.
--
-- source = 'cron' is a full monthly snapshot; 'backfill' is a cash-only
-- reconstruction from the Airwallex transaction ledger for past months.
CREATE TABLE IF NOT EXISTS financial_snapshots (
  month_key text PRIMARY KEY NOT NULL,
  cash_nzd real,
  owed_nzd real,
  mrr_nzd real,
  active_clients integer,
  burn_nzd real,
  runway_months real,
  source text NOT NULL DEFAULT 'cron',
  captured_at text NOT NULL,
  created_at text NOT NULL
);
