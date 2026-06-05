CREATE TABLE `token_blacklist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_jti` text NOT NULL,
	`user_id` integer,
	`blacklisted_at` text DEFAULT CURRENT_TIMESTAMP,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `token_blacklist_token_jti_unique` ON `token_blacklist` (`token_jti`);
