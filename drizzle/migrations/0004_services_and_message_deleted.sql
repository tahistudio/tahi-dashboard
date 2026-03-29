-- Services table
CREATE TABLE IF NOT EXISTS `services` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `price` integer NOT NULL DEFAULT 0,
  `currency` text NOT NULL DEFAULT 'NZD',
  `is_recurring` integer NOT NULL DEFAULT 0,
  `recurring_interval` text,
  `show_in_catalog` integer NOT NULL DEFAULT 1,
  `category` text,
  `created_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  `updated_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Add deletedAt column to messages table
ALTER TABLE `messages` ADD COLUMN `deleted_at` text;
