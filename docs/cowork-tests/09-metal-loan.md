# 09 — Metal Loan (Gold-on-Loan from Suppliers)

**Prerequisite:** Logged in as admin; at least one supplier exists (create one in URD/Purchase, test 08).
Metal Loan = borrowing physical gold from a supplier as **fine grams owed**, then later **fixing the
rate** on some/all of that fine weight to convert it into a rupee payable.

> ℹ️ The unit of debt is **fine gold (grams)**, not rupees, until you "fix" it. Status flows
> **UNFIXED → PARTIALLY_FIXED → FIXED**.

---

## A. Happy-path: record a metal loan
1. Sidebar → **Metal Loan** → tab **New Metal Loan**.
2. Confirm a **next loan number** (`ML-NNNN`) is suggested.
3. Fill the form:
   - Existing Supplier (select) **or** …or New Supplier Name.
   - Issue Date (today), Metal (default `Gold`), Purity % `99.99`, Gross Weight (grams) `100`.
   - Notes (optional).
   - Confirm the help text shows the calculated **fine gold owed** (≈ 99.99 g).
4. Click **Record Metal Loan**.
5. **Expected:** loan created, status **UNFIXED**; appears in Loan Register; summary boxes (Fine Gold Owed / Open Loans / Fixed Value) update.

## B. Partial rate fix
1. Tab **Loan Register** → expand the loan → click **Fix Rate**.
2. Leave **Fix all** unchecked; Fine grams to fix `40`; Rate / gram (₹) `6500` → **Confirm**.
3. **Expected:** amount = fine × rate (40 g × ₹6,500 = ₹2,60,000); status → **PARTIALLY_FIXED**; outstanding fine reduces to ~59.99 g; a fixing row appears in the table.

## C. Full rate fix
1. On the same loan, **Fix Rate** again → tick **Fix all** (auto-fills remaining fine) → Rate `6600` → **Confirm**.
2. **Expected:** outstanding fine → 0; status → **FIXED**; **Fix Rate** button disappears; Fixed Value (payable) = sum of both fixings.

---

## D. Edge cases — create

| # | Input / action | Expected |
|---|----------------|----------|
| D1 | No supplier (neither existing nor new name) | Rejected — supplier must exist |
| D2 | Purity `0%` or `> 100%` | Rejected (1–10000 basis points) |
| D3 | Gross weight `0` / blank | Rejected — fine weight must be > 0 |
| D4 | Very large weight (10 kg) | Accepted, fine math correct, no overflow |
| D5 | Force duplicate loan number | Record uniqueness behaviour |

## E. Edge cases — fixing

| # | Input / action | Expected |
|---|----------------|----------|
| E1 | Fix **more grams than outstanding** | Blocked — "Cannot fix X mg; only Y mg outstanding." |
| E2 | Rate `0` or negative | Rejected — rate must be positive |
| E3 | Fine grams to fix `0` | Rejected — must be positive |
| E4 | Fix a loan already **FIXED** | Blocked — Fix Rate hidden once fully fixed |
| E5 | Two partial fixes at different rates | Each amount uses its own rate; Fixed Value = sum, not a blended average |
| E6 | Hand-check one fixing: fine × rate | Matches the app's amount exactly (prove the math) |

## F. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| F1 | Summary "Fine Gold Owed" | = sum of outstanding fine across UNFIXED + PARTIALLY_FIXED loans |
| F2 | Summary "Fixed Value (payable)" | = sum of all fixing amounts |
| F3 | Status filter buttons (All/UNFIXED/PARTIALLY_FIXED/FIXED) | Filter the register correctly |

## G. What to report
- PASS/FAIL per row + exact error text.
- One **hand-checked fixing** (fine grams × rate/g) vs the app (F-E6).
- Confirm over-fixing is blocked with the exact outstanding-mg message (E1).
- Confirm status auto-derives UNFIXED → PARTIALLY_FIXED → FIXED across the two fixes.
