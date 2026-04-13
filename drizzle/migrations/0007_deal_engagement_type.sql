-- Add engagement model columns to deals table
ALTER TABLE deals ADD COLUMN IF NOT EXISTS engagement_type TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS total_hours INTEGER;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS hours_per_month INTEGER;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS engagement_start_date TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS engagement_end_date TEXT;
