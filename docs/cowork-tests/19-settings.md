# 19 — Settings (Rates, Loyalty, Tally, e-Commerce, Print Language, Firms)

**Prerequisite:** Logged in as admin (most writes are admin-only).
⚠️ Deactivating a firm is a **soft delete** (kept for history) — but don't deactivate the firm you log
in with on a real DB. Rate changes affect every valuation downstream — use a test DB.

Covers metal **rates** (manual + live sync), **loyalty** rules, **Tally** integration, **e-commerce**
catalog export/webhook, **print language**, and **firms/entities** management.

> ℹ️ Rates are stored in **paise**; the e-commerce catalog prices items live from these rates
> (metal value + making + 3% GST). The webhook secret is write-only (never returned).

---

## A. Metal rates
1. Open the **Rates** dashboard (InventoryRatesDashboard, "Daily Rates Control").
2. Edit Gold 24K / 22K / 18K / Silver (rupees, 2 decimals) → **Save & Update Rates**.
3. Click **Sync Live MCX Rates** → live fetch updates all four + shows source/timestamp.
4. **Expected:** rates persist; "Live MCX rates synced." on success; non-admin sees read-only.

## B. Loyalty rules
1. Settings → Loyalty Earning Rules.
2. Earning Mode: **Per ₹100 of net payable** or **Per gram of gold**; set Points per ₹100 and Points per gram → **Save Loyalty Rules**.
3. **Expected:** saved; subsequent POS sales earn per the chosen mode (cross-check test 04).

## C. Tally integration
1. Settings → Tally Prime XML Gateway.
2. Tick **Enable Tally Gateway Synchronization**; set Gateway URL (`http://localhost:9000`) and Company Name (must match Tally exactly) → **Save Tally Configuration**.
3. **Expected:** config saved. (Actual sync fires on voucher creation / Export Tally in Accounts, test 13.)

## D. e-Commerce catalog + webhook
1. Settings → e-Commerce Sync & Webhook.
2. Set Storefront Webhook Sync URL and Webhook Secret Key → **Save Configuration**.
3. Click **Preview Catalog Export** → downloads JSON of published items ("Catalog export downloaded (X published items)").
4. **Expected:** only **IN_STOCK + published-online** items appear; each has a live-calculated `final_selling_price_paise` (metal + making + 3% GST). The secret shows as "configured — leave blank to keep" and is **never** returned in plaintext.

## E. Print language
1. Settings → Print Language → choose **English / मराठी / हिंदी / ગુજરાતી**.
2. **Expected:** "Active" badge moves; a note warns Indic fonts must exist in `fonts/` or PDFs won't render those scripts. (Verify by printing a doc, test 16.)

## F. Firms / entities
1. Settings → **Firms & Company Entities** (FirmsManager) → **Add Firm**.
2. Firm/Entity Name (required), GSTIN, Contact Number, Address → **Create Firm**.
3. **Expected:** firm listed Active, with an auto-generated internal **key** (slug). GSTIN validated to the 15-char pattern.
4. **Edit** the firm (change name → key regenerates) → **Save**.
5. **Deactivate** a non-login firm (confirm dialog) → status **Inactive** (soft delete; invoices keep firm_id).

---

## G. Edge cases

| # | Input / action | Expected |
|---|----------------|----------|
| G1 | Rate set to `0` or blank | Record — rejected or zero valuation downstream |
| G2 | Rate with > 2 decimals / non-numeric | Rejected / rounded (decimal-to-integer parse) |
| G3 | Live sync when provider unreachable | 502 — error shown, old rates kept |
| G4 | Loyalty points per ₹100 negative | Rejected (≥0) |
| G5 | Loyalty mode invalid value | Rejected — only the two modes |
| G6 | Firm with blank name | Rejected |
| G7 | Firm GSTIN in wrong format | Rejected — must match 15-char GSTIN pattern |
| G8 | **Deactivate the only active firm** | Blocked (409) — "Cannot deactivate the only active firm." |
| G9 | Print language not in {english, marathi, hindi, gujarati} | Rejected |
| G10 | e-Commerce: save with blank secret when one is already set | Existing secret kept (not wiped) |
| G11 | Non-admin attempts any save here | Blocked (admin-only writes) |

## H. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| H1 | After a rate change, check POS line / Rates Dashboard valuations | Use the new rate |
| H2 | After loyalty change, do a POS sale | Points earned match the new rule (test 04) |
| H3 | Catalog export count vs IN_STOCK + published items | Matches |
| H4 | Add a firm → log out → login firm dropdown | New firm selectable; deactivated firm hidden |
| H5 | Firm GSTIN flows into GST/e-invoice | Used as the seller GSTIN (tests 14) |

## I. What to report
- PASS/FAIL per row + exact error text.
- Confirm the **last-active-firm** guard (G8) — important safety rule.
- Confirm the webhook secret is write-only / never echoed (D, G10) and admin-only writes (G11).
- Confirm a rate change actually propagates to valuations and catalog pricing (H1/H3).
- Screenshots: catalog export JSON, the firm list with one Active + one Inactive entity.
