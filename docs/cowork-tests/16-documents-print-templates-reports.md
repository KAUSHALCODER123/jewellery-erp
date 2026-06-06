# 16 — Documents, Print Templates & Report Builder

**Prerequisite:** Logged in as admin. Data from earlier tests (invoices, loans, GSS, items) makes the
PDFs and reports meaningful. Non-destructive module — read/generate only.

Three things here: the **document/PDF catalogue** (invoices, receipts, deeds, labels, slips),
the **Print Template Builder** (customise invoice/receipt/label layouts), and the **Report Builder**
(ad-hoc pivot reports + CSV export).

> ℹ️ PDF links carry a `?token=` so the browser can open them; many are reached from buttons inside
> their own modules (Documents → … is also referenced in `00-UI-GAPS.md`).

---

## A. Document / PDF catalogue
Generate and visually confirm each renders (open from its module's print button):

| Document | From |
|----------|------|
| Invoice A4 / A5 / Thermal | POS / Documents |
| Invoice with custom template | POS (uses default template) |
| Item barcode label | Inventory / Barcode Desk |
| Girvi Pavati, Release receipt, Legal notice, Repayment receipt | Girvi (test 05) |
| URD voucher | URD workspace (test 08) |
| GSS receipt | Gold Scheme receipt modal (test 10) |
| Journal voucher | Accounts (test 13) |
| Karigar job slip | Karigar ledger (test 11) |
| Refinery challan | Refinery after issue (test 12) |
| Stock-verification report | Barcode Desk |
| HUID PVC card | GST Reports → HUID Inventory (test 14) |

**Expected:** each opens as a PDF (or print-ready HTML for the HUID card) with correct data and totals.

## B. Print Template Builder
1. Sidebar → **Print Templates** (PrintTemplateBuilder).
2. **New Template** (or edit existing). Identity: Template Name, Document (**Invoice/Receipt/Label**), Paper Size (A4/A5/THERMAL_80 for invoices; LABEL_50X25/LABEL_65X35 for labels), Font Size.
3. Toggles: Logo / Header / Footer. Branding Colors: Header Background, Header Text (hex). Header Lines, Footer Text.
4. **Drag to reorder** Invoice Fields and Line Columns. Watch the **live preview** update.
5. Tick **Set as default** → **Save Template**.
6. **Expected:** template saved; if default, other templates of the same document type lose default; the layout is honoured when you next print that document type.

## C. Report Builder
1. Sidebar → **Report Builder**.
2. Data Source: **Sales Invoices / Inventory Catalog / Girvi Pawn Register / Gold Schemes / Double-Entry Journal**.
3. Select Columns (≥1). Set Filters: Start/End Date, keyword, Record Status/Type, and (for Inventory) Metal Purity + Category.
4. Click **Build Report**.
5. **Expected:** KPI cards (Record Count / Money Valuation / Metal Weight / Principal) + a results table; cells formatted as ₹ / g / date / %.
6. **Pivot:** set **Group Rows By** + **Aggregate Sum Of** → table collapses to Group / Row Count / Sum of {field}.
7. **Export CSV** and **Print View**.
8. **Expected:** CSV downloads (`custom_{source}_report_{date}.csv`) with the right headers (grouped vs raw).

---

## D. Edge cases — templates

| # | Input / action | Expected |
|---|----------------|----------|
| D1 | Save template with blank name | Record (defaults to "New Retail Template"?) — note behaviour |
| D2 | Change Document type Invoice → Label | Paper Size resets to a label size; field list switches to item.* tokens |
| D3 | Invalid hex color (`#zzz`) | Rejected / defaulted — record |
| D4 | Two defaults for same document type | Only the latest stays default |
| D5 | Reorder columns then print | Printed line columns follow the new order |

## E. Edge cases — reports

| # | Input / action | Expected |
|---|----------------|----------|
| E1 | Build with **0 columns** selected | Blocked — keep ≥1 column |
| E2 | Group By with **Count Only** (no aggregate) | Shows group + row count, no sum column |
| E3 | Date range with no matching rows | Empty state, Export/Print disabled |
| E4 | Keyword search | Filters via LIKE on that source's relevant fields |
| E5 | Status filter (e.g. Items → SOLD) | Only SOLD rows returned |
| E6 | CSV with values containing commas/quotes | Properly escaped (quotes doubled) |

## F. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| F1 | Report Builder Sales total vs Day Book sales | Match for the same date range |
| F2 | Report Builder Inventory IN_STOCK count vs Rates Dashboard | Same count |
| F3 | Custom template used on a real invoice | Header/footer/colors/fields match the builder |
| F4 | Daybook-summary report vs Accounts Day Book | Same totals (test 13) |

## G. What to report
- PASS/FAIL per row.
- Confirm every document in table A renders without error (list any that fail).
- Confirm template default-switching (D4) and that a saved layout actually changes printed output (F3).
- Confirm report grouping/aggregation and CSV escaping (E2/E6), plus one totals reconciliation (F1).
- Screenshots: one custom-template invoice, one grouped report.
