ALTER TABLE `job_orders` ADD `job_name` text;--> statement-breakpoint
ALTER TABLE `job_receipts` ADD `wastage_mode` text DEFAULT 'PERCENTAGE' NOT NULL;--> statement-breakpoint
ALTER TABLE `job_receipts` ADD `wastage_value` integer DEFAULT 200 NOT NULL;