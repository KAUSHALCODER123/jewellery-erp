# 07 — Approval Memo (Jangad / Sale-or-Return)

**Prerequisite:** Logged in as admin; customers exist (test 02); **IN_STOCK** items exist (test 03).
⚠️ Issuing a memo **reserves real stock** (items move to ON_APPROVAL). Use a test DB.

Approval Memo = sending items OUT on approval (to a customer in-shop, another jeweller, or an
exhibition) without selling them — then either **returning** them to stock or **converting** them to a sale.

---

## A. Happy-path: issue a memo
1. Sidebar → **Approval Memo** → tab **Issue New Memo**.
2. Left panel:
   - Memo type: **Customer Approval (in-shop)** or **Outward / Other Jeweller / Exhibition**.
   - Party / customer name (required): `Rahul Sharma`.
   - Phone (optional), Issue date, Expected return date, Notes.
3. Middle panel: search **available items** (by barcode / design / metal), click **+** to add 1–2 items to the draft.
4. Right panel: optionally enter an **est. value** per item; confirm total gross weight shows.
5. Click **Issue Memo & Reserve Stock**.
6. **Expected:** confirm a **next memo number** (`MEMO-NNNN`) was suggested; memo created status **OPEN**; the added items flip to **ON_APPROVAL** (location ON_APPROVAL) and disappear from available stock / POS.

## B. Return to stock
1. Tab **Memo Register** → open the OPEN memo.
2. Click **Return All to Stock**.
3. **Expected:** lines change OUT → **RETURNED**; items go back to **IN_STOCK** (location VAULT); memo status becomes **CLOSED** (no OUT lines, none sold).

## C. Convert to sale
1. Issue a fresh memo with 1 item (repeat A).
2. In Memo Register, click **Mark All Sold**.
3. **Expected:** lines OUT → **SOLD**; items marked SOLD; memo status becomes **CONVERTED**.

---

## D. Edge cases — issue

| # | Input / action | Expected |
|---|----------------|----------|
| D1 | Party name blank | Rejected (party name required) |
| D2 | No items added | Rejected (≥1 line required) |
| D3 | Add an item that is **not IN_STOCK** (already SOLD/ON_APPROVAL) | Blocked — only IN_STOCK items are selectable/accepted |
| D4 | Issue the **same item on two memos** | Second blocked — item already reserved |
| D5 | Expected return date before issue date | Record behaviour |

## E. Edge cases — return / convert

| # | Input / action | Expected |
|---|----------------|----------|
| E1 | Try to return a line that is already RETURNED/SOLD | Blocked — only OUT lines can be returned |
| E2 | Try to convert a line already RETURNED/SOLD | Blocked — only OUT lines convert |
| E3 | Return part, then check status | Record — UI only offers "all" actions (per-line is a known gap); after partial state, status should read **PARTIAL** |
| E4 | After Return All, sell the item normally in POS | Allowed — item is back IN_STOCK |
| E5 | After Mark All Sold, try to sell the same item in POS | Blocked — item already SOLD |

## F. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| F1 | Status derivation: all OUT | OPEN |
| F2 | Some OUT + some SOLD/RETURNED | PARTIAL |
| F3 | No OUT, all RETURNED | CLOSED |
| F4 | No OUT, ≥1 SOLD | CONVERTED |
| F5 | Inventory / Barcode Desk while items are out | Reserved items show ON_APPROVAL, not available to sell |

## G. What to report
- PASS/FAIL per row + exact error text.
- Confirm stock is genuinely reserved on issue (D3/D4/F5) and freed on return (E4).
- Confirm the four status states derive correctly (F1–F4).
- Note the known gap: only "Return All / Mark All Sold" — no per-line return/convert in the UI (E3).
