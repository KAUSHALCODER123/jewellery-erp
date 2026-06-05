CREATE TABLE `kyc_vault` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`customer_id` integer NOT NULL,
	`document_type` text NOT NULL,
	`document_number_masked` text NOT NULL,
	`document_image_path` text,
	`uploaded_at` text DEFAULT CURRENT_TIMESTAMP,
	`verified_by` integer,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
