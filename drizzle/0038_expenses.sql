CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expense_date` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`amount_paise` integer NOT NULL,
	`payment_mode` text DEFAULT 'CASH' NOT NULL,
	`voucher_id` integer,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
