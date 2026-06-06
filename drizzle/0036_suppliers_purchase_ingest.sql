CREATE TABLE `suppliers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`gstin` text,
	`address` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suppliers_name_unique` ON `suppliers` (`name`);--> statement-breakpoint
ALTER TABLE `purchase_invoice_lines` ADD `category` text DEFAULT 'Purchase Stock' NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_invoice_lines` ADD `quantity` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `purchase_invoices` ADD `supplier_id` integer REFERENCES suppliers(id);