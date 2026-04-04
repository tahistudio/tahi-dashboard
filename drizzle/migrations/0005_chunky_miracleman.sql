CREATE TABLE IF NOT EXISTS `brand_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`brand_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_brand_contacts_brand` ON `brand_contacts` (`brand_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_brand_contacts_contact` ON `brand_contacts` (`contact_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `brands` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`logo_url` text,
	`website` text,
	`primary_colour` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_brands_org` ON `brands` (`org_id`);--> statement-breakpoint
ALTER TABLE `requests` ADD `brand_id` text;
