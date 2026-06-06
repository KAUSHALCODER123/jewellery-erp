# 06 — Order Booking (Customer Custom Orders)

**Prerequisite:** Logged in as admin; at least one customer exists (test 02).
Order Booking = recording a customer's request for a custom-made item (with optional customer-supplied
gold and an advance), then tracking it through manufacturing to completion.

> ℹ️ This is a **booking register only** — it does not move stock or post accounting. The actual
> making happens in **Karigar** (test 11); the order number is meant to be quoted there manually.

---

## A. Happy-path: book an order
1. Sidebar → **Order Booking**.
2. Click **New Order**.
3. Confirm a **next order number** is suggested automatically (format `ORD-NNNN`).
4. Fill the form:
   - Customer: search & select `Rahul Sharma` (by name/phone).
   - **Item description** (required): e.g. `Ladies ring, floral design`.
   - Target weight (g): `8`, Purity preset: `22K`.
   - Design notes (optional): `match attached photo`.
   - Customer's own gold (optional): weight `5 g`, purity `22K`.
   - Advance collected (optional): `₹2,000`.
5. Click **Book Order**.
6. **Expected:** order created, status **OPEN**, appears in the left list.

## B. Lifecycle / status transitions
1. Open the order. Status buttons appear based on current state.
2. OPEN → click **Mark In Progress** → status **IN_PROGRESS**.
3. IN_PROGRESS → click **Mark Completed** → status **COMPLETED**.
4. Re-open another OPEN order → click **Cancel** → status **CANCELLED**.
5. **Expected:** each transition sticks; tabs ALL / OPEN / IN_PROGRESS / COMPLETED / CANCELLED filter correctly.

## C. Karigar hand-off
1. Note the order number on a COMPLETED-or-not order.
2. Go to **Karigar → Issue Metal** and confirm you can reference this order number manually.
3. **Expected:** there is **no automatic link** between the order and a karigar job (record this — it's a known gap, the only connection is the order number you type by hand).

---

## D. Edge cases — booking

| # | Input / action | Expected |
|---|----------------|----------|
| D1 | Item description blank | Rejected (description required, non-empty) |
| D2 | No customer selected | Rejected |
| D3 | Target purity `0` or `> 100%` | Rejected (purity must be 1–10000 basis points) |
| D4 | Negative advance | Rejected (advance must be non-negative) |
| D5 | Customer's gold weight given but purity blank | Record what happens (optional fields) |
| D6 | Force a duplicate order number (same as an existing one) | Record — order number format is 3–40 chars; check uniqueness behaviour |
| D7 | Very large advance (₹10 lakh) | Accepted, no overflow |

## E. Edge cases — lifecycle

| # | Input / action | Expected |
|---|----------------|----------|
| E1 | Cancel an already-COMPLETED order | UI only offers Cancel from OPEN/IN_PROGRESS — confirm Cancel is hidden/blocked once completed |
| E2 | Mark Completed directly from OPEN (skip In Progress) | Record — the API does not restrict transitions, so check whether the UI allows the skip |
| E3 | Re-open a CANCELLED order | Record whether any transition is offered |

## F. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| F1 | After booking with an advance, open Accounts / Day Book | Record whether the advance posts anywhere (this module does **not** post accounting — note the gap) |
| F2 | List filter counts vs actual rows | Counts per tab match the visible rows |

## G. What to report
- PASS/FAIL per row + exact error text.
- Confirm the order-number auto-suggest and whether duplicates are blocked (D6).
- Confirm status transition rules actually enforced by the UI (E1, E2).
- Note the two known gaps: no auto karigar-job link (C), and advance does not post to accounts (F1).
