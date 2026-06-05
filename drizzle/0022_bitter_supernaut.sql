ALTER TABLE `gss_templates` ADD `scheme_type` text DEFAULT 'CASH' NOT NULL;
--> statement-breakpoint
ALTER TABLE `gss_templates` ADD `is_variable` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `gss_templates` ADD `min_monthly_amount_paise` integer;
--> statement-breakpoint
ALTER TABLE `gss_templates` ADD `max_monthly_amount_paise` integer;
--> statement-breakpoint
ALTER TABLE `gss_accounts` ADD `gold_weight_accumulated_mg` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `gss_accounts` ADD `redeemed_invoice_id` integer REFERENCES invoices(id);
--> statement-breakpoint
ALTER TABLE `gss_accounts` ADD `redeemed_at` text;
--> statement-breakpoint
ALTER TABLE `gss_receipts` ADD `gold_rate_per_gram_paise` integer;
--> statement-breakpoint
ALTER TABLE `gss_receipts` ADD `gold_weight_credited_mg` integer;