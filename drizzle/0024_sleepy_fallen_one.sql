ALTER TABLE `backup_schedule_config` ADD `backup_on_exit` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `tally_sync_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `tally_gateway_url` text DEFAULT 'http://localhost:9000' NOT NULL;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `tally_company_name` text DEFAULT 'Test Shop' NOT NULL;