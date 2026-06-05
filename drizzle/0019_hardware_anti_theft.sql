CREATE TABLE `hardware_devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`device_type` text NOT NULL,
	`connection_type` text NOT NULL,
	`port_name` text,
	`ip_address` text,
	`baud_rate` integer,
	`command_language` text,
	`label_page_size` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_seen_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE `scanner_audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`source_device_id` integer,
	`barcode` text,
	`rfid_epc` text,
	`item_id` integer,
	`result` text NOT NULL,
	`context` text,
	`raw_payload_json` text,
	`user_id` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (`source_device_id`) REFERENCES `hardware_devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `smart_tray_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tray_code` text NOT NULL,
	`device_id` integer,
	`customer_id` integer,
	`purpose` text DEFAULT 'SHOWROOM_VIEW' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`opened_by` integer,
	`opened_at` text DEFAULT CURRENT_TIMESTAMP,
	`closed_at` text,
	FOREIGN KEY (`device_id`) REFERENCES `hardware_devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `smart_tray_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`item_id` integer,
	`barcode` text NOT NULL,
	`expected_return` integer DEFAULT true NOT NULL,
	`returned_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `smart_tray_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `anti_theft_alerts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`alert_type` text NOT NULL,
	`severity` text DEFAULT 'HIGH' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`item_id` integer,
	`barcode` text,
	`tray_session_id` integer,
	`description` text NOT NULL,
	`created_by` integer,
	`acknowledged_by` integer,
	`resolved_by` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP,
	`acknowledged_at` text,
	`resolved_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tray_session_id`) REFERENCES `smart_tray_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acknowledged_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
