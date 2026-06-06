# 02 — Customer Master & CRM 360

**Prerequisite:** Logged in as admin. Open **CRM** in the sidebar.

This covers creating/editing customers and the Customer 360° view. Customers created here are
used by POS billing, Girvi, GSS, orders, etc.

---

## A. Happy-path: add a customer
1. Sidebar → **CRM**.
2. Confirm the seeded customers are listed: Rahul Sharma, Anita Desai, Vikram Singh.
3. Add a new customer:
   - Name: `Test Customer One`
   - Phone: `9123456780`
   - Address / Area / Taluka / District: fill any valid values (e.g. Kothrud / Haveli / Pune)
   - Optional: birthday `1990-01-15`, anniversary, PAN `ABCDE1234F`, Aadhaar
4. Save.
5. **Expected:** appears in the customer list immediately; searchable by name and phone.

## B. Edit a customer
1. Open `Test Customer One`'s 360 panel → click the **Edit** button in the panel header (pencil icon, top-right).
2. The form opens pre-filled as **Edit Customer**; change the area and add a spouse name / ring size → **Update**.
3. **Expected:** the 360 panel refreshes in place with the new values (no manual reload); reopen to confirm changes persisted.

## C. Customer 360°
1. Open **Anita Desai** (she has KYC + loyalty) → view her 360°/profile.
2. **Expected — Contact & KYC Details** now shows **PAN, Aadhaar, and GSTIN** rows (a value or `-`), alongside address/area/ring size/spouse.
3. **Expected — Loyalty** label is not contradictory: if she has a points balance but the enrol flag is off, it reads `Not enrolled (480 pts)` rather than a bare "Not enrolled" next to a 480 balance.
4. History sections (invoices/loans/schemes) — note which are empty vs populated.

---

## D. Edge cases — customer data

| # | Input / action | Expected |
|---|----------------|----------|
| D1 | Save with **empty name** | Rejected with clear validation error |
| D2 | Phone with letters `98abc12345` | Rejected or stripped; record behaviour |
| D3 | Phone too short `123` / too long `9999999999999999` | Short → "Phone must be 10 to 15 digits." Long → the input caps at 15 digits (a valid length); confirm no crash. (15-digit cap is intentional) |
| D4 | **Duplicate phone** — reuse `9000000001` (Rahul's) | Blocked: "A customer with this phone number already exists." |
| D5 | Duplicate **name** but different phone | Allowed (people share names); confirm both exist |
| D6 | PAN in wrong format `12345` | Rejected: "PAN must be a valid PAN (e.g. ABCDE1234F)." (no raw field name in the message) |
| D7 | Aadhaar with 11 digits | Rejected: "Aadhaar number must be 12 digits." (no raw field name) |
| D8 | Birthday in the future `2099-01-01` | **Rejected:** "Birth date must be a valid date and cannot be in the future." Same rule applies to a future Anniversary. |
| D9 | Name with emoji / Devanagari `राहुल 🙏` | Saved & displayed correctly (Unicode) |
| D10 | Very long address (1000 chars) | Handled, no layout break |
| D11 | Search a non-existent name `zzzzz` | Empty result, friendly "no results", no error |
| D12 | Leading/trailing spaces in name `  Ravi  ` | Trimmed on save |

## E. Permissions
| # | Action | Expected |
|---|--------|----------|
| E1 | As a non-admin counter user, try to add/edit a customer | Confirm whether allowed (CRM routes are not admin-gated in code, so likely allowed — verify) |

## F. Header KPI cards (regression check)
1. Note the **Total Customers** count, then add a customer.
2. **Expected:** the count updates to match the table/footer total and does not lag at the old value (the count-up now snaps to the true value under automation/background tabs — same fix as test 01 §F).

## G. What to report
- PASS/FAIL per row; the exact validation message for each rejection.
- Confirm **Edit** now works end-to-end (B) and the 360 shows PAN/Aadhaar/GSTIN (C).
- Confirm future birth/anniversary dates are rejected (D8) and messages no longer leak field names (D6/D7).
- Screenshot of the Customer 360° for Anita.
