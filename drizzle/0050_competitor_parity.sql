ALTER TABLE customers ADD COLUMN is_blacklisted INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE customers ADD COLUMN blacklist_reason TEXT;
--> statement-breakpoint
CREATE TABLE customer_metal_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  metal_type TEXT NOT NULL,
  fine_weight_mg INTEGER NOT NULL DEFAULT 0,
  direction TEXT NOT NULL DEFAULT 'TO_RECEIVE',
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
CREATE TABLE supplier_metal_balances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  metal_type TEXT NOT NULL,
  fine_weight_mg INTEGER NOT NULL DEFAULT 0,
  direction TEXT NOT NULL DEFAULT 'TO_RECEIVE',
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
--> statement-breakpoint
ALTER TABLE suppliers ADD COLUMN opening_balance_paise INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE suppliers ADD COLUMN opening_balance_type TEXT NOT NULL DEFAULT 'CREDIT';
--> statement-breakpoint
ALTER TABLE purchase_invoices ADD COLUMN tds_percent REAL NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE purchase_invoices ADD COLUMN tds_amount_paise INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE organization_settings ADD COLUMN moneylending_licence_number TEXT;
--> statement-breakpoint
ALTER TABLE organization_settings ADD COLUMN moneylending_licence_authority TEXT;
--> statement-breakpoint
ALTER TABLE organization_settings ADD COLUMN moneylending_licence_expiry TEXT;
--> statement-breakpoint
ALTER TABLE items ADD COLUMN stock_form TEXT NOT NULL DEFAULT 'TAGGED';
