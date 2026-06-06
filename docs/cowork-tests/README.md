# Jewelry ERP — Claude Cowork Test Plan

This folder contains **feature-by-feature test scripts** written for **Claude Cowork** to drive
the real, offline **"Jewelry ERP"** desktop app (Tauri + local SQLite). Open one file at a time,
paste it into Cowork, and let it complete the flow + edge cases for that one feature.

---

## 1. Before you start — launch the app

**If the desktop app is already built/installed:**
Open the installed app named **"Jewelry ERP"** (window title: *Jewelry ERP*, 1024×768).
It runs fully offline with its own local database.

**To run from source instead (developer machine):**
```bash
npm install
npm run db:seed     # loads demo data (firm, customers, 10 stock items, a GSS plan)
npx tauri dev       # opens the desktop window
```

## 2. Login credentials

After seeding (or in the demo build):

| Field | Value |
|-------|-------|
| Firm / Entity | **Shree Jewelers** (pre-selected) |
| Financial Year | current FY (pre-selected) |
| Username | `admin` |
| Password | `admin1234` |
| Role | ADMIN (sees every menu) |

> If the app opens on a **Setup** screen instead of Login, the database is empty —
> create the first admin there, then use those credentials everywhere below.

## 3. Seeded demo data (so flows have something to work with)

- **Firm:** Shree Jewelers — GSTIN 27AAAAA0000A1Z5, Pune
- **Customers:** Rahul Sharma (9000000001), Anita Desai (9000000002, has KYC), Vikram Singh (9000000003, has ₹15,000 udhari)
- **Stock:** 10 items (Rings, Chains, Coins; gold 22K/24K + one silver) — some barcoded, some not
- **Karigars:** Ramesh (Handmade), Suresh (Casting)
- **GSS plan:** "11-Month Dhanteras Plan" (₹5,000/month)
- **Rates:** 24K ₹7,500/g · 22K ₹6,875/g · 18K ₹5,625/g · silver ₹90/g · GST 3%

---

## 4. Ground rules for Cowork (paste these at the top of every session)

```
You are testing a live offline desktop ERP. For each step:
- Take a screenshot before and after the action so we can see the result.
- Type exactly the values given. For edge cases, try the bad input and REPORT what the app does
  (error message? blocked? accepted silently? crash?) — do not "fix" it, just record it.
- After each feature, write a short PASS/FAIL note per test case with what you observed.
- Never click Restore/Delete/Forfeit/Default on REAL data unless the script says to. We are on a test DB.
- If a screen looks different from the script, describe what you see and pause.
```

> **Use a throwaway/test database.** Several flows below are destructive (sales returns, girvi
> default/forfeit, backup restore, deleting firms). Do not run these against live shop data.

---

## 5. Recommended test order (dependencies first)

Test in this order — later features need data created by earlier ones.

| # | File | Feature | Why this order |
|---|------|---------|----------------|
| 01 | `01-auth-login-lock.md` | Login, Lock/Unlock, roles | Everything needs a session |
| 02 | `02-customer-master-crm.md` | Customer Master + CRM 360 | Billing & loans need customers |
| 03 | `03-item-inventory.md` | Item addition, groups, barcode, stones | Billing needs stock |
| 04 | `04-pos-billing.md` | POS sale, loyalty, returns, quotation | Core revenue flow |
| 05 | `05-girvi-gold-loans.md` | Girvi issue / repay / default / forfeit | Pawn loans |
| 06 | `06-order-booking.md` | Order Booking | Custom orders feed Karigar |
| 07 | `07-approval-memo.md` | Approval Memo (Jangad) | Reserves stock |
| 08 | `08-urd-old-gold-purchase.md` | URD / old-gold purchase + Purchase Invoice | Feeds stock & refinery |
| 09 | `09-metal-loan.md` | Metal Loan | Needs a supplier |
| 10 | `10-gold-saving-scheme.md` | Gold Saving Scheme (GSS) | Needs customers |
| 11 | `11-karigar-repairs.md` | Karigar jobs + Repairs | Needs karigars |
| 12 | `12-refinery.md` | Refinery | Consumes ingested old gold |
| 13 | `13-accounts-daybook-udhari.md` | Accounts / Day Book / Udhari | After POS/Girvi/GSS |
| 14 | `14-gst-einvoice-eway-huid.md` | GST Reports + e-Invoice/e-Way + BIS/HUID | Needs GSTIN + sales |
| 15 | `15-reminders-messenger.md` | Reminders + Messenger | After dues exist |
| 16 | `16-documents-print-templates-reports.md` | Documents, Print Templates, Report Builder | After data exists |
| 17 | `17-hardware-security.md` | Hardware & Security (scale, trays, anti-theft) | Needs barcoded items |
| 18 | `18-backup-recovery.md` | Backup & Recovery | Test DB only |
| 19 | `19-settings.md` | Settings (rates, loyalty, Tally, e-commerce, firms) | Rates affect everything |

All 19 files (01–19) are written and grounded in the actual app routes/components.

---

## 6. Known issue to verify first
- ~~**No Logout button.**~~ **Fixed.** The header now has **both** a **Logout** and a **Lock**
  button. Logout calls `POST /api/auth/logout`, which revokes the token's jti server-side. Confirm
  in test 01 that Logout ends the session and returns to Login.
- **No login rate-limiting.** Repeated wrong passwords on the Login screen (or the Lock overlay) are
  not throttled or locked out — confirm behaviour and note it as a hardening gap, not a crash.
