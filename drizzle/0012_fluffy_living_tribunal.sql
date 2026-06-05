CREATE TABLE `item_stones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`stone_type` text NOT NULL,
	`shape` text,
	`carat_weight` real NOT NULL,
	`color_grade` text,
	`clarity_grade` text,
	`cut_grade` text,
	`certificate_number` text,
	`certificate_lab` text DEFAULT 'NONE',
	`stone_rate_paise` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_stones_certificate_number_unique` ON `item_stones` (`certificate_number`);