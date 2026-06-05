CREATE TABLE `item_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`metal_type` text,
	`hsn_code` text,
	`default_uom` text DEFAULT 'GRAM' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_groups_name_unique` ON `item_groups` (`name`);
--> statement-breakpoint
ALTER TABLE `items` ADD `sale_mode` text DEFAULT 'WEIGHT_WISE' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `uom` text DEFAULT 'GRAM' NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `unit_price_paise` integer DEFAULT 0 NOT NULL;
