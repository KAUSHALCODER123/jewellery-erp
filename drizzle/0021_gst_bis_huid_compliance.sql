ALTER TABLE `invoices` ADD `taxable_value_paise` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `cgst_paise` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `sgst_paise` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `igst_paise` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `cess_paise` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `supply_state_code` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `place_of_supply_state_code` text;
--> statement-breakpoint
ALTER TABLE `invoices` ADD `gst_supply_type` text DEFAULT 'INTRA_STATE';
--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD `taxable_value_paise` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD `cgst_paise` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD `sgst_paise` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD `igst_paise` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `invoice_lines` ADD `cess_paise` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `items` ADD `huid_status` text DEFAULT 'NOT_APPLIED' NOT NULL;
--> statement-breakpoint
ALTER TABLE `items` ADD `huid_certificate_number` text;
--> statement-breakpoint
ALTER TABLE `items` ADD `huid_certificate_url` text;
--> statement-breakpoint
ALTER TABLE `items` ADD `bis_job_number` text;
--> statement-breakpoint
ALTER TABLE `items` ADD `hallmark_center_name` text;
--> statement-breakpoint
ALTER TABLE `items` ADD `hallmark_submitted_at` text;
--> statement-breakpoint
ALTER TABLE `items` ADD `hallmark_returned_at` text;
--> statement-breakpoint
CREATE TABLE `gst_audit_period_locks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `period_from` text NOT NULL,
  `period_to` text NOT NULL,
  `status` text DEFAULT 'LOCKED' NOT NULL,
  `reason` text,
  `locked_by` integer,
  `unlocked_by` integer,
  `locked_at` text DEFAULT CURRENT_TIMESTAMP,
  `unlocked_at` text,
  FOREIGN KEY (`locked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`unlocked_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `huid_lifecycle_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `item_id` integer NOT NULL,
  `from_status` text,
  `to_status` text NOT NULL,
  `event_type` text NOT NULL,
  `remarks` text,
  `bis_job_number` text,
  `huid` text,
  `certificate_number` text,
  `created_by` integer,
  `created_at` text DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bis_submissions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `submission_number` text NOT NULL,
  `hallmark_center_name` text NOT NULL,
  `submitted_date` text NOT NULL,
  `expected_return_date` text,
  `status` text DEFAULT 'SUBMITTED' NOT NULL,
  `remarks` text,
  `created_by` integer,
  `created_at` text DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bis_submissions_submission_number_unique` ON `bis_submissions` (`submission_number`);
--> statement-breakpoint
CREATE TABLE `bis_submission_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `submission_id` integer NOT NULL,
  `item_id` integer NOT NULL,
  `submitted_gross_weight_mg` integer NOT NULL,
  `submitted_net_weight_mg` integer NOT NULL,
  `returned_at` text,
  `huid` text,
  `certificate_number` text,
  `certificate_url` text,
  `status` text DEFAULT 'SUBMITTED' NOT NULL,
  `remarks` text,
  FOREIGN KEY (`submission_id`) REFERENCES `bis_submissions`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
