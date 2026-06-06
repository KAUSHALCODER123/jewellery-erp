# 13 — Accounts / Day Book / Udhari

**Prerequisite:** Logged in as admin. Best run **after** POS (04), Girvi (05), GSS (10) so there are
real entries. ⚠️ Receipts and vouchers **post journal entries** that can only be reversed by another
voucher — use a test DB.

This module is double-entry accounting: the **Day Book** (daily cash/bank), **Udhari** (customer
credit/receivables), manual **Vouchers**, single-**Ledger reports**, and **Financials** (P&L, BS, TB).

---

## A. Day Book
1. Sidebar → **Accounts** → tab **daybook**; pick a date with activity (e.g. today).
2. **Expected:** Opening Balance, Total Receipts, Total Payments, Closing Balance; entries table (Ledger / Type / Amount / Reference / Description).
3. Check: today's **Opening = yesterday's Closing**.

## B. Day Book Summary + expense entry
1. Open the **Day Book Summary** view (DayBookSummary).
2. **Expected:** cards for Total Sales / Purchase / Old Gold-URD / Expenses, Cash in Hand, Bank Balance, Karigar Issued/Received (fine mg), Till Tally.
3. Add an expense: Category, Amount (₹), Mode **CASH**/**BANK**, Description → **Add Expense**.
4. **Expected:** expense appears in today's list; cash/bank balance drops accordingly.

## C. Udhari (receivables) + receipt
1. Tab **udhari** → see customers with outstanding balances (e.g. Vikram Singh ₹15,000).
2. Open a customer → **Udhari Receipt Window**.
3. Search/select the customer; the three boxes show Current Balance / Receiving Today / Balance After.
4. Receipt Date, Amount (use a quick button ₹5,000 or type), Payment Mode **CASH/UPI/CARD/BANK**, Narration → **Save Receipt**.
5. **Expected:** receipt saved (Receipt #); balance reduces; receipt panel shows a WhatsApp link; History tab lists last 10 receipts.

## D. Manual voucher
1. Tab **vouchers** → Voucher Type (**PAYMENT/RECEIPT/CONTRA/JOURNAL**).
2. Debit ledger ≠ Credit ledger; Amount (₹); Narration; Date.
3. Save.
4. **Expected:** balanced voucher posted; **Print Voucher** PDF available.

## E. Ledger report + PDF
1. Tab **ledger_reports** → pick a ledger (or use customer quick-search), set From/To dates.
2. **Expected:** statement with Date / Particulars / Debit / Credit / Running Balance, opening & closing.
3. Click **Download PDF** → statement PDF (with WhatsApp share for customer ledgers).

## F. Financials
1. Tab **financials** → set date range.
2. **Expected:** P&L (income, expense, net profit), Balance Sheet (assets/liabilities/equity), Trial Balance (debit = credit, balance check = 0).

## G. Tally export
1. Accounts → **Export Tally**.
2. **Expected:** journal entries export for Tally (file/download). Record format.

---

## H. Edge cases

| # | Input / action | Expected |
|---|----------------|----------|
| H1 | Voucher debit ≠ credit | Blocked — "debits and credits must be equal" (to the paise) |
| H2 | Voucher with < 2 non-zero lines | Blocked — needs ≥2 lines |
| H3 | Voucher with same debit & credit ledger | Blocked / record |
| H4 | Receipt amount `0` or blank | Rejected |
| H5 | Receipt **more than** outstanding | Allowed → creates **advance credit** (balance goes negative, "Advance Credit" badge) |
| H6 | Receipt that exactly clears balance | "Cleared" badge, balance = 0 |
| H7 | Expense / receipt / voucher dated inside a **locked GST period** (test 14) | Blocked — audit lock |
| H8 | Add expense with negative amount | Rejected |
| H9 | Set a customer **credit limit**, then exceed it | Ageing flags `over_limit: true` (test 15) |

## I. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| I1 | After a POS cash sale (04) | Day Book shows sale + cash receipt |
| I2 | After udhari receipt (C) | Customer outstanding drops; Day Book cash-in increases |
| I3 | After Girvi issue/repay (05) | Cash out on issue; cash in + interest income on repay |
| I4 | Trial Balance | Debits = Credits (check = 0) |
| I5 | Udhari ageing buckets (0-30/31-60/61-90/91-120/120+) | Sum of buckets = total outstanding (FIFO) |

## J. What to report
- PASS/FAIL per row + exact error text.
- Confirm the voucher balancing rule (H1/H2) and audit-lock blocking (H7).
- Confirm overpayment becomes advance credit (H5) and Trial Balance nets to zero (I4).
- One reconciliation: a known transaction traced from its module into the Day Book.
- Screenshots: a ledger statement PDF and a voucher PDF.
