CREATE TABLE `quotations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quotation_number` text NOT NULL,
	`customer_id` integer,
	`quotation_date` text NOT NULL,
	`expiry_date` text,
	`salesman_name` text,
	`gross_total_paise` integer NOT NULL,
	`discount_paise` integer DEFAULT 0 NOT NULL,
	`gst_amount_paise` integer DEFAULT 0 NOT NULL,
	`total_amount_paise` integer NOT NULL,
	`status` text DEFAULT 'POSTED' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotations_quotation_number_unique` ON `quotations` (`quotation_number`);
--> statement-breakpoint
CREATE TABLE `quotation_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quotation_id` integer NOT NULL,
	`item_id` integer,
	`description` text NOT NULL,
	`metal_type` text NOT NULL,
	`purity_karat` integer NOT NULL,
	`gross_weight_mg` integer NOT NULL,
	`stone_weight_mg` integer DEFAULT 0 NOT NULL,
	`net_weight_mg` integer NOT NULL,
	`metal_rate_paise_per_gram` integer NOT NULL,
	`making_charge_paise` integer DEFAULT 0 NOT NULL,
	`gst_paise` integer DEFAULT 0 NOT NULL,
	`line_total_paise` integer NOT NULL,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_number` text NOT NULL,
	`supplier_name` text NOT NULL,
	`supplier_phone` text,
	`supplier_gstin` text,
	`purchase_date` text NOT NULL,
	`bill_number` text,
	`payment_mode` text NOT NULL,
	`payment_reference` text,
	`gross_total_paise` integer NOT NULL,
	`gst_amount_paise` integer DEFAULT 0 NOT NULL,
	`total_amount_paise` integer NOT NULL,
	`status` text DEFAULT 'POSTED' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_invoices_purchase_number_unique` ON `purchase_invoices` (`purchase_number`);
--> statement-breakpoint
CREATE TABLE `purchase_invoice_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_invoice_id` integer NOT NULL,
	`description` text NOT NULL,
	`metal_type` text NOT NULL,
	`purity_karat` integer NOT NULL,
	`gross_weight_mg` integer NOT NULL,
	`stone_weight_mg` integer DEFAULT 0 NOT NULL,
	`net_weight_mg` integer NOT NULL,
	`metal_rate_paise_per_gram` integer NOT NULL,
	`making_charge_paise` integer DEFAULT 0 NOT NULL,
	`gst_paise` integer DEFAULT 0 NOT NULL,
	`line_total_paise` integer NOT NULL,
	FOREIGN KEY (`purchase_invoice_id`) REFERENCES `purchase_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sales_returns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`return_number` text NOT NULL,
	`invoice_id` integer,
	`customer_id` integer,
	`return_date` text NOT NULL,
	`refund_mode` text NOT NULL,
	`refund_reference` text,
	`reason` text,
	`gross_total_paise` integer NOT NULL,
	`gst_reversal_paise` integer DEFAULT 0 NOT NULL,
	`total_refund_paise` integer NOT NULL,
	`status` text DEFAULT 'POSTED' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_returns_return_number_unique` ON `sales_returns` (`return_number`);
--> statement-breakpoint
CREATE TABLE `sales_return_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sales_return_id` integer NOT NULL,
	`item_id` integer,
	`description` text NOT NULL,
	`metal_type` text NOT NULL,
	`purity_karat` integer NOT NULL,
	`gross_weight_mg` integer NOT NULL,
	`net_weight_mg` integer NOT NULL,
	`refund_amount_paise` integer NOT NULL,
	`gst_reversal_paise` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`sales_return_id`) REFERENCES `sales_returns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_returns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`return_number` text NOT NULL,
	`purchase_invoice_id` integer,
	`supplier_name` text NOT NULL,
	`return_date` text NOT NULL,
	`refund_mode` text NOT NULL,
	`refund_reference` text,
	`reason` text,
	`gross_total_paise` integer NOT NULL,
	`gst_reversal_paise` integer DEFAULT 0 NOT NULL,
	`total_refund_paise` integer NOT NULL,
	`status` text DEFAULT 'POSTED' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`purchase_invoice_id`) REFERENCES `purchase_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_returns_return_number_unique` ON `purchase_returns` (`return_number`);
--> statement-breakpoint
CREATE TABLE `purchase_return_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`purchase_return_id` integer NOT NULL,
	`description` text NOT NULL,
	`metal_type` text NOT NULL,
	`purity_karat` integer NOT NULL,
	`gross_weight_mg` integer NOT NULL,
	`net_weight_mg` integer NOT NULL,
	`return_amount_paise` integer NOT NULL,
	`gst_reversal_paise` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`purchase_return_id`) REFERENCES `purchase_returns`(`id`) ON UPDATE no action ON DELETE no action
);
