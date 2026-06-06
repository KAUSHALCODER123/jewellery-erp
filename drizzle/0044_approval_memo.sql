CREATE TABLE `approval_memos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memo_number` text NOT NULL,
	`memo_type` text DEFAULT 'CUSTOMER' NOT NULL,
	`customer_id` integer,
	`party_name` text NOT NULL,
	`party_phone` text,
	`issue_date` text NOT NULL,
	`due_date` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`notes` text,
	`created_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approval_memos_memo_number_unique` ON `approval_memos` (`memo_number`);
--> statement-breakpoint
CREATE TABLE `approval_memo_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memo_id` integer NOT NULL,
	`item_id` integer,
	`description` text NOT NULL,
	`barcode` text,
	`metal_type` text,
	`purity_karat` integer,
	`gross_weight_mg` integer DEFAULT 0 NOT NULL,
	`net_weight_mg` integer DEFAULT 0 NOT NULL,
	`estimated_value_paise` integer DEFAULT 0 NOT NULL,
	`line_status` text DEFAULT 'OUT' NOT NULL,
	`returned_at` text,
	`invoice_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`memo_id`) REFERENCES `approval_memos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
