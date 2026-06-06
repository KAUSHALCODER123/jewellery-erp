CREATE TABLE `metal_loans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_number` text NOT NULL,
	`supplier_id` integer NOT NULL,
	`metal_type` text DEFAULT 'Gold' NOT NULL,
	`issue_date` text NOT NULL,
	`gross_weight_mg` integer DEFAULT 0 NOT NULL,
	`purity_basis_points` integer DEFAULT 9999 NOT NULL,
	`fine_weight_mg` integer DEFAULT 0 NOT NULL,
	`fine_outstanding_mg` integer DEFAULT 0 NOT NULL,
	`fixed_amount_paise` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'UNFIXED' NOT NULL,
	`notes` text,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `metal_loans_loan_number_unique` ON `metal_loans` (`loan_number`);
--> statement-breakpoint
CREATE TABLE `metal_loan_fixings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`loan_id` integer NOT NULL,
	`fixing_date` text NOT NULL,
	`fine_weight_fixed_mg` integer NOT NULL,
	`rate_paise_per_gram` integer NOT NULL,
	`amount_paise` integer NOT NULL,
	`notes` text,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`loan_id`) REFERENCES `metal_loans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
