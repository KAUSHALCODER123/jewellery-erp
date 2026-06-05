ALTER TABLE `organization_settings` ADD `scale_port_name` text;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `scale_baud_rate` integer DEFAULT 9600 NOT NULL;