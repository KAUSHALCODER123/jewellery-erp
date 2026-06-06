# 15 — Reminders / Ageing + Messenger

**Prerequisite:** Logged in as admin. Best after Girvi (05), GSS (10), Accounts/Udhari (13) so there
are dues to surface. Customers with birthday/anniversary dates help test wishes.

Two related modules: **Reminders & Ageing** (a daily follow-up digest + aged receivables with credit
limits) and **Messenger** (message templates, manual send, due-reminder scans, and the dispatch log).

> ℹ️ This build has **no live SMS/WhatsApp gateway**. "Sending" generates a **wa.me link** and writes a
> **log row** (status SENT if phone ≥ 10 digits, else FAILED). It does not actually deliver.

---

## A. Reminders — due digest
1. Sidebar → **Reminders** → tab **Due Reminders**.
2. Set "Udhari overdue after [N] days" (e.g. `30`) → **Refresh**.
3. **Expected:** chips/counts for **Udhari overdue**, **Girvi due**, **Scheme maturing**, **Occasions** (birthdays/anniversaries); each result card shows customer, detail, amount, phone, message preview, and a WhatsApp button (or "no phone").

## B. Reminders — udhari ageing
1. Tab **Udhari Ageing**.
2. **Expected:** bucket summary 0-30 / 31-60 / 61-90 / 91-120 / 120+ / Total; table per customer with oldest-days, buckets, balance, and an editable **Credit Limit**.
3. Set a credit limit on a customer (click the limit cell → type → save). Set it **below** their balance.
4. **Expected:** that customer flags **over limit** (red); the "N customer(s) over their credit limit" banner appears.
5. Set limit to `0` → clears the limit.

## C. Messenger — templates
1. Sidebar → **Messenger** → tab **Event Templates**.
2. Pick a template (e.g. `UDHARI_BALANCE_REMINDER`); edit its content in the textarea; use **Placeholder Tokens** (`{{customer_name}}`, `{{amount}}`, `{{shop_name}}`, etc.) → **Save Changes**.
3. **Expected:** content saved; tokens interpolate when the template is used.

## D. Messenger — manual send
1. Tab **Send Message** → Recipient Phone (10-digit), Channel **WhatsApp**/**SMS**, Message → **Send Message**.
2. **Expected:** "Message logged/sent."; if WhatsApp + valid phone, an **Open in WhatsApp** link appears (`wa.me/91…`).

## E. Messenger — wishes & reminders scan
1. Tab **Wishes & Reminders** → choose a sub-tab (Birthdays/Anniversaries · Girvi Due · GSS Installment Due · Udhari Outstanding) → **Scan Dues**.
2. **Expected:** a table of matching customers with message previews and **Send WhatsApp** buttons.

## F. Messenger — logs
1. Tab **Message Logs**.
2. **Expected:** every dispatch (manual + scanned) logged newest-first: Date / Recipient / Trigger / Body / Channel / Status (SENT green, FAILED red).

---

## G. Edge cases

| # | Input / action | Expected |
|---|----------------|----------|
| G1 | Manual send to a phone with **< 10 digits** | Logged as **FAILED**, "phone looked invalid" |
| G2 | Manual send with blank recipient or message | 400 — rejected |
| G3 | Template with a placeholder that has spaces `{{ amount }}` | Still interpolates (case-insensitive, space-tolerant) |
| G4 | Reminders overdue threshold `0` | Non-negative clamp; record what surfaces |
| G5 | Credit limit set to a negative number | Rejected (non-negative) |
| G6 | Customer with **no phone** in a reminder | Shows "no phone", no WhatsApp button |
| G7 | Birthday scan when no customer has today's MM-DD | Empty state "No matching due entries found" |
| G8 | Open WhatsApp link | Composes `wa.me/{91}{phone}?text=…` with the interpolated message |

## H. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| H1 | Reminders Girvi-due vs Girvi module | Active loans near/over due date appear (test 05) |
| H2 | Reminders Scheme-maturing vs GSS | Accounts maturing within the window appear (test 10) |
| H3 | Udhari ageing total vs Accounts udhari | Same outstanding totals (test 13) |
| H4 | After any "send", check Message Logs | A new row exists with correct status |
| H5 | Auto-trigger templates (POS invoice, Girvi issue/repay, GSS receipt) | Confirm whether transactions auto-log a message (known: these are wired server-side; verify a log row appears after a real txn) |

## I. What to report
- PASS/FAIL per row + exact error text.
- Make clear it's **link + log only**, not real delivery (state this explicitly in the report).
- Confirm phone validation drives SENT vs FAILED (G1) and template interpolation (G3).
- Confirm credit-limit over-limit flagging (B) and that ageing totals reconcile with Accounts (H3).
