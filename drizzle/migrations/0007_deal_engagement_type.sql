-- Add engagement model columns to deals table
-- D1 SQLite does not support IF NOT EXISTS on ALTER TABLE ADD COLUMN
ALTER TABLE deals ADD COLUMN engagement_type TEXT;
ALTER TABLE deals ADD COLUMN total_hours INTEGER;
ALTER TABLE deals ADD COLUMN hours_per_month INTEGER;
ALTER TABLE deals ADD COLUMN engagement_start_date TEXT;
ALTER TABLE deals ADD COLUMN engagement_end_date TEXT;
-- Nudge opt-out per deal
ALTER TABLE deals ADD COLUMN auto_nudges_disabled INTEGER DEFAULT 0;
