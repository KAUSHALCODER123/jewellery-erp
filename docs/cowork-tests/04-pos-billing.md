# 04 — POS Billing (Sales, Loyalty, Returns, Quotations)

**Prerequisite:** Logged in as admin; customers exist (test 02); stock exists (test 03).
This is the core revenue flow — test it carefully.

> ⚠️ **HUID gate (read first):** Any **gold** item is blocked at checkout unless it has a valid 6-char
> HUID **and** a hallmark status of `HUID_RECEIVED`/`CERT_PRINTED`. Error:
> *"… cannot be sold because it has not been hallmarked (HUID is required)."* Only URD/recycled gold
> is exempt. If the happy-path sale below fails on this, hallmark the item first, or use a **silver**
> item to prove the flow. Record this gate as observed behaviour.
>
> ℹ️ **GST is inclusive** — listed prices already contain GST; tax is back-calculated (`total − total/1.03`),
> not added on top. The backend re-verifies all totals and requires payments to equal net payable **exactly**.

---

## A. Happy-path: cash sale
1. Sidebar → **POS Billing**.
2. Attach customer **Rahul Sharma** (search by name/phone `9000000001`).
3. Add a stock item by barcode `A1B2C3` (Classic 22K Ring) — or pick from the list.
4. Confirm the line shows: weight, metal rate, making charge, GST (3%).
5. Payment mode: **Cash**, full amount.
6. **Checkout / Generate Invoice.**
7. **Expected:** invoice created with a number; totals = (metal value + making + GST). Item status flips to SOLD so it can't be sold twice.
8. Open/print the invoice (A4) from Documents to confirm it renders.

## B. Loyalty earn + redeem
> ℹ️ **Enrollment gates earning.** A customer only earns/redeems if `loyalty_enrolled` is true.
> The backend persists this flag correctly on both create and edit (covered by
> `tests/api/crm-loyalty-udhari.test.ts`). The **seeded** customers (Anita, Rahul) have points but
> the flag is **off**, so they read "Not enrolled" — that's seed data, not a bug. Enroll a customer
> (tick "Enroll in loyalty points program" on create/edit) before testing earn/redeem.
1. Settings → confirm loyalty mode (per ₹100 or per gram gold).
2. Enroll a customer (or create one with the toggle on), then do a sale → confirm points **earned** are added.
3. On a new sale for that customer, **redeem** some points → confirm discount applied and balance reduced.

## C. Split / non-cash payment
1. New sale → pay part **Cash**, part **UPI/Card** (seeded ledgers: Cash, UPI Bank, Card Bank).
2. **Expected:** split adds up to total; each ledger gets its share.

## D. Udhari (credit) sale
1. Sale for **Vikram Singh** → pay less than total, leave balance on **credit/udhari**.
2. **Expected:** outstanding recorded against Vikram (he already has ₹15,000); credit-limit check may trigger.

## E. Quotation — UI now present
POS has a **Save as Quotation** button (and the backend `POST /api/pos/quotations`).
Test: build a cart → **Save as Quotation** (no stock movement) → retrieve it → convert to a sale.
**Expected:** stock is **not** decremented until the quotation is converted and sold.

## F. Sales return — UI now present (Returns page)
The sidebar has a **Returns** page (Sales + Purchase tabs) backed by `POST /api/pos/sales-returns`
and `POST /api/pos/purchase-returns`. Test a sales return: return a sold item → **Expected:** item
goes back to stock, a refund/credit is recorded, and the original invoice is linked.

---

## G. Edge cases — billing

| # | Input / action | Expected |
|---|----------------|----------|
| G1 | Checkout with **no items** | Blocked — can't bill an empty cart |
| G2 | Checkout with **no customer** | Either blocked or allows "walk-in" — record which |
| G3 | Sell the **same item twice** (already SOLD barcode `A1B2C3`) | Now blocked **at scan** — a SOLD item can't be added to the cart ("… is sold and cannot be added"). If it does reach checkout, the server's specific reason is shown (no more generic "Checkout failed."). |
| G4 | Payment **less than** total with no udhari selected | Blocked or forces credit selection |
| G5 | Payment **more than** total (cash tendered) | Shows change / rejects overpay — record |
| G6 | Negative or zero quantity/weight override | Rejected |
| G7 | Redeem **more loyalty points than balance** | Blocked — can't go negative |
| G8 | Redeem points making total negative | Blocked — total floored at 0 |
| G9 | Manual discount > item value | Blocked / clamped |
| G10 | Udhari sale that **exceeds customer credit limit** | Warned/blocked per limit |
| G11 | Change metal rate to 0 then bill | **Rejected** — "metal rate per gram cannot be zero for a weight-based item." (Quantity-wise / flat unit-price items are exempt.) |
| G12 | Double-click Checkout | Exactly **one** invoice, not two |
| G13 | Sale return of an item that was never sold | Blocked |
| G14 | Return more than was sold | Blocked |
| G15 | Bill, then verify GST math (3%) by hand | Tax = 3% of taxable value, rounding correct |

## H. Cross-checks after billing
| # | Check | Expected |
|---|-------|----------|
| H1 | After a cash sale, open **Day Book / Accounts** | Sale + cash receipt appear |
| H2 | After udhari sale, open **Accounts → Udhari** | The customer's outstanding increases in a **single** debtor row (the opening-balance ledger and the POS credit-sale ledger are now one ledger per customer — keyed on entity, not name). Debtor count must not double-count the same customer. |
| H3 | After loyalty earn | Customer 360 shows new points balance |
| H4 | Stock count after sale | Sold item removed from available stock |

## I. What to report
- PASS/FAIL per row; exact error text for each block.
- The computed totals vs your manual calculation for one invoice (prove the math).
- Confirm an item cannot be sold twice (G3) — critical.
- Screenshot of a generated invoice PDF.
