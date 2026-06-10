# Jewellery ERP

A full-featured desktop ERP for jewellery shops — built with Tauri (Rust shell), React + Vite (frontend), and Express + SQLite (backend sidecar).

## Features

| Module | Highlights |
|---|---|
| **POS Billing** | Barcode scan, split payments (Cash/UPI/Card/Cheque/NEFT/Udhari), loyalty points, URD/old-gold exchange, blacklist enforcement |
| **Inventory** | Item master, weight/qty modes, HUID, fine-weight calc, loose vs tagged stock |
| **Barcode** | Auto-numbered tags, batch label printing, stock verification (VAULT/COUNTER scoping) |
| **Purchase** | Supplier invoices, TDS withheld, LOT purchase, cheque/NEFT, metal balances |
| **Girvi (Pawn)** | Loan issue, compound/simple interest, multilingual pavati (en/mr/hi/gu), redemption period, auction notices, account statement, statutory forms |
| **Karigar** | Raw metal issue/receive, wastage reconciliation, karigar ledgers |
| **CRM** | Customer 360 view, KYC (Voter ID, Aadhaar, PAN), metal balances, blacklist, loyalty |
| **GSS** | Gold saving schemes — builder, enrolment, instalments, maturity |
| **Accounts** | Day Book (Rokad), Ledger Statements (Khatauni), Expenses (Kharch), metal stock summary |
| **GST** | GSTR-1, B2B/B2C, GSTR-3B — CSV, XLSX, and PDF exports; e-Invoice, e-Way Bill |
| **Messenger** | WhatsApp templates, auto birthday/anniversary greetings, payment reminders |
| **Reports** | Report builder, loose vs tagged, day book summary with metal stock |
| **Print Templates** | 3-tab designer — themes, font, table style, signature, terms, presets, live preview |
| **Backup** | Scheduled, USB, encrypted, exit-backup, one-click restore |
| **Hardware** | Weighing scale (serial/USB), RFID |

## Documentation

**[Full User Guide](docs/USER_GUIDE.md)** — step-by-step instructions for every feature.

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Tauri v2 (Rust) |
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Express + better-sqlite3 + Drizzle ORM |
| Desktop packaging | node.exe sidecar + server.cjs (esbuild bundle) |
| PDF | pdfmake 0.3.9 |
| Excel | exceljs |
| Tests | Jest + Supertest |

## Development

```bash
# Install dependencies
npm install

# Start dev server (frontend + backend)
npm run dev            # frontend (Vite)
npm run dev:backend    # backend (tsx watch)

# Run tests (per-suite — full run is flaky)
node --experimental-vm-modules node_modules/jest/bin/jest.js tests/api/pos.test.ts --runInBand --forceExit

# Typecheck
npm run build:typecheck

# Build desktop installer
npm run build:desktop
# Outputs:
#   src-tauri/target/release/bundle/msi/jewelry-erp_0.1.0_x64_en-US.msi
#   src-tauri/target/release/bundle/nsis/jewelry-erp_0.1.0_x64-setup.exe
```

## Database migrations

Migrations live in `drizzle/`. To apply pending migrations against a dev DB:

```bash
npm run db:migrate
```

New migrations require a `when` timestamp **above 1780902500000** in `drizzle/meta/_journal.json` and `--> statement-breakpoint` between statements.

## Default login

| Username | Password    | Role  |
|----------|-------------|-------|
| `admin`  | `admin1234` | Admin |

Change this password after first launch via **Settings → Staff Users**.
