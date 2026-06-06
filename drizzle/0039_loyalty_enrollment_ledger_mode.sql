ALTER TABLE `customers` ADD `loyalty_enrolled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `loyalty_earn_mode` text DEFAULT 'PER_HUNDRED_RUPEES' NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `loyalty_points_per_gram_gold` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE TABLE `loyalty_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`invoice_id` integer,
	`transaction_type` text NOT NULL,
	`points` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
