-- Add Stalled pipeline stage between Verbal Commit and Closed Won
-- First bump Closed Won and Closed Lost positions
UPDATE pipeline_stages SET position = 6 WHERE slug = 'closed_won';
UPDATE pipeline_stages SET position = 7 WHERE slug = 'closed_lost';

-- Insert Stalled stage at position 5
INSERT OR IGNORE INTO pipeline_stages (id, name, slug, probability, position, colour, is_default, is_closed_won, is_closed_lost, created_at)
VALUES (
  'a1b2c3d4-stll-4000-b000-stalledstage',
  'Stalled',
  'stalled',
  5,
  5,
  '#94a3b8',
  0,
  0,
  0,
  datetime('now')
);
