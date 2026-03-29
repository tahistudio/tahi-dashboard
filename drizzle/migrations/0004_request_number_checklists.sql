-- Add request_number and checklists columns to requests table
ALTER TABLE requests ADD COLUMN request_number INTEGER;
ALTER TABLE requests ADD COLUMN checklists TEXT DEFAULT '[]';
CREATE INDEX IF NOT EXISTS idx_requests_number ON requests (request_number);
