CREATE TABLE `girvi_collateral` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`item_description` text NOT NULL,
	`metal_type` text NOT NULL,
	`purity_karat` integer NOT NULL,
	`weight_mg` integer NOT NULL,
	`image_path` text,
	FOREIGN KEY (`loan_id`) REFERENCES `girvi_loans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `girvi_loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`loan_number` text NOT NULL,
	`principal_amount_paise` integer NOT NULL,
	`interest_rate_percentage` real NOT NULL,
	`interest_type` text NOT NULL,
	`rate_period` text NOT NULL,
	`issue_date` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`total_repaid_paise` integer DEFAULT 0 NOT NULL,
	`next_due_date` text,
	`created_by` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `girvi_loans_loan_number_unique` ON `girvi_loans` (`loan_number`);--> statement-breakpoint
CREATE TABLE `girvi_repayments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`payment_date` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`interest_allocated_paise` integer NOT NULL,
	`principal_allocated_paise` integer NOT NULL,
	`created_by` integer,
	FOREIGN KEY (`loan_id`) REFERENCES `girvi_loans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `customers` ADD `kyc_photo_path` text;