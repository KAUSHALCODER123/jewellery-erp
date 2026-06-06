# 11 — Karigar (Manufacturing Jobs) + Repairs

**Prerequisite:** Logged in as admin; karigars exist (seeded: Ramesh, Suresh). For transfer-to-stock,
HUID-aware checkout matters later (test 04). ⚠️ Cancel/receive adjust the karigar's metal ledger — use a test DB.

Karigar = giving raw metal to an artisan to make an item, then receiving the finished piece back and
reconciling **fine-gold in vs out** (with a wastage allowance). Repairs = a simpler intake-to-delivery desk.

> ℹ️ Job status flow: **PENDING → WIP → COMPLETED** (or **CANCELLED**). The artisan carries a running
> **fine-gold liability** that goes up on issue and down on receipt.

---

## A. Happy-path: issue raw metal
1. Sidebar → **Karigar** → tab **Issue Raw Metal**.
2. Order: Job Slip No. (auto or manual), Customer (optional), Artisan (e.g. `Ramesh`).
3. Material: Job Name, Target Purity %, Target Weight (g), Metal Type **GOLD**, Gross Weight Issued (g) `50`, Purity/Tunch % `91.6`, optional design image.
4. Confirm the **Fine Gold Equivalent** preview (≈ 45.8 g).
5. Click **Issue Raw Metal**.
6. **Expected:** job created/advanced to **WIP**; the karigar's **fine gold balance increases** by the issued fine gold.

## B. Receive finished job
1. Tab **Receive Finished Job** → select the active WIP job.
2. Receipt: Final Gross (g) `48`, Stone/Less (g) `0`, Net auto-calcs, Scrap/Dust (g) `1`, Scrap Purity %,
   Wastage Mode (**PERCENTAGE** / **PER_GRAM**), Allowance % (e.g. `2`), Labor Charge (₹).
3. Watch the **Accountability Engine** preview (Fine Recovered / Actual Loss / Acceptable Allowance / Labor).
4. Click **Receive Finished Job**.
5. **Expected:** job → **COMPLETED**; karigar fine balance reduced by recovered fine; if loss exceeds the allowance, an **EXCESS METAL LOSS** warning shows and the excess is debited back to the karigar (anomaly flagged).

## C. Transfer completed job to stock (barcode)
1. In **Karigar Ledgers** (select the karigar) find the received job marked **Pending Stock**.
2. Click **Transfer to Barcode**: assign barcode (unique), optional HUID (6 uppercase alphanumeric), marking charge type **PER_GRAM**/**FLAT**.
3. **Expected:** a new **IN_STOCK** item is minted from the job; the receipt row flips to **Transferred**.

## D. Print job slip
1. In Karigar Ledgers, on a receipt click **Print Slip**.
2. **Expected:** `karigar-slip-{order_number}.pdf` renders (issues + receipts for that job).

## E. Repairs desk
1. Sidebar → **Repairs** → **New Intake**.
2. Customer (required), Description (required), Estimate (₹), Intake date, Delivery date (optional) → **Create Intake**.
3. **Expected:** repair created status **RECEIVED**.
4. Advance it: **Move to WIP** → **Move to READY** → **Deliver** (on delivery, optionally capture actual charge).
5. **Expected:** status flow RECEIVED → WIP → READY → DELIVERED; filter tabs (All/Received/In Progress/Ready/Delivered) count correctly.

---

## F. Edge cases — karigar

| # | Input / action | Expected |
|---|----------------|----------|
| F1 | Issue metal to a non-existent karigar | Rejected |
| F2 | Issue with gross weight `0` | Rejected |
| F3 | Receive a job with **no prior issue** | Blocked — must have material issued first |
| F4 | Receive with huge loss (e.g. recovered 40 g of 45.8) | **Excess loss** warning; excess debited to karigar; anomaly flagged |
| F5 | Cancel a **WIP/PENDING** job | Allowed — issued metal returned to karigar (balance restored) |
| F6 | Cancel a **COMPLETED** job | Blocked — only PENDING/WIP can cancel |
| F7 | Transfer-to-barcode a **non-COMPLETED** job | Blocked — must be COMPLETED |
| F8 | Transfer with a **duplicate barcode** | Blocked — barcode must be unique |
| F9 | Transfer with HUID `abc` (bad format) | Rejected — 6 uppercase alphanumeric |
| F10 | Transfer the **same receipt twice** | Second blocked — already transferred |
| F11 | Hand-check fine = floor(gross × purity / 100) | Matches the app |

## G. Edge cases — repairs

| # | Input / action | Expected |
|---|----------------|----------|
| G1 | Intake with no customer / blank description | Rejected |
| G2 | Move a DELIVERED repair further | Blocked — terminal state |
| G3 | Deliver with an actual charge different from estimate | Actual charge stored on delivery |

## H. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| H1 | Karigar metal ledger after issue then receive | Debit on issue, credit on receipt; net = retained loss/allowance |
| H2 | Cancel a WIP job | Ledger shows the returned metal (JOB_CANCELLATION entry) |
| H3 | After transfer-to-barcode, open Inventory | New item present, IN_STOCK, with the right purity/metal |
| H4 | Day Book → Karigar issued / received (fine mg) | Reflects today's issues & receipts |

## I. What to report
- PASS/FAIL per row + exact error text.
- One **hand-checked fine-gold** calc on issue (F11) and one **loss/allowance** reconciliation on receive.
- Confirm excess-loss path debits the karigar (F4) and cancel restores metal (F5/H2).
- Confirm transfer can't be double-run (F10) and mints exactly one stock item (H3).
- Screenshot: karigar job slip PDF.
