CREATE TABLE `announcement_dismissals` (
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`dismissed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`type` text DEFAULT 'info' NOT NULL,
	`target_type` text DEFAULT 'all' NOT NULL,
	`target_value` text,
	`scheduled_at` text,
	`published_at` text,
	`expires_at` text,
	`created_by_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`actor_type` text,
	`action` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`metadata` text,
	`ip_address` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `automation_log` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text,
	`trigger_event` text NOT NULL,
	`entity_id` text,
	`actions_executed` text,
	`status` text NOT NULL,
	`error_message` text,
	`executed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `automation_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true,
	`trigger_event` text NOT NULL,
	`conditions` text DEFAULT '[]',
	`actions` text NOT NULL,
	`execution_count` integer DEFAULT 0,
	`last_executed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `case_studies` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`submission_id` text,
	`title` text NOT NULL,
	`content_md` text,
	`draft_generated_by_ai` integer DEFAULT false,
	`published_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `case_study_submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `case_study_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`submission_token` text NOT NULL,
	`project_name` text,
	`written_testimonial` text,
	`video_url` text,
	`video_storage_key` text,
	`nps_score` integer,
	`loved_most` text,
	`improve` text,
	`marketing_permission` integer DEFAULT false,
	`logo_permission` integer DEFAULT false,
	`status` text DEFAULT 'pending' NOT NULL,
	`submitted_at` text,
	`token_expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `case_study_submissions_submission_token_unique` ON `case_study_submissions` (`submission_token`);--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`clerk_user_id` text,
	`is_primary` integer DEFAULT false,
	`last_login_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_contacts_org` ON `contacts` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_contacts_clerk` ON `contacts` (`clerk_user_id`);--> statement-breakpoint
CREATE TABLE `doc_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`category` text DEFAULT 'operations' NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`content_tiptap` text,
	`content_text` text,
	`author_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_docs_category` ON `doc_pages` (`category`);--> statement-breakpoint
CREATE INDEX `idx_docs_slug` ON `doc_pages` (`slug`);--> statement-breakpoint
CREATE TABLE `doc_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`content_tiptap` text,
	`saved_by_id` text,
	`saved_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `doc_pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`currency` text PRIMARY KEY NOT NULL,
	`rate_to_usd` real NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text,
	`org_id` text NOT NULL,
	`uploaded_by_id` text NOT NULL,
	`uploaded_by_type` text NOT NULL,
	`filename` text NOT NULL,
	`storage_key` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_files_org` ON `files` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_files_request` ON `files` (`request_id`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`status` text DEFAULT 'disconnected' NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`token_expires_at` text,
	`config` text DEFAULT '{}',
	`last_synced_at` text,
	`error_message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_service_unique` ON `integrations` (`service`);--> statement-breakpoint
CREATE TABLE `invoice_items` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real DEFAULT 1,
	`unit_price_usd` real NOT NULL,
	`total_usd` real NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`project_id` text,
	`subscription_id` text,
	`stripe_invoice_id` text,
	`xero_invoice_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`amount_usd` real NOT NULL,
	`tax_amount_usd` real DEFAULT 0,
	`discount_amount_usd` real DEFAULT 0,
	`total_usd` real NOT NULL,
	`currency` text DEFAULT 'USD',
	`notes` text,
	`due_date` text,
	`sent_at` text,
	`viewed_at` text,
	`paid_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_invoices_org` ON `invoices` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_invoices_status` ON `invoices` (`status`);--> statement-breakpoint
CREATE TABLE `message_reactions` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text,
	`org_id` text NOT NULL,
	`author_id` text NOT NULL,
	`author_type` text NOT NULL,
	`body` text NOT NULL,
	`is_internal` integer DEFAULT false,
	`edited_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_messages_request` ON `messages` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_messages_org` ON `messages` (`org_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`user_type` text NOT NULL,
	`event_type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`entity_type` text,
	`entity_id` text,
	`read` integer DEFAULT false,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user` ON `notifications` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_notifications_read` ON `notifications` (`read`);--> statement-breakpoint
CREATE TABLE `organisations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`logo_url` text,
	`industry` text,
	`status` text DEFAULT 'prospect' NOT NULL,
	`plan_type` text DEFAULT 'none',
	`stripe_customer_id` text,
	`health_status` text DEFAULT 'green',
	`health_note` text,
	`onboarding_loom_url` text,
	`onboarding_state` text DEFAULT '{}',
	`parent_org_id` text,
	`preferred_currency` text DEFAULT 'USD',
	`converted_from_project_id` text,
	`internal_notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_orgs_status` ON `organisations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_orgs_plan` ON `organisations` (`plan_type`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`type` text NOT NULL,
	`billing_type` text DEFAULT 'fixed' NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`price_usd` real,
	`hourly_rate_usd` real,
	`stripe_payment_intent_id` text,
	`start_date` text,
	`expected_delivery` text,
	`delivered_at` text,
	`support_expires_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_projects_org` ON `projects` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_status` ON `projects` (`status`);--> statement-breakpoint
CREATE TABLE `requests` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`track_id` text,
	`project_id` text,
	`type` text DEFAULT 'small_task' NOT NULL,
	`category` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`priority` text DEFAULT 'standard' NOT NULL,
	`assignee_id` text,
	`submitted_by_id` text,
	`submitted_by_type` text DEFAULT 'contact',
	`estimated_hours` real,
	`revision_count` integer DEFAULT 0,
	`max_revisions` integer DEFAULT 3,
	`scope_flagged` integer DEFAULT false,
	`is_internal` integer DEFAULT false,
	`form_responses` text DEFAULT '{}',
	`tags` text DEFAULT '[]',
	`delivered_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_requests_org` ON `requests` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_requests_status` ON `requests` (`status`);--> statement-breakpoint
CREATE INDEX `idx_requests_assignee` ON `requests` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `idx_requests_track` ON `requests` (`track_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`plan_type` text NOT NULL,
	`stripe_subscription_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`current_period_start` text,
	`current_period_end` text,
	`has_priority_support` integer DEFAULT false,
	`has_seo_addon` integer DEFAULT false,
	`loyalty_discount_applied` integer DEFAULT false,
	`referral_coupon_id` text,
	`cancelled_at` text,
	`cancellation_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_subs_org` ON `subscriptions` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_subs_status` ON `subscriptions` (`status`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`colour` text DEFAULT '#5A824E',
	`applies_to` text DEFAULT 'request',
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_subtasks` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`title` text NOT NULL,
	`completed` integer DEFAULT false,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`org_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` text DEFAULT 'standard' NOT NULL,
	`assignee_id` text,
	`assignee_type` text,
	`due_date` text,
	`completed_at` text,
	`created_by_id` text,
	`tags` text DEFAULT '[]',
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_org` ON `tasks` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_type` ON `tasks` (`type`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE TABLE `team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`title` text,
	`role` text DEFAULT 'member' NOT NULL,
	`clerk_user_id` text,
	`weekly_capacity_hours` real DEFAULT 40,
	`skills` text DEFAULT '[]',
	`is_contractor` integer DEFAULT false,
	`slack_user_id` text,
	`avatar_url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`request_id` text,
	`team_member_id` text NOT NULL,
	`hours` real NOT NULL,
	`billable` integer DEFAULT true,
	`notes` text,
	`date` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_id`) REFERENCES `requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`team_member_id`) REFERENCES `team_members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_time_org` ON `time_entries` (`org_id`);--> statement-breakpoint
CREATE INDEX `idx_time_member` ON `time_entries` (`team_member_id`);--> statement-breakpoint
CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`type` text NOT NULL,
	`is_priority_track` integer DEFAULT false,
	`current_request_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `voice_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`duration_seconds` real,
	`mime_type` text DEFAULT 'audio/ogg',
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
