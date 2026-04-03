CREATE TABLE `mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`mentioned_id` text NOT NULL,
	`mentioned_type` text NOT NULL,
	`mentioned_by_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mentions_mentioned` ON `mentions` (`mentioned_id`);--> statement-breakpoint
CREATE INDEX `idx_mentions_entity` ON `mentions` (`entity_id`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_task_deps_task` ON `task_dependencies` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_task_deps_depends` ON `task_dependencies` (`depends_on_task_id`);--> statement-breakpoint
CREATE TABLE `task_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`category` text,
	`description` text,
	`default_priority` text DEFAULT 'standard' NOT NULL,
	`subtasks` text DEFAULT '[]',
	`estimated_hours` real,
	`created_by_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `deals` ADD `won_source` text;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `billing_interval` text DEFAULT 'monthly';--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `included_addons` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `discount_percent` real;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `billing_country` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `track_id` text REFERENCES tracks(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `position` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `request_id` text REFERENCES requests(id);--> statement-breakpoint
CREATE INDEX `idx_tasks_track` ON `tasks` (`track_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_request` ON `tasks` (`request_id`);--> statement-breakpoint
ALTER TABLE `team_members` ADD `roles` text DEFAULT '[]';
