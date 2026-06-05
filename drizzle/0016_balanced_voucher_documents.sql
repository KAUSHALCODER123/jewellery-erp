CREATE TABLE `voucher_headers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voucher_number` text NOT NULL,
	`voucher_type` text NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` integer,
	`narration` text,
	`total_debit_paise` integer NOT NULL,
	`total_credit_paise` integer NOT NULL,
	`status` text DEFAULT 'POSTED' NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voucher_headers_voucher_number_unique` ON `voucher_headers` (`voucher_number`);
--> statement-breakpoint
CREATE TABLE `voucher_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`voucher_id` integer NOT NULL,
	`ledger_id` integer NOT NULL,
	`transaction_type` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`description` text,
	`journal_entry_id` integer,
	FOREIGN KEY (`voucher_id`) REFERENCES `voucher_headers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries`(`id`) ON UPDATE no action ON DELETE no action
);
