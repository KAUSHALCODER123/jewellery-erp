ALTER TABLE `customers` ADD `email` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `whatsapp_phone` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `gstin` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `opening_balance_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `opening_balance_type` text DEFAULT 'DEBIT' NOT NULL;
