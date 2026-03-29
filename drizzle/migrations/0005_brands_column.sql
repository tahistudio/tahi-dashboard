-- Add brands JSON column to organisations table
ALTER TABLE organisations ADD COLUMN brands TEXT DEFAULT '[]';
