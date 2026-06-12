# Jewellery ERP — Desktop Application User Guide

A step-by-step guide to operating the Jewellery ERP desktop app, feature by feature.
Written for shop owners, managers, and counter staff.

---

## Table of Contents
1. [Getting Started](#1-getting-started)
2. [First-Time Setup](#2-first-time-setup)
3. [Login, Logout & Screen Lock](#3-login-logout--screen-lock)
4. [Dashboards](#4-dashboards)
5. [Daily Gold/Silver Rates & Live Rate Sync](#5-daily-goldsilver-rates--live-rate-sync)
6. [Inventory & Item Master](#6-inventory--item-master)
7. [Barcode / Tag Generation](#7-barcode--tag-generation)
8. [Customers (CRM)](#8-customers-crm)
9. [POS Billing — Making a Sale](#9-pos-billing--making-a-sale)
10. [Quotations](#10-quotations)
11. [Old Gold Exchange & URD Vouchers](#11-old-gold-exchange--urd-vouchers)
12. [Customer Orders](#12-customer-orders)
13. [Returns](#13-returns)
14. [Approval / Jangad Memo](#14-approval--jangad-memo)
15. [Purchase Invoices](#15-purchase-invoices)
16. [Metal Loan (Unfixed Purchase)](#16-metal-loan-unfixed-purchase)
17. [Girvi — Pawn / Moneylending](#17-girvi--pawn--moneylending)
18. [Karigar / Manufacturing](#18-karigar--manufacturing)
19. [Repairs](#19-repairs)
20. [Gold Saving Schemes](#20-gold-saving-schemes)
21. [Accounts & Day Book](#21-accounts--day-book)
22. [GST Reports & e-Documents](#22-gst-reports--e-documents)
23. [Reminders & Receivables Ageing](#23-reminders--receivables-ageing)
24. [Messenger & CRM Automation](#24-messenger--crm-automation)
25. [Report Builder & Print Templates](#25-report-builder--print-templates)
26. [Refinery Management](#26-refinery-management)
27. [Backup & Recovery](#27-backup--recovery)
28. [Staff User Management & Roles](#28-staff-user-management--roles)
29. [Settings](#29-settings)
30. [Tips & Shortcuts](#30-tips--shortcuts)

---

## 1. Getting Started

**Launch the app** by opening **Jewelry ERP** from the Start menu (or the desktop icon).
The app runs fully offline on your computer — no internet is required except for optional
live-rate sync and WhatsApp messaging.

- The window opens to the **login screen** (or the **setup wizard** the very first time).
- All your data is stored locally in an encrypted-capable SQLite database on this PC.
- The app auto-saves a backup when you close it (if enabled in Settings).

**Default login (out of the box):**

| Username | Password   | Role  |
|----------|------------|-------|
| `admin`  | `admin1234`| Admin |

> Change this password after first login (Staff User Management) for security.

---

## 2. First-Time Setup

Only appears the very first time, when no admin account exists yet.

1. **Step 1 — Organization details:**
   - **Shop Name** (e.g. "Shree Jewellers")
   - **Contact Number**
   - **GSTIN** (optional — must be a valid 15-character GSTIN if entered)
   - **Billing Address**
   - Click **Continue**.
2. **Step 2 — Create Super Admin:**
   - **Admin Username**
   - **Password** (minimum 8 characters)
   - **Confirm Password**
   - Click **Finish Setup**.
3. You are logged in automatically as the Admin and taken to the dashboard.

---

## 3. Login, Logout & Screen Lock

**Login**
1. Enter your **Username** and **Password**.
2. Click **Sign In**.
   - Admins/Managers land on the **MIS Dashboard**; other staff land on the **Dashboard**.
   - Wrong credentials show: *"Incorrect username or password."*

**Screen Lock** (protects the till when you step away)
- Click **Lock** in the top header, **or** the app auto-locks after **15 minutes** of inactivity.
- A lock overlay appears — type your password to unlock and return to exactly where you were.

**Logout**
- Click **Logout** at the bottom of the left sidebar to end your session and return to Sign In.

---

## 4. Dashboards

There are two dashboards in the left sidebar:

**MIS Dashboard** (Admin/Manager only) — business analytics: today's sales, outstanding dues,
stock value, top movers, and trend cards. Use this for an at-a-glance health check of the shop.

**Dashboard** (all staff) — the operational screen combining the **Daily Rates** control bar
(top) and the **live inventory table** (below). This is the screen counter staff use most.

---

## 5. Daily Gold/Silver Rates & Live Rate Sync

Set here once each morning — these rates drive all billing prices. **(Admin only; staff see
rates read-only.)**

**Set rates manually**
1. Go to **Dashboard**.
2. In the **Daily Rates Control** bar, type today's **Gold 24K / 22K / 18K / Silver** rates.
3. Click **Save & Update Rates**. The **Last Synced** time updates.

**Sync live MCX rates (optional)**
1. Click **Rate API Key**, paste your gold-rate API key, and save. The status dot turns **green**.
2. Click **Sync Live MCX Rates** — the app fetches current market rates automatically.

> The API key is stored per-shop inside the app (not an environment variable). You only enter it once.

---

## 6. Inventory & Item Master

View, search, and edit your stock.

1. Go to **Inventory** (or use the table on the **Dashboard**).
2. **Filter** using the bar: search by barcode/HUID, or filter by **Category, Metal, Purity,
   Status** (IN_STOCK / SOLD / IN_MEMO).
3. The metric cards show **Items In-Stock**, total **Gold Weight**, and **Silver Weight**.
4. Click **Edit** on any row to change item details (weights, making, location, price) → save.
5. Click **Tag** on a row to preview/print that item's barcode label.

To **add** new items, use Barcode / Tag Generation (next section).

---

## 7. Barcode / Tag Generation

Create barcoded tags for new stock and verify physical stock against the system.

### Create tags
1. Go to **Barcode** → **Create Tags** tab.
2. (Optional) choose an **Item Template** to pre-fill common fields, or click **+ New Template**.
3. The **Next Tag** number auto-fills. Set:
   - **Prefix**, **Qty**, **Sale Mode** (Weight-wise or Quantity-wise), **UOM** (Gram/Carat/Piece).
   - **Unit Price** (quantity-wise items only).
   - **Category, Design, Metal, Purity.**
   - **Gross / Stone / Black-Bead** weights → **Net** and **Fine** weight calculate automatically.
   - **Making Type & ₹**, **Hallmark ₹**, **HUID**, **Location**.
4. Click **Create Barcode Tags**. New rows appear, each with a **Label** print link.
5. Click **Label** to print the physical tag for each piece.

### Verify physical stock
1. Go to the **Verify Stock** tab → **Start Verification**.
2. Scan each item's barcode into the box → **Scan**.
3. Live counts update: **Expected / Scanned / Found / Missing / Unknown**, with a missing-items list.
4. Click **Complete** → **Print Report** to file the audit.

---

## 8. Customers (CRM)

1. Go to **CRM**.
2. Click **Add Customer** and fill the form:
   - **Name** (required), **Phone** (required, 10–15 digits), WhatsApp number, Email, GSTIN.
   - Address, Area, Taluka, District.
   - Birthday, Anniversary (used for reminders), PAN, Aadhaar, Ring size.
   - **Loyalty enrolled** toggle, **Opening balance** (Debit/Credit) if they owe or are owed.
3. Save. Search any customer with the **Search by Name or Phone** box.
4. Click a customer to **edit** details or view their balance and history.

> You can also add a customer on the fly during billing — see POS Billing below.

---

## 9. POS Billing — Making a Sale

The core daily screen. Three columns: **Customer (left) · Cart (center) · Payment (right)**.

1. Go to **POS Billing**.
2. **Select the customer (left):**
   - Search an existing customer by name/phone, **or**
   - Type a name and press Enter for a quick **Walk-in**, **or**
   - Click the **+** button to add a new full-KYC customer.
   - Optionally collect **Old Dues**, redeem **Loyalty Points**, and set **Invoice Details**
     (prefix, manual number, due date, salesman, "GST Not Required" checkbox).
3. **Build the cart (center):**
   - **Scan the item's barcode** (it auto-adds), or search by name.
   - Each row lets you adjust the **Metal Rate** and **Making** charge, or remove the line (trash icon).
   - **Old Gold exchange:** under URD, enter Description / Tunch / Weight / Rate → **Add** to deduct it.
4. **Take payment (right):**
   - Review **Total Gross**, apply a **Total Discount**, see **Net Payable**.
   - Enter a **split payment**: Cash / UPI / Card / Udhari (credit), with reference fields.
   - **Balance Remaining must reach ₹0** to enable checkout.
5. **Compliance:** if cash is **₹2,00,000 or more**, or any old-gold (URD) line is present, a
   red panel requires **PAN**, **Aadhaar (12 digits)**, an ID document upload, and a selected
   customer. Fill these to proceed.
6. Click **Checkout**.
   - If any amount is on **Udhari (credit)**, confirm the **"Save on Credit?"** dialog.
7. The **Print** window opens — choose **A4 (GST)**, **A5**, or **Thermal (80mm)**, use a saved
   template, or **Send via WhatsApp** (if the customer has a phone number).

After checkout the sold items become **SOLD** in inventory, the sale posts to the Day Book,
any credit shows in the customer's balance, and loyalty points are awarded.

---

## 10. Quotations

To give a price estimate without selling (no stock is reduced):

1. Build the cart in **POS Billing** exactly as for a sale.
2. Instead of Checkout, click **Save as Quotation**.
3. The quotation is saved and can be printed/shared. Convert it to a sale later by re-billing.

---

## 11. Old Gold Exchange & URD Vouchers

**During a sale:** use the **URD / Old Gold Exchange** section in the POS cart (see step 3 above).

**Standalone purchase of old gold:** go to **URD Voucher**, enter the customer and old-gold
details (description, tunch, weight, rate) to create a standalone unregistered-dealer voucher
and pay the customer for their gold.

---

## 12. Customer Orders

Book made-to-order items (e.g. a custom ring):

1. Go to **Order Booking**.
2. Select/add the customer, enter the item specification, expected delivery date, and advance paid.
3. Save the order. Track and fulfil it from the same screen; convert to a sale on delivery.

---

## 13. Returns

Handle sales returns and purchase returns:

1. Go to **Returns**.
2. Choose the return type (sales or purchase) and look up the original invoice.
3. Select the line(s) being returned, confirm the refund/credit, and save. Stock and ledgers adjust.

---

## 14. Approval / Jangad Memo

Send items out "on approval" (memo) without selling them:

1. Go to **Approval Memo**.
2. Select the customer and add the items leaving the shop.
3. Save the memo — those items show **IN_MEMO** in inventory.
4. When items return or sell, close the memo accordingly.

---

## 15. Purchase Invoices

Record stock bought from suppliers:

1. Go to **Purchase**.
2. Select/add the supplier, enter invoice number and date.
3. Add line items (metal, weight, purity, rate, making, GST).
4. Save — stock increases and the supplier ledger updates.

---

## 16. Metal Loan (Unfixed Purchase)

Record **gold borrowed from a supplier** where the rate is fixed later:

1. Go to **Metal Loan**.
2. Select/add the **Supplier**, enter **Purity %** (e.g. 99.99) and **Gross grams** taken → record.
3. Later, when you settle, open the entry and enter the **Fix Rate** (e.g. 7250) to price the metal.

---

## 17. Girvi — Pawn / Moneylending

Lend money against pledged gold:

1. Go to **Girvi** → **Issue New Loan**.
2. Select the **Customer**; the **Loan Number** auto-fills (e.g. GRV-0001).
3. Enter the **Principal Amount** (validated against loan-to-value), and pick the Cash/Bank ledger.
4. Capture the borrower's **Photo** and **Thumbprint/Biometric** (webcam, upload, or scanner).
   - Cash loans over **₹2,00,000** require PAN + Aadhaar.
5. Issue the loan → print the **Pavati / Pawn Receipt**.
6. **Repayments:** open **Active Loans & Repayments**, select the loan, and record payments —
   the outstanding balance reduces.
7. **Closed/Defaulted:** the **Defaulted/Settled** tab lists loans that are settled or in default.

---

## 18. Karigar / Manufacturing

Track raw metal issued to artisans (karigars) and finished jobs received back.

### Issue raw metal
1. Go to **Karigar** → **Issue Raw Metal**.
2. (Optional) link a **Customer** for a custom order.
3. Pick the **Artisan**, or click **+ Add Karigar** (name, phone, specialty) to create one.
4. Enter Job Name, Target Purity %, Target Weight, Metal Type, **Gross Weight Issued**, and
   **Purity/Tunch** → the **Fine Gold Equivalent** shows live.
5. Click **Issue Raw Metal**.

### Receive finished job
1. Go to the **Receive Finished Job** tab and select the active job.
2. Enter **Final Gross**, Stone/Less, **Scrap**, wastage mode/value, and **Labour Charge**.
   - The reconciliation engine flags **"EXCESS METAL LOSS"** if the numbers don't balance.
3. Click **Receive Finished Job**. (Or **Cancel Job** to return the metal.)

### Karigar ledgers
1. Go to the **Karigar Ledgers** tab and select a karigar.
2. View the **Metal Ledger** (fine-gold owed) and **Cash Ledger** (labour pending).
3. Click **Transfer to Barcode** on a received piece to turn it into saleable, tagged stock.
4. **Print Slip** for any transaction.

---

## 19. Repairs

Log repair and service jobs:

1. Go to **Repairs**.
2. Select/add the customer, describe the repair, weight in, estimated charge, and promised date.
3. Save and track status; bill the customer on completion.

---

## 20. Gold Saving Schemes

Run customer savings schemes that mature into a gold purchase.

- **Gold Scheme** — enrol a customer in a scheme and record monthly **installments**.
- **Scheme Builder / GSS Schemes** (Admin/Manager) — define scheme rules (duration, bonus,
  payout terms).
- At maturity, convert the accumulated value into a sale (the credit applies in POS).

---

## 21. Accounts & Day Book

Your financial control screens:

- **Day Book** — every transaction for a chosen day (sales, purchases, receipts, payments).
- **Accounts** — ledger view across customers, suppliers, cash/bank, metal accounts.

Use these to reconcile cash at day-end and confirm that sales, credits, and metal movements posted correctly.

---

## 22. GST Reports & e-Documents

For tax compliance (Admin/Manager):

- **GST Reports** — generate GST summaries for filing (GSTR-ready figures).
- **GST e-Docs** — create **e-Invoices** and **e-Way Bills** for qualifying transactions.

Select the period/transaction, generate, then export or print.

---

## 23. Reminders & Receivables Ageing

1. Go to **Reminders**.
2. View outstanding receivables grouped into **ageing buckets** (e.g. 0–30, 31–60, 60+ days).
3. Use this to follow up on Udhari (credit) balances; pair with Messenger to send reminders.

---

## 24. Messenger & CRM Automation

1. Go to **Messenger**.
2. Set up and trigger automated customer messages — payment reminders, birthday/anniversary
   greetings, festival offers.
3. Messages can be sent over WhatsApp to customers with a saved phone number.

---

## 25. Report Builder & Print Templates

(Admin/Manager)

- **Report Builder** — build custom reports by choosing data fields, filters, and grouping.
- **Print Templates** — design the layout of invoices, labels, and receipts (A4, A5, thermal),
  including which fields print and the shop header.

---

## 26. Refinery Management

Track metal sent for refining:

1. Go to **Refinery**.
2. Record a batch sent out (gross, expected purity), and reconcile the fine gold returned.

---

## 27. Backup & Recovery

Protect your data. **(Admin only.)** Four tabs:

1. **Backup** — choose a target (**LOCAL / USB / CLOUD**), optionally set an **encryption
   passphrase**, and run a backup. The screen shows when the last backup ran.
2. **History** — a log of past backups with checksums. To restore: select a backup, enter its
   passphrase, and restore.
3. **Schedule** — enable **auto-backup**, set the interval (hours), target folders, cloud URL,
   how many backups to keep, and **Backup on Exit**.
4. **Recovery** — view the crash log and database state, and run an **integrity check**.

> The app applies any pending restore on startup (Windows-safe) and can back up automatically
> when you close the window.

---

## 28. Staff User Management & Roles

**(Admin only.)** Go to **Users** to create staff accounts.

Four roles, each with different access:

| Role          | Access summary |
|---------------|----------------|
| **ADMIN**     | Everything, including Backup & Recovery and User Management. |
| **MANAGER**   | All operations + MIS Dashboard, Day Book, GST Reports/e-Docs, Scheme Builder, Refinery, Report Builder, Print Templates. No Backup/Users. |
| **ACCOUNTANT**| Standard operational screens. |
| **COUNTER_STAFF** | Standard operational screens; **cannot edit gold rates** (read-only). |

To add a user: **Users** → create → enter username, password, and role. They sign in with those
credentials and see only what their role permits.

---

## 29. Settings

Configure shop-wide preferences:

- **Firms Manager** — your shop/firm master data.
- **E-commerce Sync & Webhook** — sync URL + secret; preview a catalog export.
- **Loyalty Earning Rules** — earn mode (per ₹100 spent / per gram of gold) and point values.
- **Print Language** — English / Marathi / Hindi / Gujarati (affects printouts).
- **Tally Prime XML Gateway** — enable, set gateway URL and company name to push to Tally.

> Gold rates are set on the **Dashboard**, not here.

---

## 30. Tips & Shortcuts

- **Barcode scanner** works almost everywhere — scan to add items in POS, Barcode Verify, etc.
- **Lock the screen** (top header) whenever you leave the counter.
- **Set rates first thing each morning** — all billing depends on them.
- **Back up before closing** — keep "Backup on Exit" enabled.
- **Walk-in sales** — type a name and press Enter in POS; no need to create a full customer.
- **Compliance**: have PAN + Aadhaar ready for cash sales ≥ ₹2,00,000 or any old-gold exchange.
- The app is **offline-first** — it keeps working without internet; only live rates and WhatsApp need a connection.

---

*End of guide. For day-to-day operation, the screens you'll use most are: Dashboard (rates),
POS Billing, Inventory, CRM, and Day Book.*
