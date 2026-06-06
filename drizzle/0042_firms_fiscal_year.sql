CREATE TABLE `firms` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `key` text NOT NULL,
  `display_name` text NOT NULL,
  `gstin` text,
  `address` text,
  `contact_number` text,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` text DEFAULT (CURRENT_TIMESTAMP)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `firms_key_unique` ON `firms` (`key`);
--> statement-breakpoint
ALTER TABLE `invoices` ADD `firm_id` integer REFERENCES `firms`(`id`);
--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `firm_id` integer REFERENCES `firms`(`id`);
--> statement-breakpoint
INSERT INTO `firms` (`key`, `display_name`) VALUES ('default', 'Main Showroom');
