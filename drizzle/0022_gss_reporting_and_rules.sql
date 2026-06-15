ALTER TABLE gss_templates ADD COLUMN scheme_type TEXT NOT NULL DEFAULT 'CASH';
--> statement-breakpoint
ALTER TABLE gss_templates ADD COLUMN is_variable INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE gss_templates ADD COLUMN min_monthly_amount_paise INTEGER;
--> statement-breakpoint
ALTER TABLE gss_templates ADD COLUMN max_monthly_amount_paise INTEGER;
--> statement-breakpoint
ALTER TABLE gss_accounts ADD COLUMN gold_weight_accumulated_mg INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE gss_accounts ADD COLUMN redeemed_invoice_id INTEGER REFERENCES invoices(id);
--> statement-breakpoint
ALTER TABLE gss_accounts ADD COLUMN redeemed_at TEXT;
--> statement-breakpoint
ALTER TABLE gss_receipts ADD COLUMN gold_rate_per_gram_paise INTEGER;
--> statement-breakpoint
ALTER TABLE gss_receipts ADD COLUMN gold_weight_credited_mg INTEGER;
