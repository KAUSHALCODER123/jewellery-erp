ALTER TABLE `urd_purchases` ADD `stock_item_id` integer REFERENCES `items`(`id`);
--> statement-breakpoint
ALTER TABLE `urd_purchases` ADD `refinery_transfer_id` integer REFERENCES `refinery_transfers`(`id`);
--> statement-breakpoint
ALTER TABLE `urd_purchases` ADD `stock_status` text DEFAULT 'PENDING' NOT NULL;
--> statement-breakpoint
ALTER TABLE `urd_vouchers` ADD `stock_item_id` integer REFERENCES `items`(`id`);
--> statement-breakpoint
ALTER TABLE `urd_vouchers` ADD `refinery_transfer_id` integer REFERENCES `refinery_transfers`(`id`);
--> statement-breakpoint
ALTER TABLE `urd_vouchers` ADD `stock_status` text DEFAULT 'PENDING' NOT NULL;
--> statement-breakpoint
ALTER TABLE `urd_vouchers` ADD `kyc_verified` integer DEFAULT 0 NOT NULL;
