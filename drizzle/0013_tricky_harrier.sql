CREATE TABLE `barcode_sequences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prefix` text NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `barcode_sequences_prefix_unique` ON `barcode_sequences` (`prefix`);--> statement-breakpoint
CREATE TABLE `refineries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`fine_gold_balance_mg` integer DEFAULT 0 NOT NULL,
	`cash_balance_paise` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `refinery_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`refinery_id` integer NOT NULL,
	`receive_date` text NOT NULL,
	`fine_gold_received_mg` integer DEFAULT 0 NOT NULL,
	`charges_paise` integer DEFAULT 0 NOT NULL,
	`payment_mode` text DEFAULT 'CASH' NOT NULL,
	`description` text,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`refinery_id`) REFERENCES `refineries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `refinery_transfers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`refinery_id` integer NOT NULL,
	`transfer_date` text NOT NULL,
	`metal_type` text DEFAULT 'Gold' NOT NULL,
	`gross_weight_mg` integer NOT NULL,
	`purity_tunch` real NOT NULL,
	`fine_gold_mg` integer NOT NULL,
	`description` text,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`refinery_id`) REFERENCES `refineries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_verification_scans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`barcode` text NOT NULL,
	`item_id` integer,
	`result` text NOT NULL,
	`scanned_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`session_id`) REFERENCES `stock_verification_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stock_verification_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`location` text,
	`expected_status` text DEFAULT 'IN_STOCK' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`completed_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `urd_vouchers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voucher_number` text NOT NULL,
	`customer_id` integer,
	`customer_name` text NOT NULL,
	`customer_phone` text,
	`voucher_date` text NOT NULL,
	`description` text NOT NULL,
	`metal_type` text NOT NULL,
	`purity_tunch` text NOT NULL,
	`gross_weight_mg` integer NOT NULL,
	`stone_weight_mg` integer DEFAULT 0 NOT NULL,
	`black_bead_weight_mg` integer DEFAULT 0 NOT NULL,
	`net_weight_mg` integer NOT NULL,
	`fine_weight_mg` integer NOT NULL,
	`applied_rate_paise_per_gram` integer NOT NULL,
	`total_value_paise` integer NOT NULL,
	`payment_mode` text NOT NULL,
	`payment_reference` text,
	`pan_number` text,
	`aadhaar_number` text,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `urd_vouchers_voucher_number_unique` ON `urd_vouchers` (`voucher_number`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `bill_prefix` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `manual_number` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `due_date` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `salesman_name` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `gst_not_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `invoices` ADD `payment_reference_json` text;--> statement-breakpoint
ALTER TABLE `items` ADD `black_bead_weight_mg` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `final_weight_mg` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `fine_weight_mg` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `hallmark_charge_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `tag_prefix` text;--> statement-breakpoint
ALTER TABLE `items` ADD `tag_number` integer;--> statement-breakpoint
ALTER TABLE `job_receipts` ADD `is_transferred` integer DEFAULT false NOT NULL;