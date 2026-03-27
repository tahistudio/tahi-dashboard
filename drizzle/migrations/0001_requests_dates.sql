-- Add start_date and due_date to requests table
ALTER TABLE `requests` ADD `start_date` text;
--> statement-breakpoint
ALTER TABLE `requests` ADD `due_date` text;
