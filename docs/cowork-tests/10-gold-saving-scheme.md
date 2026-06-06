# 10 — Gold Saving Scheme (GSS)

**Prerequisite:** Logged in as admin; customers exist (test 02). A seeded plan exists
("11-Month Dhanteras Plan"). ⚠️ Defaulter scan and Merge are **irreversible** — use a test DB.

GSS = a recurring savings plan. The customer pays monthly installments; at maturity they get the
total plus a bonus (as cash credit or accumulated gold), redeemable as POS credit.

> ℹ️ Status flow: **ACTIVE → MATURED → CONVERTED_TO_SALE**, plus **DEFAULTER** and **MERGED**.
> Schemes can be **CASH** or **GOLD** type. Defaulter = 2+ unpaid months.

---

## A. (Optional) build a scheme template
1. Sidebar → **Gold Scheme** → **Scheme Builder** (GssSchemeBuilder).
2. Fill: Scheme Code, Name, Type (**CASH**/**GOLD**), Monthly Amount, Total Months, Customer Pays (months),
   Shop Funds (months), Bonus Rule (**FIXED_AMOUNT**/**PERCENTAGE_OF_INSTALLMENT**), Bonus value.
3. Watch the **live preview** (Customer Pays / Bonus / Maturity Value + installment schedule).
4. Click **Create Scheme** → appears in Existing Schemes grid as Active.

## B. Enroll a customer
1. Tab **Enrollment**.
2. Left: pick an **Active Scheme** (e.g. 11-Month Dhanteras). Center: search & select customer `Rahul Sharma`.
3. Right: enter **Physical Card Number** (4–32 alphanumeric); confirm validation shows OK.
4. Click **Enroll Account**.
5. **Expected:** "GSS account enrolled."; account ACTIVE; maturity date = enrollment + duration months.

## C. Collect an installment
1. Tab **Collection** → Quick Search the card / phone / name → select the account.
2. In the installment tracker, **tick the next-due row** → Total Payable auto-fills with the monthly amount.
3. Payment Mode: **CASH** → **Save Installment**.
4. **Expected:** receipt modal (Receipt ID `GSS-…`, card, masked member, amount, mode, date) with **Print / PDF / WhatsApp**; installments-paid count +1.
5. For a **GOLD** scheme: confirm gold weight credited = amount ÷ 22K rate (check in Account Statement).

## D. Reports & controls
1. Tab **Reports & Controls** → sub-tabs:
   - **Account Statement**: enter Account ID → **Fetch Statement** → totals, maturity value, (gold metrics if gold scheme).
   - **Pending / Overdue**: **Refresh Overdue Ledger** → accounts with unpaid installments.
   - **Received Summary**: date range → **Generate Report** → totals by Cash/UPI/Card.
   - **Maturity Tracker**: Horizon days → **Scan Maturity**.
   - **Defaulter Control**: **Run Defaulter Scan** (⚠️ flags 2+ unpaid as DEFAULTER, irreversible).
   - **Merge Accounts** (⚠️ irreversible).

## E. Maturity → POS credit
1. Pay enough installments to reach **MATURED** (or use a near-complete seeded account).
2. Tab **Ledger** → on the MATURED account click **Convert to POS Credit**.
3. **Expected:** "POS credit prepared for {card}: {total}." — credit is staged for the POS module (client-side hand-off, no backend posting).

---

## F. Edge cases — enroll / collect

| # | Input / action | Expected |
|---|----------------|----------|
| F1 | Card number `ABC` (too short) | Rejected — 4–32 alphanumeric |
| F2 | Enroll same customer + scheme + card twice (while ACTIVE) | Blocked — duplicate active enrollment |
| F3 | Enroll into an **inactive** scheme | Blocked — template must be active |
| F4 | Collect on a **MATURED / MERGED / DEFAULTER** account | Blocked — only ACTIVE accepts payment |
| F5 | Save installment with `0` / blank amount | Blocked |
| F6 | Variable scheme: pay outside min/max | Blocked to the allowed range |
| F7 | Pay the final installment | Account auto-flips to **MATURED** |

## G. Edge cases — controls

| # | Input / action | Expected |
|---|----------------|----------|
| G1 | Run Defaulter Scan with a 2+ month unpaid account | That account → **DEFAULTER**; then collection on it is blocked (F4) |
| G2 | Merge accounts of **different customers** | Blocked — both must be same customer |
| G3 | Merge an already-**MERGED** source | Blocked |
| G4 | After merge | Source → MERGED; receipts/totals move to target; target may auto-MATURE |
| G5 | Bonus math: FIXED_AMOUNT vs PERCENTAGE_OF_INSTALLMENT | Hand-check maturity value = total paid + bonus |

## H. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| H1 | After a CASH collection, open Day Book / Accounts | Cash (or bank) in + GSS liability credit posted |
| H2 | After a GOLD collection | Gold weight accumulated increases by amount ÷ 22K rate |
| H3 | Reminders / Messenger → GSS | Maturing / installment-due accounts surface (tests 15) |
| H4 | Schedule rows count | = "Customer Pays" months only (shop-funded months not shown to customer) |

## I. What to report
- PASS/FAIL per row + exact error text.
- One **hand-checked maturity value** (total paid + bonus) vs the app (G5).
- Confirm Defaulter scan is irreversible and blocks further collection (G1/F4).
- Confirm Merge moves data and marks source MERGED (G4).
- Screenshots: installment receipt PDF, account statement (gold metrics if a gold scheme).
