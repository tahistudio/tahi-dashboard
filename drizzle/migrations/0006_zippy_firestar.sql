ALTER TABLE `organisations` ADD `custom_fields` text DEFAULT '{}';--> statement-breakpoint
ALTER TABLE `organisations` ADD `default_hourly_rate` integer;--> statement-breakpoint
ALTER TABLE `organisations` ADD `size` text;--> statement-breakpoint
ALTER TABLE `organisations` ADD `annual_revenue` integer;