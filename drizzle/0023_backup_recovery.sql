CREATE TABLE `backup_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`backup_type` text NOT NULL,
	`target` text NOT NULL,
	`file_name` text NOT NULL,
	`file_path` text NOT NULL,
	`file_size_bytes` integer NOT NULL,
	`checksum_sha256` text NOT NULL,
	`is_encrypted` integer DEFAULT true NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_by` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `backup_schedule_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`is_enabled` integer DEFAULT false NOT NULL,
	`interval_hours` integer DEFAULT 24 NOT NULL,
	`target` text DEFAULT 'LOCAL' NOT NULL,
	`local_backup_dir` text,
	`usb_backup_dir` text,
	`cloud_upload_url` text,
	`max_retained_backups` integer DEFAULT 10 NOT NULL,
	`passphrase_hash` text,
	`last_run_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
