ALTER TABLE `girvi_collateral` ADD `gross_weight_mg` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `girvi_collateral` ADD `stone_deduction_mg` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `girvi_collateral` ADD `valuation_rate_paise_per_gram` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `girvi_collateral` ADD `rate_overridden` integer DEFAULT false NOT NULL;
