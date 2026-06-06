CREATE TABLE `customer_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_number` text NOT NULL,
	`customer_id` integer NOT NULL REFERENCES `customers`(`id`),
	`item_description` text NOT NULL,
	`target_weight_mg` integer NOT NULL DEFAULT 0,
	`target_purity` integer NOT NULL DEFAULT 9167,
	`notes` text,
	`customer_gold_mg` integer NOT NULL DEFAULT 0,
	`customer_gold_purity_tunch` integer NOT NULL DEFAULT 10000,
	`expected_by_date` text,
	`advance_paise` integer NOT NULL DEFAULT 0,
	`status` text NOT NULL DEFAULT 'OPEN',
	`karigar_job_id` integer REFERENCES `job_orders`(`id`),
	`created_at` text DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_orders_order_number_unique` ON `customer_orders` (`order_number`);
