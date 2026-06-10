# Jewellery ERP — Complete Desktop App User Guide

> Written for shop owners, managers, and counter staff.  
> All features of version 0.1.0.

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [First-Time Setup](#2-first-time-setup)
3. [Login, Logout & Screen Lock](#3-login-logout--screen-lock)
4. [MIS Dashboard](#4-mis-dashboard)
5. [Daily Gold & Silver Rates](#5-daily-gold--silver-rates)
6. [Inventory & Item Master](#6-inventory--item-master)
7. [Barcode & Tag Generation](#7-barcode--tag-generation)
8. [Stock Verification](#8-stock-verification)
9. [Purchase Invoices](#9-purchase-invoices)
10. [POS Billing — Making a Sale](#10-pos-billing--making-a-sale)
11. [Customer Orders](#11-customer-orders)
12. [Returns](#12-returns)
13. [Approval / Jangad Memo](#13-approval--jangad-memo)
14. [Old Gold Exchange & URD Vouchers](#14-old-gold-exchange--urd-vouchers)
15. [Repairs](#15-repairs)
16. [Customers & CRM](#16-customers--crm)
17. [Gold Saving Schemes](#17-gold-saving-schemes)
18. [Girvi — Pawn / Moneylending](#18-girvi--pawn--moneylending)
19. [Metal Loan](#19-metal-loan)
20. [Karigar / Manufacturing](#20-karigar--manufacturing)
21. [Refinery Management](#21-refinery-management)
22. [Accounts & Day Book](#22-accounts--day-book)
23. [GST Reports & Exports](#23-gst-reports--exports)
24. [E-Invoice & E-Way Bill](#24-e-invoice--e-way-bill)
25. [Reminders & Receivables Ageing](#25-reminders--receivables-ageing)
26. [Messenger & Auto-Greetings](#26-messenger--auto-greetings)
27. [Report Builder](#27-report-builder)
28. [Print Template Builder](#28-print-template-builder)
29. [Backup & Recovery](#29-backup--recovery)
30. [Staff User Management & Roles](#30-staff-user-management--roles)
31. [Settings](#31-settings)
32. [Tips & Keyboard Shortcuts](#32-tips--keyboard-shortcuts)

---

## 1. Getting Started

**Launch the app** by opening **Jewelry ERP** from the Start menu or the desktop shortcut.

The application runs **fully offline** on your PC — no internet is required except for:
- Optional live MCX rate sync (Daily Rates)
- WhatsApp messaging (Messenger)

All data is stored in a secure SQLite database on this computer. A backup is saved automatically when you close the app (if enabled in Settings).

**System requirements:** Windows 10/11 (64-bit), 4 GB RAM minimum, 500 MB free disk space.

**Default login credentials (factory defaults):**

| Username | Password    | Role  |
|----------|-------------|-------|
| `admin`  | `admin1234` | Admin |

> **Important:** Change this password immediately after first login via Staff User Management.

---

## 2. First-Time Setup

Appears only once, when no admin account exists yet.

**Step 1 — Organisation Details**

| Field | Notes |
|-------|-------|
| Shop Name | Printed on every invoice and receipt |
| Contact Number | Displayed in invoice header |
| GSTIN | Optional — must be exactly 15 characters if entered |
| Billing Address | Full address shown on GST invoices |

Click **Continue**.

**Step 2 — Create Admin Account**

1. Enter an **Admin Username** (e.g. `admin`).
2. Enter a **Password** (minimum 8 characters).
3. Confirm the password.
4. Click **Finish Setup**.

You are logged in automatically and taken to the dashboard.

---

## 3. Login, Logout & Screen Lock

**Login**
1. Enter your **Username** and **Password** on the Sign In screen.
2. Click **Sign In**.
   - Admins and Managers land on the **MIS Dashboard**.
   - Counter staff land on the main **Dashboard**.
   - Wrong credentials show: *"Incorrect username or password."*

**Screen Lock**

Protects the till when you step away from the counter.

- Click **Lock** in the top header bar, **or**
- The app auto-locks after **15 minutes** of inactivity.
- The lock overlay appears — type your password to return to exactly where you were.

**Logout**

Click **Logout** at the bottom of the left sidebar. This ends your session and returns to the Sign In screen.

---

## 4. MIS Dashboard

**Access:** Admin / Manager only — left sidebar, first item.

The MIS Dashboard gives a real-time health check of the business:

| Card | What it shows |
|------|---------------|
| Today's Sales | Total revenue (invoice value) for today |
| Cash in Hand | Cash ledger balance |
| Gold Vault Value | Current value of all in-stock gold (net weight × today's rate) |
| Outstanding Dues | Total udhari (credit) balance across all customers |
| Top Items | Best-selling items by revenue this month |
| Sales Trend | Bar chart — last 30 days |

> The Gold Vault Value uses **net weight** (gross minus stone deduction) × purity-adjusted rate. It updates whenever you change today's rates.

---

## 5. Daily Gold & Silver Rates

**Access:** Dashboard → Daily Rates bar at the top. (Admin only; staff see rates read-only.)

Set rates once every morning — these drive all billing prices, purchase valuations, and vault values.

**Set rates manually**

1. Go to **Dashboard**.
2. In the **Daily Rates Control** bar, enter today's rates for:
   - Gold 24K (per gram)
   - Gold 22K (per gram)
   - Gold 18K (per gram)
   - Silver (per gram)
3. Click **Save & Update Rates**. The "Last Updated" time refreshes.

**Sync live MCX rates (optional)**

1. Go to **Settings → Rate API Key** and paste your gold-rate API key (one-time entry per shop).
2. Return to Dashboard and click **Sync Live MCX Rates**.
3. The app fetches current market rates automatically and saves them.

> The API key is stored inside the app per-shop — not an environment variable. You only enter it once.

---

## 6. Inventory & Item Master

View, search, filter, and edit your complete stock list.

**Navigating inventory**

1. Go to **Inventory** in the sidebar (or view the live table on the **Dashboard**).
2. Use the **filter bar** to narrow results:
   - Search by barcode, HUID, or item name
   - Filter by **Category**, **Metal**, **Purity**, **Location**, **Status** (IN_STOCK / SOLD / IN_MEMO)
3. The metric cards at the top show **Total In-Stock**, **Gold Weight (net)**, and **Silver Weight (net)**.

**Editing an item**

1. Click **Edit** on any row.
2. Update any field: weights, making charge, location, purity, price.
3. Click **Save**.

**Loose vs Tagged stock**

Go to **Inventory → Loose vs Tagged** to see a summary split between:
- **TAGGED** — individually tagged pieces with barcodes
- **LOOSE** — bulk/lot purchases ingested without individual tags

Each row shows metal, category, piece count, total gross weight, net weight, and estimated value.

> Loose stock is created when you do a **LOT-mode purchase** (see Purchase Invoices).

---

## 7. Barcode & Tag Generation

Create barcoded stock tags for new pieces. Every piece should have a tag before it goes on the counter.

**Creating new tags**

1. Go to **Barcode** → **Create Tags** tab.
2. (Optional) choose an **Item Template** from the dropdown to pre-fill common fields. Click **+ New Template** to save a template for future use.
3. Fill in the tag details:

| Field | Notes |
|-------|-------|
| Prefix | E.g. `RNG` for rings |
| Qty | Number of tags to create in one batch |
| Sale Mode | **Weight-Wise** (sold by weight) or **Quantity-Wise** (fixed price) |
| UOM | Gram / Carat / Piece |
| Unit Price | Only for Quantity-Wise mode |
| Category | Ring, Necklace, Earring, Bangle, etc. |
| Design Name | Optional design description |
| Metal | Gold / Silver / Platinum |
| Purity | Karat (22K, 18K, etc.) |
| Gross Weight | Total weight of the piece |
| Stone Deduction | Weight of stones to subtract |
| Net Weight | Auto-calculated: Gross − Stone |
| Fine Weight | Auto-calculated: Net × (Purity/24) |
| Making Type & ₹ | Per-gram or fixed making charge |
| Hallmark ₹ | BIS hallmarking charge |
| HUID | 6-character HUID code from the hallmarking centre |
| Location | VAULT / COUNTER / SHOWCASE |

4. Click **Create Barcode Tags**.
5. New rows appear in the **Created Items** table. Each row has a **Label** print button.

**Printing labels**

- Click **Label** on a single row to print one tag.
- Click **Print All Labels (N)** at the top of the table to print all N created tags as one batch PDF (one label per page).

> Print the physical barcode tags before the items go on display. Scan them at POS to bill instantly.

---

## 8. Stock Verification

Compare physical stock on the counter or vault against what the system expects.

1. Go to **Barcode** → **Verify Stock** tab.
2. Click **Start New Session**.
3. (Optional) set **Location** to `VAULT` or `COUNTER` to scope the verification to one location. Leave blank to check all locations.
4. Scan each item's barcode into the scan box and press **Scan** (or press Enter).
5. The live dashboard updates:
   - **Expected** — total items expected in this session's scope
   - **Scanned** — barcodes entered so far
   - **Found** — scanned barcodes that match expected items (shown in green)
   - **Missing** — expected items not yet scanned (shown in red)
   - **Unknown** — scanned barcodes not in the expected list
6. When done, click **Complete Verification**.
7. Click **Print Report** to get a PDF audit record.

> Run stock verification at the end of each week and before any audit.

---

## 9. Purchase Invoices

Record stock purchased from suppliers. Every purchase adds inventory and updates the supplier ledger.

**Creating a purchase invoice**

1. Go to **Purchase** → click **New Purchase Invoice**.
2. Select or create the **Supplier**.
3. Enter the **Invoice Number**, **Invoice Date**, and **Delivery Location**.
4. Add line items:
   - Item description, HSN code, metal type, purity, gross weight, rate, making, GST %
5. Set the payment:

| Payment type | How to enter |
|---|---|
| Cash | Enter amount in Cash field |
| Cheque | Enter cheque amount + cheque number in the Cheque field |
| NEFT / Bank transfer | Enter amount + UTR number in the NEFT field |

6. **TDS withheld (if applicable):**
   - Enter the **TDS %** in the TDS field (e.g. `1` for 1%).
   - The **TDS amount** is calculated automatically.
   - The payable amount reduces by the TDS, and a **TDS Payable** ledger entry is created for you to remit later.

7. Click **Save Purchase Invoice**.
   - Stock quantities increase immediately.
   - The supplier ledger is updated (net of TDS).

**LOT / Bulk purchase (Loose stock)**

For purchasing bulk/untagged metal by weight:
1. Set **Purchase Mode = LOT** before saving.
2. The system ingests the weight without creating individual barcode tags.
3. These items appear in **Inventory → Loose vs Tagged** under the LOOSE category.

**Supplier opening balance**

When adding a new supplier for the first time, enter an **Opening Balance** (₹ amount) and select **Credit** (you owe them) or **Debit** (they owe you). This sets the starting point for the supplier ledger.

---

## 10. POS Billing — Making a Sale

The core daily screen. Laid out in three columns: **Customer (left) · Cart (centre) · Payment (right)**.

**Step 1 — Select the customer**

- Search by name or phone number to find an existing customer.
- Type a new name and press **Enter** for a quick Walk-in customer.
- Click **+** to add a full-KYC customer without leaving the billing screen.
- If the customer has an outstanding **Udhari (credit) balance**, it shows here — collect it before billing.
- **Loyalty Points** balance is shown and can be redeemed (1 point = ₹1 discount).

> If a customer is **blacklisted**, the system will block any credit/udhari checkout with the blacklist reason shown. Cash sales remain allowed.

**Step 2 — Build the cart**

- **Scan the barcode** of each piece to add it instantly, or search by name.
- Each cart line shows: item name, purity, weight, rate, making, GST, and line total.
- Adjust the **Metal Rate** or **Making** directly in the row if needed.
- Remove a line with the trash icon.

**Step 3 — Take payment**

| Payment type | Field | Notes |
|---|---|---|
| Cash | Cash | Enter amount; change is calculated automatically |
| UPI | UPI | Enter amount + UPI reference |
| Card | Card | Enter amount |
| Cheque | Cheque | Enter amount + cheque number |
| NEFT / Bank | NEFT | Enter amount + UTR number |
| Udhari / Credit | Udhari | Enter amount; requires customer selected |

- Use any combination — the **Balance Remaining must reach ₹0** before checkout is enabled.
- Apply a **Total Discount** (flat ₹ or %) from the totals panel.

**Step 4 — Compliance fields (auto-prompted)**

For cash bills ≥ ₹2,00,000 or any URD (old gold) transaction, the system requires:
- Customer PAN
- Customer Aadhaar (12 digits)
- ID document upload

**Step 5 — Checkout**

1. Click **Checkout**.
2. Confirm the "Save on Credit?" dialog if any amount is on Udhari.
3. The **Print** panel opens — choose **A4 (GST)**, **A5**, or **Thermal (80mm)**, select a template, and print or send via WhatsApp.

After checkout:
- Sold items become **SOLD** in inventory.
- The sale posts to the Day Book (Cash / Bank ledger).
- Loyalty points are awarded.
- Any credit shows in the customer's Udhari balance.

---

## 11. Customer Orders

Book made-to-order items (e.g. a custom necklace) with advance collection.

1. Go to **Order Booking**.
2. Select or add the customer.
3. Enter the **item specification**, expected **delivery date**, and **advance amount** paid.
4. Save the order.
5. When ready, open the order and click **Convert to Invoice** to bill the customer (advance is deducted from final amount).

Track all pending/fulfilled orders from the same screen.

---

## 12. Returns

Handle sales returns (customer returning a piece) and purchase returns (returning to supplier).

1. Go to **Returns**.
2. Choose **Sales Return** or **Purchase Return**.
3. Search and select the original invoice.
4. Select the line item(s) being returned.
5. Choose refund method: **Cash Refund** or **Store Credit**.
6. Save.

After saving:
- Items return to **IN_STOCK** status in inventory.
- The relevant ledger is reversed.
- A return receipt can be printed.

---

## 13. Approval / Jangad Memo

Send items out "on approval" — the customer takes them home to show family but hasn't paid.

1. Go to **Approval Memo** → **New Memo**.
2. Select the customer and add the items leaving the shop.
3. Set the **Approval Period** (return-by date).
4. Save the memo and print the approval slip for the customer to sign.

While on memo, items show **IN_MEMO** in inventory (not IN_STOCK and not SOLD).

**Closing a memo**

- **Items returned:** select the memo → mark items returned → stock is restored.
- **Items sold:** select the memo → convert retained items to a sale invoice → billing proceeds normally.

---

## 14. Old Gold Exchange & URD Vouchers

**During a sale (URD in POS):**

In the cart's **URD / Old Gold Exchange** section:
1. Enter the description of the old gold being given.
2. Enter **Tunch** (purity %), **Weight** (grams), and the agreed **Rate** (₹/gram).
3. Click **Add** — the value is deducted from the bill total.

This creates an Unregistered Dealer entry for GST purposes.

**Standalone old-gold purchase:**

1. Go to **URD Voucher**.
2. Select or add the customer.
3. Enter the old gold details.
4. Save — the customer is paid from the cash ledger and a standalone URD voucher is created.

---

## 15. Repairs

Log and track repair and service jobs.

1. Go to **Repairs** → **New Repair Job**.
2. Select or add the customer.
3. Enter: item description, condition received, **weight in**, estimated charge, and **promised date**.
4. Save — a job card with a job number is created.
5. Update the status as work progresses: **Received → In Workshop → Ready → Delivered**.
6. On delivery, collect payment and close the job. The cash ledger updates.

Print the **Job Card** for the customer's receipt copy.

---

## 16. Customers & CRM

Manage your complete customer database with purchase history, KYC, and metal accounts.

### Adding a customer

1. Go to **CRM** → **Add Customer**.
2. Fill in the form:

| Field | Notes |
|---|---|
| Name | Required |
| Phone | Required, 10–15 digits |
| WhatsApp number | Defaults to phone if same |
| Email | Optional |
| GSTIN | For B2B customers — 15 characters |
| Birthday / Anniversary | Used for automatic greetings |
| PAN / Aadhaar | For compliance on large transactions |
| Loyalty enrolled | Toggles loyalty point earning |
| Opening Balance | Enter any pre-existing credit or debit balance |

3. Click **Save Customer**.

### KYC Documents

1. Open the customer record → **KYC** section.
2. Click **Upload Document**.
3. Select **Document Type**: Aadhaar, PAN, Passport, Driving Licence, or **Voter ID**.
4. Upload the image.
5. Save.

All uploaded KYC images are stored securely and displayed in the customer's profile.

### Metal Balances

Track how much gold or silver the customer owes you or you owe them (e.g. metal given for jewellery making).

1. Open the customer record → **Metal Balances** section.
2. Click **Add Entry**.
3. Select **Metal Type** (GOLD / SILVER / PLATINUM), enter **Fine Weight (mg)**, and set direction:
   - **TO_RECEIVE** — customer owes this metal to the shop
   - **TO_PAY** — shop owes this metal to the customer
4. Add an optional note.
5. Save.

All metal balance entries are listed with running totals and are visible in the Customer 360 view.

### Blacklisting a customer

Prevents a blacklisted customer from taking any credit/udhari purchases or new Girvi loans.

1. Open the customer record → **Blacklist** section.
2. Click **Blacklist Customer** (Admin only).
3. Enter the reason (e.g. "Cheque bounce — 3 times").
4. Confirm.

A red **BLACKLISTED** badge appears on the customer card. Cash sales remain allowed.

To remove the blacklist: click **Remove Blacklist** in the same section.

### Customer 360 View

Click any customer to see their complete profile:
- Full purchase history with invoice amounts
- Girvi loans (active and closed)
- Udhari balance
- Loyalty points
- Metal balances
- GSS scheme instalments
- KYC documents on file

---

## 17. Gold Saving Schemes

Run monthly savings schemes that mature into a gold purchase.

### Building a scheme template (Admin/Manager)

1. Go to **GSS Schemes** → **New Scheme**.
2. Enter: scheme name, instalment amount (₹/month), duration (months), and bonus months.
   - Example: **11+1 scheme** — customer pays 11 months, gets the 12th month free.
3. Save.

### Enrolling a customer

1. Go to **GSS** → **Enrol Customer**.
2. Select the customer and choose the scheme.
3. Set the start date.
4. Save — a new scheme account is created.

### Recording instalments

1. Open the customer's scheme account.
2. Click **Record Instalment** → enter the amount and payment mode.
3. The balance updates. Print a **GSS Receipt** for the customer.

### Maturity

When all instalments are paid, the scheme matures. Convert the total value to a sale:
1. Go to the scheme account → **Redeem / Convert to Sale**.
2. The accumulated credit applies as a discount in POS at the customer's next purchase.

---

## 18. Girvi — Pawn / Moneylending

Lend money against pledged gold jewellery, with statutory compliance for moneylending licences.

### Issue a new loan

1. Go to **Girvi** → **Issue New Loan**.
2. Select the **Customer**.
3. Enter:

| Field | Notes |
|---|---|
| Loan Number | Auto-fills (e.g. GRV-0001) — override if needed |
| Principal Amount | Amount lent (validated against loan-to-value cap) |
| Disbursement Ledger | Cash or Bank ledger to disburse from |
| Issue Date | Date of loan |
| Interest Rate % | e.g. `2` for 2% per month |
| Interest Type | Simple or Compound |
| Rate Period | Monthly / Annual |
| Redemption Deadline | Auto-set to issue date + redemption period (default 12 months) — override if needed |
| Collateral items | Add each pledged piece: description, metal, purity, gross weight, stone deduction |

4. (Optional) capture the borrower's **Photo** and **Thumbprint**.
   - Cash loans over ₹2,00,000 require PAN + Aadhaar.
5. Click **Issue Loan**.
6. Print the **Pavati / Pawn Receipt** — available in English, Marathi (मराठी), Hindi (हिंदी), or Gujarati (ગુજરાતી).

> If the customer is **blacklisted**, the loan issue is blocked.

### Recording repayments

1. Go to **Girvi** → **Active Loans & Repayments**.
2. Select the loan.
3. Click **Record Repayment** — enter the amount paid.
4. The outstanding balance (principal + accrued interest) reduces.
5. Print a **Girvi Receipt** for the customer.

### Loan account statement

1. Open any loan → click **Statement**.
2. A PDF is generated showing: loan header, all repayments with principal/interest split, interest accrued to date, and closing outstanding balance.

### Statutory forms

1. Open any loan → click **Statutory Form**.
2. The form is generated using your **Moneylending Licence** details (see Settings → Moneylending Licence).

### Redemption & auction notices

The **redemption deadline** is the date by which the borrower must repay or renew their pledge. When this deadline passes and the loan is still active, the loan appears on the **Auction Due** worklist.

**Viewing overdue pledges:**

1. Go to **Girvi** → **Auction Due** tab.
2. All active loans past their redemption deadline are listed with **days overdue** and total outstanding amount.

**Printing auction / item-loss notices:**

1. Select the language: **English / मराठी / हिंदी / ગુજરાતી**.
2. Click **Print Notice** on a single loan to print one notice.
3. Click **Print All Notices** to print a batch PDF for all overdue loans in one go.

Each notice includes: borrower details, pledged item description, loan number, outstanding amount, and a 15-day final redemption warning.

### Moneylending licence settings

1. Go to **Girvi** → **Settings** tab (or **Settings → Moneylending Licence**).
2. Enter: **Licence Number**, **Issuing Authority**, **Expiry Date**.
3. Save.

These details appear on all statutory forms and auction notices.

### Closing a loan

When the loan is fully repaid:
1. Record the final repayment.
2. The system marks the loan **CLOSED** automatically.
3. The loan no longer appears on the Auction Due list.

---

## 19. Metal Loan

Track gold borrowed from a supplier where the rate is fixed later (unfixed / open purchase).

1. Go to **Metal Loan** → **New Metal Loan**.
2. Select the **Supplier**.
3. Enter **Purity %** (e.g. 99.99 for fine gold), **Gross Weight (grams)**, and the date received.
4. Click **Record Metal Loan**.

**Fixing the rate:**

When you decide the price:
1. Open the metal loan entry.
2. Enter the **Fix Rate** (₹/gram) and the settlement date.
3. Save — the system creates a purchase invoice at the fixed rate and updates the supplier ledger.

**Supplier metal balances:**

You can also add ad-hoc metal balance entries directly to a supplier:
1. Go to **Suppliers** → open the supplier record → **Metal Balances** section.
2. Add entries for gold/silver owed to or by the supplier.

---

## 20. Karigar / Manufacturing

Track raw metal issued to artisans and finished pieces received back.

### Adding a karigar

1. Go to **Karigar** → **+ Add Karigar**.
2. Enter name, phone, and specialisation.
3. Save.

### Issuing raw metal

1. Go to **Karigar** → **Issue Raw Metal** tab.
2. Select the **Karigar** (artisan).
3. (Optional) link a **Customer** for a custom-order job.
4. Enter:
   - Job name, target purity %, metal type
   - Gross weight issued and tunch/purity of the metal
   - The **Fine Gold Equivalent** calculates automatically.
5. Click **Issue Raw Metal**.

### Receiving a finished job

1. Go to **Karigar** → **Receive Finished Job** tab.
2. Select the active job from the list.
3. Enter:
   - Final gross weight received
   - Stone/less weight
   - Scrap weight returned
   - Wastage mode (% or grams)
   - Labour / making charge
4. The reconciliation engine checks if the issued fine gold = received fine gold + wastage. It flags **EXCESS METAL LOSS** if the numbers don't balance.
5. Click **Receive Finished Job**. (Or **Cancel Job** to return the metal to stock.)

### Karigar ledgers

1. Go to **Karigar** → **Karigar Ledgers** tab.
2. Select a karigar to view:
   - **Metal Ledger** — fine gold currently held by this karigar
   - **Cash Ledger** — labour charges pending payment
3. **Transfer to Barcode** — converts a received piece into individually tagged stock.
4. **Print Slip** — prints a transaction slip for any issue or receipt.

---

## 21. Refinery Management

Track gold sent to a refinery for purification and the purified metal returned.

1. Go to **Refinery** → **Send to Refinery**.
2. Select the refinery (supplier), enter the lot: gross weight, assay purity, and date sent.
3. Save.

**Receiving from refinery:**

1. Go to **Refinery** → open the sent lot.
2. Enter the **Fine Gold Returned** (grams) and the date received.
3. Save.
   - If fine gold returned is less than expected: the difference is booked as refinery loss.
   - If more: it is booked as a gain.
   - The metal comes back into stock.

---

## 22. Accounts & Day Book

Your complete financial control screens.

### Daily Day Book (Rokad / रोकड)

1. Go to **Accounts** → **Daily Day Book (Rokad / रोकड)**.
2. Select the date.
3. View every transaction for that day:
   - **Cash** tab — all cash inflows and outflows
   - **Bank** tab — all cheque and NEFT entries

Use this to reconcile your cash drawer at end of day.

### Ledger Statements (Khatauni / खतावणी)

1. Go to **Accounts** → **Ledger Statements (Khatauni / खतावणी)**.
2. Select any ledger: Customer, Supplier, Cash, Bank, or Expense account.
3. Set the **date range**.
4. View the complete transaction history with **opening balance**, all debits/credits, and **closing balance**.
5. Export or print.

### Expenses (Kharch / खर्च)

Record shop expenses (electricity, rent, wages, etc.):

1. Go to **Accounts** → **Expenses (Kharch / खर्च)**.
2. Click **Add Expense**.
3. Enter: description (e.g. Electricity), amount, date, and ledger.
4. Save — the cash ledger is reduced and the expense is tracked.

### Day Book Summary

Go to **Reports → Day Book Summary** to see a one-page snapshot for any date:

| Section | What it shows |
|---|---|
| Sales | Total sales revenue |
| Purchase | Total purchase value |
| Collections | Udhari collected today |
| Cash Position | Opening cash + inflows − outflows = closing cash |
| Metal Stock | Opening / Sold today / Added today / Closing — broken down by GOLD and SILVER (grams) |

The metal stock section gives you a daily gold and silver stock movement without a full physical count.

### Udhari / Credit Receipts

When a customer pays back their credit:
1. Go to **Accounts** → **Udhari Receipts**.
2. Select the customer.
3. Enter the amount paid and payment mode.
4. Save — the udhari balance reduces.
5. Print the **Udhari Receipt** for the customer.

---

## 23. GST Reports & Exports

All GST compliance reports are available under **GST Reports** (Admin / Manager only).

### Generating a report

1. Go to **GST Reports**.
2. Set the **From** and **To** dates (must be within the same financial year).
3. Click **Load**.

### GSTR-1 (HSN Summary)

Shows taxable sales grouped by HSN code with CGST, SGST, and IGST totals.

**Export options:**
- **Export CSV** — for importing into your CA's software
- **Export XLSX** — Excel workbook with a formatted HSN Summary sheet
- **Export PDF** — print-ready PDF for filing records

### B2B / B2C Split

Shows B2B sales (customers with GSTIN) and B2C sales (retail) separately.

**Export options:**
- **Export XLSX** — separate B2B and B2C sheets in one workbook

### GSTR-3B Summary

Shows the tax liability summary for the period: total taxable value, CGST, SGST, IGST, and total tax payable.

**Export options:**
- **Export XLSX**
- **Export PDF**

> All XLSX exports open directly in Microsoft Excel. The PDF exports are formatted for printing and filing.

---

## 24. E-Invoice & E-Way Bill

For GST-registered businesses generating e-invoices and e-way bills.

1. Go to **GST → E-Docs**.
2. Select the invoice you want to process.

**E-Invoice (IRN generation):**
1. Click **Generate E-Invoice**.
2. The app submits to the IRP (Invoice Registration Portal) and receives an **IRN** (Invoice Reference Number) and **QR code**.
3. Click **Print E-Invoice** — the PDF includes the IRN and QR code as required by GST law.

**E-Way Bill:**
1. For goods movement above ₹50,000, click **Generate E-Way Bill**.
2. Enter transporter details and vehicle number.
3. The system returns an **EWB Number** for the consignment.

---

## 25. Reminders & Receivables Ageing

Track outstanding credit and follow up with customers.

1. Go to **Reminders**.
2. The ageing table shows all customers with outstanding Udhari balances, grouped by:
   - 0–30 days
   - 31–60 days
   - 61–90 days
   - 90+ days (overdue)

3. Click **Send Reminder** beside any customer to send a WhatsApp payment reminder.
4. Girvi loans approaching or past their redemption deadline also appear here.

> Use this screen daily to manage collections and prevent bad debt.

---

## 26. Messenger & Auto-Greetings

Send WhatsApp messages to customers and automate birthday and anniversary wishes.

### Message Templates

1. Go to **Messenger** → **Templates** tab.
2. Default templates provided:
   - `BIRTHDAY_WISHES` — sent on customer's birthday
   - `ANNIVERSARY_WISHES` — sent on customer's wedding anniversary
   - `PAYMENT_REMINDER` — for overdue Udhari
3. Edit any template text. Use `{{customer_name}}` and `{{shop_name}}` tokens.
4. Click **Save Template**.

### Sending a manual message

1. Go to **Messenger** → **Compose** tab.
2. Search for the customer.
3. Select a template.
4. Click **Send** — WhatsApp opens (or the message is queued if WhatsApp integration is configured).

### Auto-Greetings (Automated daily dispatch)

The app can automatically send birthday and anniversary wishes every morning without any manual action.

**Enable auto-greetings (Admin only):**

1. Go to **Messenger** → **Reminders / Wishes** tab.
2. Find the **Auto Greetings** panel.
3. Toggle **Enable Auto-Greetings** to ON.
4. Click **Save**.

Once enabled, the app runs a background check every hour and sends wishes to any customer whose birthday or anniversary falls on today's date. Each customer receives the wish only once per day (duplicate sends are prevented).

**Testing manually:**

Click **Run Now** to trigger the dispatch immediately. The result shows:
- `birthdays_sent` — number of birthday wishes sent today
- `anniversaries_sent` — number of anniversary wishes sent today
- `skipped_already_sent` — customers who already received a wish today

> **Note:** Customers without a saved phone number are skipped automatically.

> **Staff cannot change the toggle** — only Admin can enable or disable auto-greetings.

---

## 27. Report Builder

Build custom reports beyond the standard ones.

1. Go to **Reports → Report Builder**.
2. Select the **Report Type**: Sales, Purchase, Stock, Karigar, Customer.
3. Set the **date range** and any filters (category, metal, salesman, location).
4. Click **Run Report**.
5. View results in the table.
6. Click **Export CSV** to download.

**Loose vs Tagged Stock Report:**

1. In Report Builder, select report type **Stock**.
2. Enable the **Loose vs Tagged** filter.
3. Run the report — results show LOOSE and TAGGED stock separately with weight and value totals per metal and category.

---

## 28. Print Template Builder

Design the layout of your invoices, receipts, and barcode labels. Available in **Settings → Print Templates** (Admin only).

### Navigating the builder

The builder is split into two panels:
- **Left panel** — settings (3 tabs: Branding, Content, Advanced)
- **Right panel** — live preview that updates as you change settings

At the top you can:
- **Load a preset** — start from a ready-made template (Retail Invoice A4, Thermal Bill, GSS Receipt A5, Barcode Label 50×25)
- **Select an existing template** to edit it
- **Duplicate** a template to use it as a starting point

### Branding tab

| Setting | Options |
|---|---|
| Color Theme | 6 one-click themes: Classic, Gold, Emerald, Navy, Maroon, Minimal |
| Header Background | Custom colour picker |
| Header Text | Custom colour picker |
| Font Family | Sans-Serif (modern), Serif (traditional), Monospace (thermal) |
| Font Size | Small (8pt) / Medium (9pt) / Large (10pt) |
| Logo | Show / Hide; Position: Left / Centre / Right |
| Table Style | **Lines** (full borders), **Clean** (horizontal lines only), **Zebra** (alternating row shading) |

### Content tab

| Setting | Notes |
|---|---|
| Template Name | Name shown in the print-template dropdown |
| Document Type | Invoice / Receipt / Label |
| Paper Size | A4, A5, Thermal 80mm, Label 50×25mm, Label 65×35mm |
| Header | Show/Hide |
| Header Lines | Individual editable lines — click + to add, × to remove. Use tokens like `{{shop.name}}`, `{{shop.address}}`, `{{shop.gstin}}` |
| Footer Text | One-line message at the bottom |
| Invoice Fields | Drag to reorder — click a field to add it, × to remove |
| Table Columns | Drag to reorder — item, purity, weight, rate, making, GST, amount |

### Advanced tab

| Setting | Notes |
|---|---|
| Signature Line | Optional "Authorised Signatory" line at the bottom — enter your own label |
| Terms & Conditions | Optional text block printed below the total |
| Default | Make this template the default for its document type |
| Active | Show/Hide this template in all print menus |
| Token Reference | Copy-ready list of all `{{tokens}}` you can use in header lines |

### Saving

Click **Save Template** at the bottom of the left panel. The template is immediately available in all print menus across the app.

---

## 29. Backup & Recovery

Your data is critical. Set up automatic backups to protect against data loss.

### Manual backup

1. Go to **Settings → Backup & Recovery**.
2. Click **Backup Now**.
3. A ZIP file is created at the configured backup folder location.

### Scheduled backup

1. In **Backup & Recovery**, enable the **Scheduled Backup** toggle.
2. Set the time (e.g. 11:00 PM daily).
3. The app backs up automatically every day at that time.

### USB backup

1. Insert your USB drive.
2. Enable **USB Backup** and select the USB drive letter.
3. Every backup (manual or scheduled) is also copied to the USB drive.

### Encrypted backups

1. Enable **Encryption** and set a backup password.
2. All backup files are AES-encrypted — the password is required to restore.

> Keep the backup password written down somewhere safe. If you lose it, the encrypted backup cannot be recovered.

### Exit backup

When you close the app, a **"Backing up before exit…"** overlay appears for up to 15 seconds while the backup completes. Do not force-close the app during this time.

### Restoring from backup

1. Go to **Settings → Backup & Recovery** → **Restore** tab.
2. Click **Choose Backup File** and select a `.zip` backup.
3. Enter the password if the backup is encrypted.
4. Click **Restore**.
5. The app restarts and loads the restored data.

> Restoring replaces all current data with the backup. Ensure you choose the correct file.

---

## 30. Staff User Management & Roles

Add and manage staff accounts. (Admin only.)

1. Go to **Settings → Staff Users**.
2. Click **Add User**.
3. Enter: **Username**, **Display Name**, **Password**, and select a **Role**.

### Role permissions

| Role | Permissions |
|---|---|
| **Admin** | Full access — all modules, settings, reports, user management |
| **Manager** | Same as Admin except cannot manage users or change firm settings |
| **Staff** | POS Billing, Inventory view, CRM, Karigar, Repairs — cannot access Reports, GST, or Settings |

### Changing a password

1. Open the user record.
2. Enter a new password in the **Change Password** field.
3. Save.

### Deactivating a user

1. Open the user record.
2. Toggle **Active** to off.
3. Save — the user can no longer log in.

---

## 31. Settings

Access via the **gear icon** in the sidebar.

### Organisation

Update shop name, address, GSTIN, PAN, and contact details. These appear on all printed documents.

### Rate API Key

Enter your MCX/gold-rate API key for live rate sync. The key is stored per-shop inside the app.

### Moneylending Licence

Enter your moneylending licence details:
- Licence Number
- Issuing Authority
- Expiry Date

These appear on Girvi statutory forms and auction notices.

### Firms

Manage multiple firm profiles (for shops with more than one business entity). Switch the active firm from this screen.

### GST Redemption Period

Set the default **Girvi Redemption Period** in months (default: 12 months). New loans auto-calculate their redemption deadline from this setting.

### Print Templates

Opens the Print Template Builder (see [Section 28](#28-print-template-builder)).

### Hardware — Weighing Scale

1. Go to **Settings → Hardware**.
2. Select the **COM port** and **baud rate** of your weighing scale.
3. Click **Connect**.
4. Place an item on the scale — the weight appears live in the POS weight field and the Barcode tag creation screen.

---

## 32. Tips & Keyboard Shortcuts

**Barcode scanning**
- Keep the barcode scanner in **USB HID mode** (it appears as a keyboard).
- In POS, the scan box is always active — just scan without clicking first.
- In Stock Verification, scan continuously — each scan auto-submits.

**Speed tips**
- In POS, press **Enter** after typing a customer name to create a Walk-in quickly.
- The **Tab** key moves between fields in all forms.
- Use **Print All Labels** in Barcode to print an entire batch in one click instead of one by one.

**End-of-day checklist**
1. Check **Day Book Summary** — verify cash and metal stock match.
2. Check **Reminders** — note any outstanding Udhari over 30 days.
3. Check **Girvi → Auction Due** — review any loans past their redemption date.
4. Close the app — the exit backup runs automatically.

**Recovery tips**
- If the app shows "Connecting to server…" for more than 60 seconds, close and reopen. The backend sidecar restarts automatically.
- If data looks wrong after a crash, go to **Settings → Backup → Restore** and restore the last known good backup.
- Only one window of the app can be open at a time — opening a second instance focuses the existing window.

---

*Guide version: 0.1.0 · Last updated: June 2026*
