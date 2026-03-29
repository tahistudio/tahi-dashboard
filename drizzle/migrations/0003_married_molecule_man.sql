CREATE TABLE IF NOT EXISTS `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`deal_id` text,
	`org_id` text,
	`contact_id` text,
	`created_by_id` text NOT NULL,
	`scheduled_at` text,
	`completed_at` text,
	`duration_minutes` integer,
	`outcome` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_activities_deal` ON `activities` (`deal_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_activities_org` ON `activities` (`org_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_activities_contact` ON `activities` (`contact_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `deal_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`deal_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`role` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `deals` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`org_id` text,
	`stage_id` text NOT NULL,
	`owner_id` text,
	`value` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'NZD' NOT NULL,
	`value_nzd` integer DEFAULT 0 NOT NULL,
	`source` text,
	`estimated_hours_per_week` integer DEFAULT 0,
	`expected_close_date` text,
	`closed_at` text,
	`close_reason` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stage_id`) REFERENCES `pipeline_stages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_deals_org` ON `deals` (`org_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_deals_stage` ON `deals` (`stage_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_deals_owner` ON `deals` (`owner_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pipeline_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`probability` integer DEFAULT 0 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`colour` text,
	`is_default` integer DEFAULT 0 NOT NULL,
	`is_closed_won` integer DEFAULT 0 NOT NULL,
	`is_closed_lost` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `planned_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`department` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`description` text,
	`reports_to_id` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`reports_to_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'NZD' NOT NULL,
	`is_recurring` integer DEFAULT 0 NOT NULL,
	`recurring_interval` text,
	`show_in_catalog` integer DEFAULT 1 NOT NULL,
	`category` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `organisations` ADD `brands` text DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `requests` ADD `request_number` integer;--> statement-breakpoint
ALTER TABLE `requests` ADD `checklists` text DEFAULT '[]';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_requests_number` ON `requests` (`request_number`);--> statement-breakpoint
ALTER TABLE `team_members` ADD `reports_to_id` text;--> statement-breakpoint
ALTER TABLE `team_members` ADD `department` text;--> statement-breakpoint
