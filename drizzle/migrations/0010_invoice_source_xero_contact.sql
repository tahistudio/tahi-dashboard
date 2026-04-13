-- Add source field to invoices (manual, xero, stripe)
ALTER TABLE invoices ADD COLUMN source TEXT DEFAULT 'manual';

-- Backfill existing invoices based on linked IDs
UPDATE invoices SET source = 'xero' WHERE xero_invoice_id IS NOT NULL AND source = 'manual';
UPDATE invoices SET source = 'stripe' WHERE stripe_invoice_id IS NOT NULL AND source = 'manual';

-- Add Xero contact ID to organisations for bidirectional sync
ALTER TABLE organisations ADD COLUMN xero_contact_id TEXT;
