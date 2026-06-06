# 05 — Girvi (Gold Loans / Pawn)

**Prerequisite:** Logged in as admin; at least one customer exists.
⚠️ Default and Forfeit are **destructive** — only run on a test DB.

Girvi = lending money against a customer's gold/silver as collateral, charging interest, and either
releasing it on repayment or forfeiting it on default.

---

## A. Happy-path: issue a loan
1. Sidebar → **Girvi**.
2. Confirm a **next loan number** is suggested automatically.
3. New loan:
   - Customer: `Rahul Sharma`
   - Collateral: describe item(s), gross weight e.g. `20 g`, net `19 g`, purity `22K`
   - Gross/Net **rate** per gram (used to value collateral)
   - Loan/principal amount: e.g. `₹50,000`
   - Interest rate: e.g. `2% / month`; start date today
4. Issue the loan.
5. **Expected:** loan created, status ACTIVE, listed; **Pavati (receipt) PDF** can be printed (Documents → girvi pavati).

## B. Interest calculation + repayment
1. Open the loan → **Calculate repayment** for a date a few months out.
2. **Expected:** interest = principal × rate × months (per the app's method); total due shown.
3. Record a **repayment** (full or partial).
4. **Expected:** balance reduces; on full repayment loan closes and collateral is **released** (release receipt PDF available). Repayment receipt PDF available.

## C. Default & forfeit (test DB only)
1. On an active loan, mark **Default**.
2. **Expected:** status DEFAULTED; legal-notice PDF available.
3. **Forfeit & transfer** collateral → **Expected:** collateral becomes shop stock (an inventory item), loan closed as forfeited.

---

## D. Edge cases — issue

| # | Input / action | Expected |
|---|----------------|----------|
| D1 | Loan amount `0` or blank | Rejected |
| D2 | Loan amount **greater than** collateral value | Warned/blocked (over-lending risk) — record |
| D3 | Negative interest rate | Rejected |
| D4 | Net weight > gross weight | Rejected |
| D5 | No customer selected | Rejected |
| D6 | Start date in the future | Rejected or warned |
| D7 | Duplicate loan number (force same as existing) | Blocked — must be unique |
| D8 | Very large principal (₹1 crore) | Accepted, no overflow, interest math still correct |

## E. Edge cases — repayment / lifecycle

| # | Input / action | Expected |
|---|----------------|----------|
| E1 | Calculate repayment for a **past** date / same-day | 0 or minimal interest; no negative interest |
| E2 | Repay **more than** outstanding | Blocked or treated as full settlement — record |
| E3 | Repay `0` | Rejected |
| E4 | Repay an already-closed loan | Blocked |
| E5 | Default a loan that's already repaid/closed | Blocked |
| E6 | Forfeit a loan that isn't defaulted | Blocked (must default first) — record |
| E7 | Forfeit twice | Second attempt blocked; no duplicate stock item |
| E8 | Partial repayment, then calculate again | Interest recalculated on reduced principal correctly |

## F. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| F1 | After issue, open Accounts/Day Book | Cash out + loan entry recorded |
| F2 | After repayment | Cash in + interest income recorded |
| F3 | After forfeit | New inventory item exists with the collateral's weight/purity |
| F4 | Reminders → Girvi | Due/overdue loan shows up for reminders |

## G. What to report
- PASS/FAIL per row + exact error text.
- One **hand-checked interest calculation** vs what the app shows (prove the formula).
- Confirm forfeit creates exactly one stock item (F3) and can't be double-run (E7).
- Screenshots: Pavati PDF, release receipt, legal notice.
