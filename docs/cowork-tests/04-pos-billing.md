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
1. Settings → confirm loyalty mode (per ₹100 or per gram gold).
2. Do a sale for **Anita Desai** (she has 480 points). Confirm points **earned** are added.
3. On a new sale for Anita, **redeem** some points → confirm discount applied and balance reduced.

## C. Split / non-cash payment
1. New sale → pay part **Cash**, part **UPI/Card** (seeded ledgers: Cash, UPI Bank, Card Bank).
2. **Expected:** split adds up to total; each ledger gets its share.

## D. Udhari (credit) sale
1. Sale for **Vikram Singh** → pay less than total, leave balance on **credit/udhari**.
2. **Expected:** outstanding recorded against Vikram (he already has ₹15,000); credit-limit check may trigger.

## E. Quotation — ⚠️ NO UI IN CURRENT BUILD
The backend supports quotations (`POST /api/pos/quotations`) but there is **no UI** to create one.
**Skip this flow** and record it as a known gap (see `00-UI-GAPS.md`). Test once UI is added:
create a quotation (no stock movement) → retrieve → convert to sale; stock not decremented until sold.

## F. Sales return — ⚠️ NO UI IN CURRENT BUILD
The backend supports sales returns (`POST /api/pos/sales-returns`) but there is **no UI** to trigger
a return. **Skip this flow**; record as a known gap. Test once UI is added: return an item → item back
to stock, refund/credit recorded, original invoice linked. (Purchase returns are also backend-only.)

---

## G. Edge cases — billing

| # | Input / action | Expected |
|---|----------------|----------|
| G1 | Checkout with **no items** | Blocked — can't bill an empty cart |
| G2 | Checkout with **no customer** | Either blocked or allows "walk-in" — record which |
| G3 | Sell the **same item twice** (already SOLD barcode `A1B2C3`) | Second attempt blocked — item not available |
| G4 | Payment **less than** total with no udhari selected | Blocked or forces credit selection |
| G5 | Payment **more than** total (cash tendered) | Shows change / rejects overpay — record |
| G6 | Negative or zero quantity/weight override | Rejected |
| G7 | Redeem **more loyalty points than balance** | Blocked — can't go negative |
| G8 | Redeem points making total negative | Blocked — total floored at 0 |
| G9 | Manual discount > item value | Blocked / clamped |
| G10 | Udhari sale that **exceeds customer credit limit** | Warned/blocked per limit |
| G11 | Change metal rate to 0 then bill | Rejected or produces ₹0 metal value — record (should reject) |
| G12 | Double-click Checkout | Exactly **one** invoice, not two |
| G13 | Sale return of an item that was never sold | Blocked |
| G14 | Return more than was sold | Blocked |
| G15 | Bill, then verify GST math (3%) by hand | Tax = 3% of taxable value, rounding correct |

## H. Cross-checks after billing
| # | Check | Expected |
|---|-------|----------|
| H1 | After a cash sale, open **Day Book / Accounts** | Sale + cash receipt appear |
| H2 | After udhari sale, open **Accounts → Udhari** | Vikram's outstanding increased |
| H3 | After loyalty earn | Customer 360 shows new points balance |
| H4 | Stock count after sale | Sold item removed from available stock |

## I. What to report
- PASS/FAIL per row; exact error text for each block.
- The computed totals vs your manual calculation for one invoice (prove the math).
- Confirm an item cannot be sold twice (G3) — critical.
- Screenshot of a generated invoice PDF.
