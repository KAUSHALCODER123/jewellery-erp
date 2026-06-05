CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`target_table` text NOT NULL,
	`record_id` integer,
	`old_values` text,
	`new_values` text,
	`timestamp` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`address` text,
	`pan_number` text,
	`aadhaar_number` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_phone_unique` ON `customers` (`phone`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_number` text NOT NULL,
	`customer_id` integer,
	`total_amount_paise` integer NOT NULL,
	`payment_mode` text NOT NULL,
	`is_cash_above_limit` integer DEFAULT false,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_number_unique` ON `invoices` (`invoice_number`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`barcode` text NOT NULL,
	`huid` text,
	`category` text NOT NULL,
	`metal_type` text NOT NULL,
	`purity_karat` integer NOT NULL,
	`gross_weight_mg` integer NOT NULL,
	`stone_weight_mg` integer DEFAULT 0,
	`net_weight_mg` integer NOT NULL,
	`making_charge_type` text NOT NULL,
	`making_charge_value` integer NOT NULL,
	`status` text DEFAULT 'IN_STOCK'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_barcode_unique` ON `items` (`barcode`);--> statement-breakpoint
CREATE UNIQUE INDEX `items_huid_unique` ON `items` (`huid`);--> statement-breakpoint
CREATE TABLE `organization_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shop_name` text NOT NULL,
	`address` text NOT NULL,
	`gstin` text,
	`contact_number` text NOT NULL,
	`gold_24k_rate_per_gram` integer DEFAULT 0 NOT NULL,
	`gold_22k_rate_per_gram` integer DEFAULT 0 NOT NULL,
	`gold_18k_rate_per_gram` integer DEFAULT 0 NOT NULL,
	`silver_rate_per_gram` integer DEFAULT 0 NOT NULL,
	`default_gst_percentage` real DEFAULT 3 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);