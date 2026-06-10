ALTER TABLE girvi_loans ADD COLUMN redemption_deadline TEXT;
--> statement-breakpoint
ALTER TABLE organization_settings ADD COLUMN girvi_redemption_months INTEGER NOT NULL DEFAULT 12;
--> statement-breakpoint
ALTER TABLE organization_settings ADD COLUMN auto_greetings_enabled INTEGER NOT NULL DEFAULT 0;
