ALTER TABLE `job_receipts` ADD `scrap_purity_tunch` integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE `job_receipts` ADD `excess_loss_mg` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `job_receipts` ADD `is_anomaly` integer DEFAULT false NOT NULL;