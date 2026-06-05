CREATE TABLE `error_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`error_message` text NOT NULL,
	`stack_trace` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `sync_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task_type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempted_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
