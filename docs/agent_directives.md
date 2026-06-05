# AI Agent Directives & Coding Standards

**CRITICAL RULE: NO FLOATING POINT MATH FOR CURRENCY OR WEIGHTS.**
* **Currency:** All currency values must be stored in the database and processed in the backend as **Paise** (integers). E.g., â‚¹1,500.50 is stored as `150050`. Format to Rupees only at the React UI render layer.
* **Weights:** All physical weights must be stored in the database and processed as **Milligrams** (integers). E.g., 10.500 grams is stored as `10500`. Format to Grams only at the React UI render layer.
* **Why:** Floating-point rounding errors will cause financial discrepancies. This is a zero-tolerance policy.

**Drizzle ORM Rules:**
* Always use strict typing.
* Do not use raw SQL queries unless explicitly required for a complex reporting fallback. Use Drizzle's relational query builder.
* Wrap multi-table inserts (like creating an Invoice and updating Item Status) in database transactions (`db.transaction()`) to prevent orphaned records if a crash occurs.

**Hardware Fallbacks:**
* If the RS232 weighing scale disconnects, the UI must gracefully fall back to a manual weight input field with a visual warning indicator, rather than crashing the POS screen.

**React UI Rules:**
* Prefer controlled components for all forms.
* Keep the UI high-contrast and dense (desktop-friendly). Shop owners want to see maximum data on one screen withou
