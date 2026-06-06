# 03 — Item Addition & Inventory

**Prerequisite:** Logged in as admin. Stock here feeds POS billing.

Item weights are stored in **milligrams** internally and rates in **paise**, but the UI works in
grams and rupees — verify the conversions are correct (a common bug source).

---

## A. Happy-path: add an item via Item Master
1. Sidebar → **Inventory** (Item Master + rates dashboard).
2. Add a new item. The Item Master form fields are: **Barcode** (blank ⇒ auto-set to the HUID), **Category** (dropdown), **Metal**, **Purity** (dropdown), **Gross**, **Stone**, **Charge Type**, **Making Charge**, **HUID**, **Image**.
   - Category: `Ring`, Metal: `Gold`, Purity: `22K`
   - Gross weight: `10.000 g`, Stone weight: `0`
   - Charge type: per gram, Making charge: `120` /g
   - HUID: `TST001` (must be exactly **6 alphanumeric** chars)
3. Save.
4. **Expected:** item appears in stock list as IN_STOCK; **net weight = gross − stone** computed automatically (10.000 g); Print Tag offered.
   - Note: **Location** and **Status** are not set here — they live on the **Barcode Desk**; status is driven by the sales flow, not entered manually.

## B. Item groups / definitions
1. Create a new **item group** (e.g. `Bangles`).
2. Create an **item definition/template** under it.
3. **Expected:** new group selectable when adding items.

## C. Barcode (Barcode Stock Desk)
1. Sidebar → **Barcode**.
2. Get the **next barcode** number, then create a barcoded stock entry.
3. **Expected:** unique barcode assigned; item scannable/lookup-able by that barcode.

## D. Stones / certificates
1. Open an item → **Edit** → **Gemstones & Diamonds** tab. Add a stone (type, shape, carats, color/clarity/cut, lab, certificate #, rate/carat) → **Save Stones to Item**.
2. **Expected — persistence:** close and reopen the item → the stone is **still listed**, and net weight stays reduced (e.g. a 1 ct stone on a 10 g item → net 9.800 g; 1 ct = 200 mg).
3. **Expected — certificate lookup:** the certificate number is findable via the **Certificate Lookup** (returns the item).
4. **If it does NOT persist:** open the browser **Network tab**, redo the save, and capture the `POST /api/inventory/items/:id/stones` **status + response body**. The backend is covered by a passing regression test (`tests/api/item-stones.test.ts`), so a failure here is almost certainly a client/transport issue — the captured response will pinpoint it.

## E. Stock verification (physical audit)
1. Inventory → start a **stock verification** session.
2. Scan/enter a couple of seeded barcodes (e.g. `A1B2C3`, `G7H8I9`).
3. Complete the session (admin) and view the report.
4. **Expected:** report shows scanned vs expected, flags any not-found.

---

## F. Edge cases — item data

| # | Input / action | Expected |
|---|----------------|----------|
| F1 | Gross weight `0` | Rejected — an item must have weight |
| F2 | Stone weight **greater than** gross weight | Rejected — net weight can't be negative |
| F3 | Negative weight `-5` | Rejected |
| F4 | Non-numeric weight `abc` | Rejected / not accepted in field |
| F5 | Purity `0` or `99` karat | **N/A via UI:** purity is a fixed dropdown (14/18/20/22/24K), so out-of-range karat can't be entered. (The backend still lacks a karat-range check, but it isn't reachable from this form.) |
| F6 | Weight with 4+ decimals `10.12345 g` | Rounded sensibly to mg; record precision |
| F7 | Duplicate **barcode** (reuse `A1B2C3`) | Blocked — barcodes must be unique |
| F8 | Duplicate **HUID** | Blocked — HUID must be unique |
| F9 | Empty design name | **N/A:** Item Master has no design-name field. |
| F10 | Huge making charge (₹10,00,000/g) | Accepted but sane; no overflow |
| F11 | Add item, then change status to SOLD/MELTED manually | **Likely not exposed:** the item PATCH endpoint only edits online-publishing fields, not `status`. Status moves to SOLD via the sales flow. Also "MELTED" is not a valid status (only IN_STOCK/SOLD/IN_MEMO). Record whether the UI offers a manual status change at all. |
| F12 | Stock verification: scan a barcode that doesn't exist | Flagged as unexpected/foreign item, no crash |

## G. Conversion checks (important)
| # | Check | Expected |
|---|-------|----------|
| G1 | Enter 12.5 g → reopen item | Shows 12.5 g (not 12500 or 0.0125) |
| G2 | Making charge ₹120/g on 10 g | Computes ₹1,200 making, not ₹12 or ₹120000 |

## H. What to report
- PASS/FAIL per row + the exact error text.
- Confirm net-weight auto-calc and gram↔mg / rupee↔paise conversions are correct (G1, G2).
- Screenshot of a created item and the stock-verification report.
