CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`storage_key` text NOT NULL,
	`signed_storage_key` text,
	`start_date` text,
	`expiry_date` text,
	`signatory_name` text,
	`signatory_email` text,
	`signed_at` text,
	`created_by_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_contracts_org` ON `contracts` (`org_id`);--> statement-breakpoint
CREATE TABLE `conversation_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`participant_type` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` text NOT NULL,
	`last_read_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_conv_participants_conv` ON `conversation_participants` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`name` text,
	`org_id` text,
	`request_id` text,
	`visibility` text DEFAULT 'external' NOT NULL,
	`created_by_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `kanban_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`label` text NOT NULL,
	`status_value` text NOT NULL,
	`colour` text,
	`position` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_forms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`org_id` text,
	`questions` text DEFAULT '[]' NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `request_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`parent_step_id` text,
	`title` text NOT NULL,
	`description` text,
	`completed` integer DEFAULT false,
	`completed_at` text,
	`order_index` integer DEFAULT 0,
	`assignee_id` text,
	`created_by_id` text,
	`created_by_type` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_steps_request` ON `request_steps` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_steps_parent` ON `request_steps` (`parent_step_id`);--> statement-breakpoint
CREATE TABLE `scheduled_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`scheduled_at` text NOT NULL,
	`duration_minutes` integer DEFAULT 30 NOT NULL,
	`meeting_url` text,
	`attendees` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`notes` text,
	`recording_url` text,
	`created_by_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_calls_org` ON `scheduled_calls` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_calls_scheduled` ON `scheduled_calls` (`scheduled_at`);--> statement-breakpoint
CREATE TABLE `team_member_access` (
	`id` text PRIMARY KEY NOT NULL,
	`team_member_id` text NOT NULL,
	`role` text NOT NULL,
	`scope_type` text NOT NULL,
	`plan_type` text,
	`track_type` text DEFAULT 'all' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`team_member_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tma_member` ON `team_member_access` (`team_member_id`);--> statement-breakpoint
CREATE TABLE `team_member_access_orgs` (
	`access_id` text NOT NULL,
	`org_id` text NOT NULL,
	FOREIGN KEY (`access_id`) REFERENCES `team_member_access`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `announcements` ADD `target_ids` text;--> statement-breakpoint
ALTER TABLE `announcements` ADD `sent_by_email` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `announcements` ADD `email_sent_at` text;--> statement-breakpoint
ALTER TABLE `case_study_submissions` ADD `outreach_status` text DEFAULT 'not_sent';--> statement-breakpoint
ALTER TABLE `case_study_submissions` ADD `next_ask_at` text;--> statement-breakpoint
ALTER TABLE `case_study_submissions` ADD `never_ask` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `messages` ADD `conversation_id` text;--> statement-breakpoint
CREATE INDEX `idx_messages_conversation` ON `messages` (`conversation_id`);--> statement-breakpoint
ALTER TABLE `requests` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `requests` ADD `queue_order` integer DEFAULT 0;