CREATE TABLE `invoice_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`metal_type` text NOT NULL,
	`purity_karat` integer NOT NULL,
	`gross_weight_mg` integer NOT NULL,
	`net_weight_mg` integer NOT NULL,
	`stone_weight_mg` integer DEFAULT 0,
	`metal_rate_paise_per_gram` integer NOT NULL,
	`making_charge_paise` integer NOT NULL,
	`wastage_charge_paise` integer DEFAULT 0,
	`gst_paise` integer DEFAULT 0,
	`line_total_paise` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `repair_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`intake_photo_paths` text,
	`description` text NOT NULL,
	`status` text DEFAULT 'RECEIVED' NOT NULL,
	`estimated_charge_paise` integer DEFAULT 0,
	`actual_charge_paise` integer DEFAULT 0,
	`karigar_id` integer,
	`intake_date` text NOT NULL,
	`delivery_date` text,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`karigar_id`) REFERENCES `karigars`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `urd_purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_id` integer NOT NULL,
	`description` text NOT NULL,
	`metal_type` text NOT NULL,
	`purity_tunch` text NOT NULL,
	`weight_mg` integer NOT NULL,
	`applied_rate_paise_per_gram` integer NOT NULL,
	`deduction_amount_paise` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `area` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `taluka` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `district` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `anniversary_date` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `birthday_date` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `ring_size` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `spouse_name` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `loyalty_points_balance` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `invoices` ADD `gst_percentage` real;--> statement-breakpoint
ALTER TABLE `invoices` ADD `gst_amount_paise` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `invoices` ADD `hsn_code` text;--> statement-breakpoint
ALTER TABLE `invoices` ADD `discount_paise` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `invoices` ADD `wastage_total_paise` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `invoices` ADD `urd_deduction_paise` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `invoices` ADD `gss_credit_paise` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `invoices` ADD `cheque_amount_paise` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `invoices` ADD `neft_amount_paise` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `invoices` ADD `invoice_type` text DEFAULT 'SALE';--> statement-breakpoint
ALTER TABLE `items` ADD `wastage_percentage` real DEFAULT 0;--> statement-breakpoint
ALTER TABLE `items` ADD `design_name` text;--> statement-breakpoint
ALTER TABLE `items` ADD `location` text DEFAULT 'VAULT';--> statement-breakpoint
ALTER TABLE `items` ADD `vendor_id` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `purchase_rate_paise` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `purchase_date` text;