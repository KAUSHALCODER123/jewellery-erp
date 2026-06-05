CREATE TABLE `journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ledger_id` integer NOT NULL,
	`transaction_type` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reference_type` text NOT NULL,
	`reference_id` integer,
	`description` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`ledger_id`) REFERENCES `ledgers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ledgers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_name` text NOT NULL,
	`account_type` text NOT NULL,
	`entity_id` integer,
	`balance_paise` integer DEFAULT 0 NOT NULL
);
