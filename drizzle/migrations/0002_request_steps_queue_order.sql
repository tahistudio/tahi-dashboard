-- Add queueOrder to requests for per-track-type queue positioning
ALTER TABLE `requests` ADD `queue_order` integer DEFAULT 0;

--> statement-breakpoint

-- Nested steps table (ClickUp-style)
CREATE TABLE `request_steps` (
  `id` text PRIMARY KEY NOT NULL,
  `request_id` text NOT NULL,
  `parent_step_id` text,
  `title` text NOT NULL,
  `description` text,
  `completed` integer DEFAULT 0,
  `completed_at` text,
  `order_index` integer DEFAULT 0,
  `assignee_id` text,
  `created_by_id` text,
  `created_by_type` text,
  `created_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  `updated_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON DELETE cascade,
  FOREIGN KEY (`assignee_id`) REFERENCES `team_members`(`id`)
);

--> statement-breakpoint
CREATE INDEX `idx_steps_request` ON `request_steps` (`request_id`);

--> statement-breakpoint
CREATE INDEX `idx_steps_parent` ON `request_steps` (`parent_step_id`);
