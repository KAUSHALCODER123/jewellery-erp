ALTER TABLE `girvi_loans` ADD `interest_period_type` text DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE `girvi_loans` ADD `loan_letter_fee_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `girvi_loans` ADD `notice_fee_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `girvi_loans` ADD `customer_photo_path` text;--> statement-breakpoint
ALTER TABLE `girvi_loans` ADD `thumbprint_path` text;--> statement-breakpoint
ALTER TABLE `girvi_repayments` ADD `discount_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `girvi_repayments` ADD `notice_fee_paid_paise` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `girvi_repayments` ADD `loan_letter_fee_paid_paise` integer DEFAULT 0 NOT NULL;