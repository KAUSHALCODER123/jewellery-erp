ALTER TABLE `items` ADD `is_published_online` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `items` ADD `online_title` text;--> statement-breakpoint
ALTER TABLE `items` ADD `online_description` text;--> statement-breakpoint
ALTER TABLE `items` ADD `image_urls` text;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `webhook_secret` text;--> statement-breakpoint
ALTER TABLE `organization_settings` ADD `ecommerce_sync_url` text;