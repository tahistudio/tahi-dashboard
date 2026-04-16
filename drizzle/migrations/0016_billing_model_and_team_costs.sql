-- Org billing model + retainer lifecycle dates
ALTER TABLE organisations ADD COLUMN billing_model text DEFAULT 'none';
ALTER TABLE organisations ADD COLUMN retainer_start_date text;
ALTER TABLE organisations ADD COLUMN retainer_end_date text;

-- Team member cost tracking
ALTER TABLE team_members ADD COLUMN hourly_cost_rate real;
ALTER TABLE team_members ADD COLUMN compensation_type text DEFAULT 'annual';
ALTER TABLE team_members ADD COLUMN annual_salary real;
