CREATE TABLE `gss_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`template_id` integer NOT NULL,
	`card_number` text NOT NULL,
	`enrollment_date` text NOT NULL,
	`maturity_date` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`total_paid_paise` integer DEFAULT 0 NOT NULL,
	`installments_paid_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_id`) REFERENCES `gss_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gss_accounts_card_number_unique` ON `gss_accounts` (`card_number`);--> statement-breakpoint
CREATE TABLE `gss_receipts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gss_account_id` integer NOT NULL,
	`installment_number` integer NOT NULL,
	`payment_date` text NOT NULL,
	`amount_paid_paise` integer NOT NULL,
	`payment_mode` text NOT NULL,
	`journal_entry_id` integer,
	`created_by` integer,
	FOREIGN KEY (`gss_account_id`) REFERENCES `gss_accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `gss_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scheme_code` text NOT NULL,
	`scheme_name` text NOT NULL,
	`duration_months` integer NOT NULL,
	`monthly_amount_paise` integer NOT NULL,
	`bonus_rule_type` text NOT NULL,
	`bonus_value_paise` integer NOT NULL,
	`is_active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gss_templates_scheme_code_unique` ON `gss_templates` (`scheme_code`);