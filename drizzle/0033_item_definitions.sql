CREATE TABLE `item_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`metal_type` text NOT NULL,
	`purity_karat` integer DEFAULT 22 NOT NULL,
	`sale_mode` text DEFAULT 'WEIGHT_WISE' NOT NULL,
	`uom` text DEFAULT 'GRAM' NOT NULL,
	`making_charge_type` text DEFAULT 'PER_GRAM' NOT NULL,
	`making_charge_value` integer DEFAULT 0 NOT NULL,
	`tag_prefix` text DEFAULT '' NOT NULL,
	`hsn_code` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_definitions_name_unique` ON `item_definitions` (`name`);
