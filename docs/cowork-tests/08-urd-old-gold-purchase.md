# 08 — URD / Old-Gold Purchase (+ Wholesale Purchase Invoice)

**Prerequisite:** Logged in as admin. For refinery transfer, at least one refinery exists (test 12).
⚠️ Ingesting and refinery transfer **create/mutate real stock**. Use a test DB.

URD = buying old/used gold from a walk-in customer (Unregistered Dealer), capturing KYC, then either
**ingesting** it as a stock item or **melting** it via a refinery. This file also covers the
**wholesale Purchase Invoice** (buying new stock from a supplier).

> ℹ️ The standalone URD workspace has **three tabs**: New Standalone Voucher · Standalone Registry ·
> POS Exchange Registry. Stock status flows **PENDING → INGESTED → REFINERY_SENT**.

---

## A. Happy-path: standalone URD voucher
1. Sidebar → **URD / Old Gold** → tab **New Standalone Voucher**.
2. Purchase Details:
   - Customer Name (required): `Walk-in Seller`, Mobile (optional), Date (today).
   - Metal: **Gold**; Description: `Old Gold Purchase`.
   - Tunch (Purity %): `91.6`; Gross Wt (g): `10`; Stone Wt: `0`; Black Bead Wt: `0`.
   - Purchase Rate / g (₹): `6500`; Payment Mode: **CASH**.
3. Stronger KYC Details: PAN `ABCDE1234F` (optional), Aadhaar `123412341234` (optional), optional ID scan upload.
4. Confirm computed **Net Wt / Fine Wt / Purchase Value** look right.
5. Click **Save URD Voucher**.
6. **Expected:** voucher saved; appears in **Standalone Registry** with KYC = UNVERIFIED, Stock = PENDING; **Print** legal receipt available.

## B. KYC → Ingest → Refinery
1. In Standalone Registry, on the new voucher click **Verify KYC** → KYC badge becomes **VERIFIED**.
2. Click **Ingest Stock** → modal: Assign Barcode (auto `URD-…`), Storage Location (default `OLD_GOLD_VAULT`) → **Confirm Ingest**.
3. **Expected:** a stock item is created (category *Old Gold / URD*, `is_urd_recycled_gold = true`, IN_STOCK); status becomes **INGESTED**.
4. Click **Melt / Refinery** → pick Refinery Destination, notes → **Send to Refinery**.
5. **Expected:** status **REFINERY_SENT**; the item is marked melted/sent (cross-check in Refinery ledger, test 12).

## C. POS Exchange Registry
1. (After a POS sale used an old-gold exchange — see test 04.) Open tab **POS Exchange Registry**.
2. **Expected:** the exchange purchase appears; same **Ingest Stock** / **Melt / Refinery** actions work as in B.

## D. Wholesale Purchase Invoice (supplier stock-in)
1. Sidebar → **Purchase Invoice**.
2. Supplier: pick existing, or **+ Add New Supplier** (Name / Phone / GSTIN → Save).
3. Invoice: Ref Bill No (optional), Purchase Date.
4. **+ Add Line**: Category, Metal `Gold`, Purity `22K`, Stock As **Pieces (1 tag each)** or **Lot (1 tag, total wt)**, Qty, Gross Wt, Stone/Less, Rate/g, Making, GST.
5. Settlement: payment mode **Credit / Cash / Bank / UPI**; confirm GST total + Total Payable.
6. Click **Save & Add to Stock**.
7. **Expected:** stock items created (PIECES → one per qty; LOT → a single tagged lot); a **balanced accounting voucher** is posted.

---

## E. Edge cases — URD voucher

| # | Input / action | Expected |
|---|----------------|----------|
| E1 | Gross weight `0` or blank | Rejected (gross weight required) |
| E2 | Purchase rate blank | Rejected (rate required) |
| E3 | Stone + black-bead weight ≥ gross | Net/fine should not go negative — record |
| E4 | PAN in wrong format (`ABC123`) | Rejected — must match `^[A-Z]{5}[0-9]{4}[A-Z]$` |
| E5 | Aadhaar not 12 digits | Rejected — must be exactly 12 digits |
| E6 | **Ingest before Verify KYC** | Blocked — KYC must be verified first |
| E7 | Ingest the **same voucher twice** | Second blocked — already ingested |
| E8 | **Refinery transfer before ingest** | Blocked — must ingest first |
| E9 | Transfer to refinery twice | Second blocked — already transferred |
| E10 | Force a duplicate barcode on ingest | Blocked — barcode must be unique |

## F. Edge cases — purchase invoice

| # | Input / action | Expected |
|---|----------------|----------|
| F1 | Save with no supplier | Blocked — supplier must exist |
| F2 | Line with gross/net weight missing | Rejected |
| F3 | Purchase date inside a **locked GST period** (test 14) | Blocked — audit lock |
| F4 | LOT mode with Qty > 1 | Qty disabled in LOT mode → exactly 1 tag created |
| F5 | PIECES mode, Qty `3` | Exactly 3 barcoded items created |

## G. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| G1 | After ingest, open Inventory | New old-gold item present, IN_STOCK, in OLD_GOLD_VAULT |
| G2 | After refinery transfer, open Refinery ledger | A TRANSFER entry with the fine weight (test 12) |
| G3 | After purchase invoice (Credit), open Accounts → supplier outstanding | Supplier payable increased |
| G4 | After purchase invoice, open Day Book | Purchase + cash/bank payment recorded |
| G5 | GSTR-2 (test 14) | URD vouchers + POS URD appear at 0% GST; supplier purchases appear with GST |

## H. What to report
- PASS/FAIL per row + exact error text.
- Confirm the **KYC → ingest → refinery** gate ordering (E6/E8) — critical.
- Confirm ingest can't be double-run and creates exactly one stock item (E7, G1).
- Confirm PIECES vs LOT item counts (F4/F5) and the purchase posts balanced accounting (G3/G4).
- Screenshots: URD legal receipt PDF, a purchase that landed in stock.
