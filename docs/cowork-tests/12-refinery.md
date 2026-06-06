# 12 — Refinery Management (Scrap Melting & Fine Recovery)

**Prerequisite:** Logged in as admin. For "Melt Ingested Old Gold", ingested URD stock exists (test 08).
⚠️ Receiving fine gold can **mint a bullion stock item** — use a test DB.

Refinery = sending scrap/old gold OUT to a refiner (outward challan), then receiving purified **fine
gold** back IN (minus refining charges). The app tracks a per-refinery **fine-gold balance** and **cash balance**.

> ℹ️ Tabs: Refineries & Balance · Issue Scrap (Outward) · Receive Fine (Inward) · Refinery Ledgers.
> Ledger event types are **TRANSFER** (out) and **RECEIPT** (in). Note: refinery purity uses a simple
> **percentage** (e.g. 91.6), not basis points.

---

## A. Add a refinery
1. Sidebar → **Refinery** → tab **Refineries & Balance**.
2. Add New Refinery: Name (required) `Pune Refiners`, Phone (optional) → **Add Refinery**.
3. **Expected:** refinery listed with Fine Gold Balance 0 mg, Cash Balance ₹0.

## B. Issue scrap (outward) — manual
1. Tab **Issue Scrap (Outward)** → mode **Manual Scrap Entry**.
2. Refinery Destination: `Pune Refiners`; Metal Type; Gross Weight (g) `100`; Average Purity / Tunch % `90`; Notes.
3. Confirm the **Valuation Engine** Fine Weight Preview (≈ 90 g).
4. Click **Issue Scrap Metal**.
5. **Expected:** transfer recorded; refinery fine-gold balance **+90 g**; a **Print Challan** button appears.

## C. Issue scrap (outward) — melt ingested old gold
1. Same tab → mode **Melt Ingested Old Gold**.
2. Select an ingested URD voucher/purchase from the table (radio), add melting notes.
3. Click **Melt & Send to Refinery**.
4. **Expected:** that old-gold stock item is sent to the refinery (cross-check it leaves stock); transfer added to the refinery balance.

## D. Receive fine (inward)
1. Tab **Receive Fine (Inward)** → Refinery Source `Pune Refiners`.
2. Fine Gold Received (g) `89`; Refining Charges (₹) `500`; Payment Mode (**CASH / NEFT / UPI / JOURNAL_DEBIT**); Notes.
3. (Optional) tick **Add returned fine gold to master stock as a 24K bullion bar** → Bullion Barcode (auto `FINE-24K-R##`), Stock Location (default VAULT).
4. Click **Receive Fine Metal**.
5. **Expected:** refinery fine balance **−89 g**, cash balance **+₹500**; if the checkbox was on, a **24K bullion item** is minted IN_STOCK.

## E. Refinery ledger
1. Tab **Refinery Ledgers** → select `Pune Refiners`.
2. **Expected:** timeline (newest first) with TRANSFER (+fine) and RECEIPT (−fine, +cash) rows and **running balances**; print challan available for transfers.

---

## F. Edge cases

| # | Input / action | Expected |
|---|----------------|----------|
| F1 | Add refinery with blank name | Rejected |
| F2 | Issue scrap with no refinery selected | Rejected |
| F3 | Gross weight `0` / negative | Rejected (positive integer mg) |
| F4 | Purity `0` or `> 100` | Rejected (0 < tunch ≤ 100) |
| F5 | Melt mode with no ingested items | Shows "No ingested old-gold stock items found…" empty state |
| F6 | Receive **more fine than the refinery balance** | Record — does balance go negative or block? |
| F7 | Receive with negative charges | Rejected (non-negative) |
| F8 | Bullion with a **duplicate custom barcode** | Blocked — must be unique |
| F9 | Receive fine `0` with "add to stock" checked | Record — no bullion minted when received = 0 |
| F10 | Hand-check fine = round(gross × tunch / 100) | Matches the app |

## G. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| G1 | After manual issue + receive | Ledger running balance = issued − received fine; cash = sum of charges |
| G2 | After "Melt Ingested" (C) | The old-gold item is gone from sellable stock; URD status REFINERY_SENT (test 08) |
| G3 | After receive with bullion mint (D) | New 24K bullion item in Inventory (category Bullion / Fine Gold, purity 24) |
| G4 | Day Book | Refining charge cash-out reflected |

## H. What to report
- PASS/FAIL per row + exact error text.
- One **hand-checked fine recovery** (gross × tunch%) vs the app (F10).
- Confirm the round-trip balance math (G1) and bullion minting (G3).
- Note the percentage-vs-basis-points purity difference from Karigar (potential confusion point).
- Screenshot: refinery transfer challan PDF.
