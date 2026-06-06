# 14 — GST Reports + e-Invoice / e-Way + BIS / HUID

**Prerequisite:** Logged in as admin; shop **GSTIN configured** (Settings, test 19); sales & purchases
exist (tests 04, 08). ⚠️ Audit locks block back-dated edits; e-invoice/e-way cancel is irreversible — use a test DB.

Covers three compliance areas: **GST returns** (GSTR-1/2/3B, HSN, B2B/B2C), **e-Invoice + e-Way bill**
generation, and **BIS hallmarking / HUID** lifecycle.

> ℹ️ This build is **offline** — there is no live GSTN/IRP/EWB gateway. The app **prepares** payloads
> and IRN/QR locally; you then **record** the official number you got elsewhere. IRN is computed as
> `SHA256(gstin + financialYear + docType + docNumber)`.

---

## A. GST returns
1. Sidebar → **GST Reports**. Tabs: gstr1 · gstr2 · gstr3b · b2b_b2c · audit_locks · bis_workflow.
2. **GSTR-1**: set From/To → table of HSN code / desc / qty / weights / rate% / taxable / CGST / SGST / IGST / CESS.
3. **GSTR-2**: purchases HSN summary — confirm it **includes URD vouchers + POS URD at 0% GST** plus supplier purchases with GST.
4. **GSTR-3B**: Outward vs Inward boxes; Net Payable = max(outward − inward, 0) per tax head.
5. **B2B / B2C**: B2B rows are invoice-level (with GSTIN); B2C is rate-wise summary.

## B. Audit locks
1. Tab **audit_locks** → Lock New Period: Period From, Period To, Reason → **Enforce Audit Lock**.
2. **Expected:** lock listed as LOCKED. Now try to post an expense/voucher dated inside it (test 13) → blocked.
3. **Unlock** the period → status UNLOCKED; back-dated posting allowed again.

## C. BIS hallmark workflow (HUID)
1. Tab **bis_workflow** → sub-tab **Ready**: tick IN_STOCK gold items, pick Hallmark Center, expected return date, remarks → **Submit to BIS**.
2. Sub-tab **Active**: expand the submission → per item enter **HUID** (6 uppercase alphanumeric), Cert #, status **HUID_RECEIVED** or **REJECTED**, remarks → **Submit Return**.
3. **Expected:** when all items returned, submission → **COMPLETED** (partial → **PARTIAL_RETURN**). HUID_RECEIVED items now carry a HUID; REJECTED items revert to not-applied.
4. Sub-tab **HUID Inventory**: search by barcode/HUID; **Print Certificate** (PVC card) — print event is logged; **View History** shows the lifecycle.
5. **Expected:** an item with a valid HUID and HUID_RECEIVED/CERT_PRINTED status is now **sellable** in POS (recall the HUID gate, test 04).

## D. e-Invoice
1. Sidebar → **GST e-Docs** → search/select an invoice (left list shows IRN/EWB tags).
2. Left panel (e-Invoice): click **Re-prepare** / generate → status **PREPARED**; IRN (SHA-256), QR content, IRP payload shown.
3. Record official response: IRN, Ack No, Signed QR → **Record & Register** → status **REGISTERED**.
4. **Cancel** (with reason) → status **CANCELLED**.

## E. e-Way bill
1. Right panel (e-Way) on the same invoice: threshold note says **Required** if total > ₹50,000, else **Not mandatory** (but you may prepare).
2. Transport Mode (**ROAD**/RAIL/AIR/SHIP), Vehicle Number, Distance (km) → **Prepare e-Way Bill** → status PREPARED.
3. Record EWB Number → status **GENERATED**. **Cancel** with reason → CANCELLED.

---

## F. Edge cases — GST & locks

| # | Input / action | Expected |
|---|----------------|----------|
| F1 | Two **overlapping** audit locks | Second blocked — periods can't overlap |
| F2 | Unlock an already-unlocked period | Blocked / record |
| F3 | GSTR-1 vs B2B/B2C: a customer **with** GSTIN | Appears as B2B invoice-level |
| F4 | …a customer **without** GSTIN | Appears only in B2C rate-wise summary |
| F5 | GSTR-2 after creating a URD voucher (08) | URD shows at 0% GST |

## G. Edge cases — BIS / HUID

| # | Input / action | Expected |
|---|----------------|----------|
| G1 | Submit a **non-IN_STOCK** item to BIS | Blocked — only IN_STOCK eligible |
| G2 | Return with HUID `ABC` (not 6 chars) | Rejected — requires valid 6-char `[A-Z0-9]{6}` |
| G3 | Return 2 of 3 items | Submission → PARTIAL_RETURN; 1 item still SUBMITTED |
| G4 | Mark an item REJECTED | Item HUID status reverts (not applied), stays sellable-blocked |
| G5 | Sell a hallmarked HUID_RECEIVED gold item in POS | Allowed (HUID gate satisfied, test 04) |

## H. Edge cases — e-Invoice / e-Way

| # | Input / action | Expected |
|---|----------------|----------|
| H1 | Prepare e-invoice with **no shop GSTIN** | Blocked (422) — configure GSTIN first |
| H2 | Re-prepare an already **REGISTERED** e-invoice | Blocked (409) — cancel it first |
| H3 | Record with blank IRN / blank EWB number | Rejected |
| H4 | e-Way **ROAD** mode with no vehicle number | Rejected (400) |
| H5 | e-Way on a ₹49,999 invoice | "Not mandatory" note; still preparable |
| H6 | e-Way on a ₹50,001 invoice | "Required" note |
| H7 | Verify IRN by hand | IRN = SHA256(gstin + FY + docType + docNumber) for that invoice |

## I. What to report
- PASS/FAIL per row + exact error text.
- Confirm the offline model: prepare-then-record, no live gateway calls.
- Confirm overlapping-lock prevention (F1) and lock actually blocks posting (B).
- Confirm the BIS return updates statuses and the HUID gate (G3–G5) ties back to POS.
- One **hand-verified IRN** hash (H7) and one e-way threshold check (H5/H6).
- Screenshots: a HUID PVC certificate, a prepared e-invoice payload.
