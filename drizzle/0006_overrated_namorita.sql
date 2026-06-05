CREATE TABLE `job_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_number` text NOT NULL,
	`karigar_id` integer NOT NULL,
	`customer_id` integer,
	`design_image_path` text,
	`target_purity` integer NOT NULL,
	`target_weight_mg` integer NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`karigar_id`) REFERENCES `karigars`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_orders_order_number_unique` ON `job_orders` (`order_number`);--> statement-breakpoint
CREATE TABLE `job_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`receive_date` text NOT NULL,
	`final_gross_weight_mg` integer NOT NULL,
	`final_net_weight_mg` integer NOT NULL,
	`scrap_returned_mg` integer NOT NULL,
	`acceptable_loss_mg` integer NOT NULL,
	`actual_loss_mg` integer NOT NULL,
	`fine_gold_debited_mg` integer NOT NULL,
	`labor_charge_paise` integer NOT NULL,
	`received_by` integer,
	FOREIGN KEY (`job_id`) REFERENCES `job_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`received_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `karigars` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`specialty` text NOT NULL,
	`fine_gold_balance_mg` integer DEFAULT 0 NOT NULL,
	`cash_balance_paise` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `material_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`issue_date` text NOT NULL,
	`metal_type` text NOT NULL,
	`purity_tunch` integer NOT NULL,
	`gross_weight_mg` integer NOT NULL,
	`fine_gold_mg` integer NOT NULL,
	`issued_by` integer,
	FOREIGN KEY (`job_id`) REFERENCES `job_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issued_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
