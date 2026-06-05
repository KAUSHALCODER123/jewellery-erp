# Manabh Jewellery ERP v3.0 Benchmark Gap Analysis

Reference system: Manabh Jewellery ERP v3.0, legacy .NET WinForms/SQL Server jewellery retail and moneylending ERP.

Target system assessed: this repository's offline-first Tauri + React + Node.js sidecar + SQLite jewellery ERP, using the current product notes, Drizzle schema, API routes, and module screens.

## 1. Executive Verdict

The target ERP is structurally superior as a modern product platform, but Manabh remains operationally superior as a mature single-store jewellery counter system. Manabh wins where years of desktop ERP depth matter: complete invoice ergonomics, pawn paperwork, thermal print customization, shop-floor barcode discipline, and accountant-ready reports. The target wins where the future of the product is decided: Tauri desktop packaging, React UX velocity, API-centered modules, typed schema evolution, integrated Girvi/GSS/Karigar/POS data, message triggers, e-commerce hooks, and serial-device abstraction. In short, Manabh is the stronger finished shop tool today; the target has the stronger architectural runway. To out-compete Manabh, the target must convert its modern foundations into end-to-end workflows: legally usable receipts, complete ledger posting, stock verification closure, print-template control, hardware breadth, and multi-branch/cloud optionality.

## 2. Feature-by-Feature Gap Matrix

| Functional Area / Sub-Module | Reference ERP Capability | Target ERP Capability | Gap Status | Impact & Action Required |
|---|---|---|---|---|
| Deployment model | Windows desktop client/server pattern with local SQL Server operations | Tauri desktop app with React frontend, Node sidecar, local SQLite, offline-first operation | Exceeds for packaging, deficit for heavy concurrency | Keep offline desktop advantage, but add backup integrity checks, WAL tuning, and optional server/cloud mode for larger stores |
| Core POS billing | Mature single-window billing for sale, exchange, payments, and ledger posting | POS checkout API supports sales items, URD deductions, GSS credit, cash/UPI/card/udhari, KYC threshold checks, and journal entries | Match in core data flow, deficit in mature counter UX | Harden keyboard-first billing, print confirmations, returns, estimates, salesman/due-date workflows, and credit approvals |
| Gross-to-net weight math | Gross, stone/bead deductions, net weight, making, wastage | Items and barcode creation enforce gross minus stone and black bead weights; final and fine weight stored | Match | Preserve milligram integer storage and expose clear UI validation for all metals |
| Fine weight / Tunch tracking | Fine-gold conversion for Karigar and URD flows | Items, URD vouchers, material issues, job receipts, and refinery transfers store fine weight or Tunch-derived values | Match, with workflow gaps | Standardize purity basis-points across all modules and add audit reports for fine-weight movement |
| Multi-metal support | Gold-oriented with jewellery extensions for silver and other metals | Metal type is flexible text; rate settings include gold and silver; platinum not strongly modeled | Deficit | Add metal master, purity master, rate table by metal/purity/date, and platinum-specific tax/rate handling |
| HUID / BIS hallmarking | 6-character HUID tracking and compliance workflow | HUID uniqueness and format validation exist; hallmark charge exists; compliance notes describe BIS workflow | Partial match | Add BIS submission/return workflow, HUID status lifecycle, duplicate/sold HUID audit, and certificate/card printing |
| Making charges | Dynamic making/labor charge calculations by gram or fixed rules | Inventory supports PER_GRAM and FLAT; product notes mention percentage as third mode | Deficit | Implement percentage-of-metal-value mode and category/purity-specific making master |
| Wastage / melting charge | Configurable wastage percentage linked to valuation and Karigar settlement | Item wastage percentage and Karigar acceptable loss logic exist | Partial match | Carry wastage consistently into POS pricing, manufacturing variance, and accounting |
| Old gold exchange / URD in invoice | In-bill URD valuation, ledger adjustment, legal receipt | POS supports URD items inside checkout; standalone URD voucher exists with gross/stone/bead/net/fine weights | Match in model, deficit in legal reporting | Add URD receipt printing, old-gold stock ingestion, GST/export reports, and KYC hard rules by transaction type |
| Standalone URD purchase | Dedicated URD purchase and receipt workflows | Standalone URD voucher API and UI component exist | Match foundation | Add payment ledger posting, print template, and conversion to melting/refinery stock |
| Split tender payments | Cash, UPI/card, cheque/DD/NEFT and ledger debit | Checkout validates cash, UPI, card, udhari, GSS credit; payment reference JSON has cheque/DD/NEFT fields | Partial match | Treat cheque/DD/NEFT as first-class payment ledgers with bank reconciliation states |
| Customer credit / Udhari | Auto-posting customer dues and reminders | Udhari payment creates customer ledger debit; message service can trigger notifications | Partial match | Add aged debtor reports, due-date reminders, credit limit controls, and customer statement prints |
| Ledger auto-posting | Deeply embedded accounting posting from billing | Journal entries are created for payment receipts, Udhari, GSS, Girvi, but sales revenue/tax/stock COGS posting is incomplete | Deficit | Implement complete double-entry posting for every transaction event |
| GST compliance | GST invoice support and compliance reports | HSN, default GST, cash KYC, GST report module/tests exist; state-aware GST is described | Partial match | Complete CGST/SGST/IGST split, GSTR-1/3B exports, HSN summaries, and audit lock periods |
| PAN/Aadhaar threshold controls | KYC enforcement for high-value cash transactions | POS and Girvi enforce Rs 2 lakh KYC checks; KYC vault masks documents | Match | Add non-bypassable UI gates, document image capture, and audit trail for overrides |
| Barcode generation | Piece-level tags, print workflows, barcode reports | Barcode sequence and batch creation APIs exist, with prefix and quantity controls | Partial match | Add print batches, thermal label templates, reprint controls, and barcode lifecycle reports |
| Barcode/RFID billing scan | Scan populates billing line | Barcode scanner hook and inventory lookup exist; route-level scan billing is possible | Partial match | Make scan-to-cart the primary POS path and add sold/duplicate scan hard blocks in UI |
| Physical stock verification | Scan tray/display stock against database, variance reporting | Stock verification sessions/scans calculate expected, found, missing, unknown | Match foundation | Add mobile/handheld scanning UX, variance approval, photo evidence, and ledger/stock adjustment workflow |
| RFID / smart tray / exit gate | Reference supports barcode/RFID-style verification; user notes envision advanced RFID | No true RFID encoding or anti-theft device integration in current code | Deficit | Add device abstraction for RFID readers/printers and event-based tray/exit workflows |
| Karigar job order | Raw material issue, Tunch conversion, receipt, wastage control, labor payout | Job orders, material issue, receive-job, acceptable loss, excess-loss anomaly, labor payable, ledger timeline, transfer to barcode stock | Exceeds in data rigor, partial in UI maturity | Build production-grade screens for each stage, payout settlement, and Karigar statement printing |
| Refinery / melting | Melting/refinery yield calculation and loss tracking | Refineries, refinery transfers, and receipts are modeled | Partial match | Complete refinery UI, chain-of-custody reports, assay certificates, charges, and stock conversion |
| Girvi loan issuance | Pawn loan with Pavati, collateral, interest, identity validation | Girvi issue supports collateral, LTV, simple/compound interest, daily/weekly/monthly/annual period, photo/thumbprint paths, loan and fee fields | Match foundation | Add multilingual Pavati/receipt prints, legal notice workflow, release/auction/default stock transfer |
| Girvi interest engine | Day-wise compounding and repayment allocation | Repayment calculation uses calendar days, simple/compound, period-based accrual, interest-first repayment with fees and discount | Match | Validate with local moneylending rules and add reducing-balance statements |
| Girvi identity security | Photo/biometric validation | Customer photo and thumbprint paths exist; no biometric device capture proven | Partial match | Integrate webcam capture and biometric device adapters with consent/audit logging |
| Gold Saving Scheme templates | Multi-month installment matrix and maturity tracking | Templates, enrollment, receipts, liability posting, maturity status, merge flow, GSS POS credit field | Partial match | Add defaulter automation, variable contribution rules, maturity-to-sale conversion workflow, and full report pack |
| Gold Scheme reporting | Pending, received, maturity, account statements | Product notes list reports; current API mainly exposes templates/accounts/payments/merge | Deficit | Implement statements, due report, received report, maturity report, and branch-wise summaries |
| Accounts and finance | Day book, ledgers, trial balance, P&L, balance sheet | Ledgers and journal entries exist; account module is present; full chart and final accounts are not complete | Deficit | Build voucher system, ledger drilldown, trial balance, P&L, balance sheet, cash/bank books |
| Bank reconciliation | Bank and payment reconciliation | Product notes mention bank reconciliation; implementation is not first-class | Deficit | Add bank accounts, statement import, UPI/NEFT matching, clearing states, and reconciliation reports |
| Tally export | Downstream accounting export | Compliance/account notes mention Tally export; no complete export workflow established | Deficit | Add Tally XML export for ledgers, vouchers, GST, and trial balance |
| Print/invoice builder | Built-in WYSIWYG thermal/laser invoice layout builder | PDF generation exists; drag-and-drop print builder is only planned | Deficit | Build print template tables, visual editor, field tokens, A4/A5/thermal formats, and protected defaults |
| Messaging automation | Transactional WhatsApp/SMS triggers | Message templates/logs and trigger calls exist for POS, Girvi, and GSS | Partial match | Wire real WhatsApp/SMS providers, retries, consent, template approval, and delivery dashboards |
| Hardware scale integration | Desktop driver/device integration | SerialPort-based RS232 scale listing/config and scale manager exist | Match for weighing scale | Add WebSocket health, calibration records, stable parsing profiles, and USB/Bluetooth variants |
| Barcode printer/scanner | Barcode hardware workflows | Scanner hook exists; label printing not implemented as a full workflow | Deficit | Add printer profiles, ZPL/TSPL support, label designer, scanner audit logs |
| Multi-branch synchronization | Reference is primarily single-store desktop | Target docs explicitly constrain core DB to single PC and no cloud/LAN sync | Deficit | Add optional branch server/cloud sync layer with conflict-free stock transfers and customer credit consistency |
| E-commerce / omnichannel | Not a core Manabh strength | Target has online publication fields and e-commerce webhook notifier | Exceeds foundation | Build inventory publish/unpublish, reserved stock states, marketplace/web storefront sync, and return flows |
| Security / RBAC | Desktop role permissions by form/menu/action | Roles exist; auth middleware and RBAC tests exist; action-level matrix is incomplete | Partial match | Add permission matrix by route, menu, action, and sensitive override |
| Audit logging | Operational logs and backup tools | Audit log table and selected audit concepts exist | Partial match | Centralize audit writes for create/update/delete, rate changes, GST bypass, and stock status changes |
| Backup and recovery | Local DB backup tools | Backup is mentioned but not central in architecture | Deficit | Add scheduled encrypted local/USB/cloud backup, restore test, checksum, and crash recovery workflow |
| Database concurrency | SQL Server handles multi-user local concurrency better | SQLite is fast and simple for single PC; synchronous better-sqlite3 limits concurrent writers | Deficit for multi-counter shops | Enable WAL, transaction discipline, queue high-write operations, and migrate to Postgres for branch/server mode |
| API/data architecture | Legacy desktop screens tightly coupled to DB | Express APIs with Drizzle schema give modular integration points | Exceeds | Preserve API contract discipline and add OpenAPI/API tests for every workflow |
| AI / next-gen features | Legacy ERP has limited AI upside | AI/automation notes include OCR, vision, and digital passport ideas; not implemented | Exceeds potential, deficit in current product | Build targeted AI after data workflows are stable: HUID OCR, document OCR, item image QA, anomaly detection |

## 3. Structural & Architectural Showdown

Manabh's architecture is conservative and effective for its intended operating model: a Windows desktop retail counter attached to a local SQL Server database. It benefits from low UI latency, direct access to printers/scales, mature reporting, and predictable single-store workflows. Its limitations are the usual desktop ERP constraints: harder UI iteration, brittle local installs, manual backup discipline, limited remote access, higher risk of database/operator-local failure, and weak path to omnichannel or multi-branch real-time operations.

The target architecture is a better product chassis. Tauri keeps the desktop/offline feel while avoiding the heaviness of older desktop stacks. React accelerates UX iteration. Node gives hardware and API flexibility. Drizzle provides a typed relational model. SQLite is a sharp choice for a single-PC jeweller because deployment is simple, backups are portable, and offline operation is deterministic. The tradeoff is concurrency: SQLite with a synchronous Node backend is not the right final state for high-write multi-counter or multi-branch operations unless a queue, WAL discipline, and a server synchronization layer are added.

On data flow, the target is already more modular than Manabh. POS, inventory, Karigar, Girvi, GSS, messaging, hardware, and refinery concerns are separated into routes and schema tables. That makes modernization cheaper. However, the system is not yet financially closed. A serious ERP must guarantee that every stock, cash, bank, tax, customer, Karigar, GSS, Girvi, and refinery movement creates balanced accounting and audit entries. Today the target has journal-entry primitives and some module postings, but not a universal posting engine with immutable vouchers, period locks, reversals, and reconciliation.

On multi-branch scaling, Manabh is bounded by its local desktop roots, while the target has a clearer path but no current implementation. The recommended architecture is not to abandon offline-first. Instead, introduce an optional hub mode: local SQLite edge nodes for counters/branches, a Postgres central server for branch consolidation, durable event outbox/inbox tables, stock-transfer documents, and deterministic conflict policies. That lets small jewellers keep a simple desktop install while larger customers graduate to synchronized branches.

On hardware, Manabh likely feels more complete today because legacy desktop drivers and print forms are operationally direct. The target already has a modern RS232 serial scale layer, but must broaden the device layer: barcode scanners as keyboard wedge plus audit logs, thermal label printers, RFID/UHF readers, webcam capture, biometric capture, and resilient device status monitoring. The architectural moat is a unified hardware abstraction that works offline but exposes async events to the React UI.

## 4. Modernization Blueprint & Strategic Roadmap

### Phase 1: Immediate Deficit Mitigation

1. Complete legal POS parity.
   - Add sales return, purchase, purchase return, quotation/estimate, credit approval, bill prefix/manual number governance, due-date workflow, salesman master, and invoice save confirmations.
   - Make scan-to-cart the default counter flow and hard-block sold, missing, duplicate, or non-hallmarked tags.

2. Finish URD and old-gold compliance.
   - Print standalone and in-invoice URD receipts.
   - Convert URD purchases into old-gold/scrap stock with purity, fine-weight, source customer, and KYC linkage.
   - Add GST/audit exports for URD transactions.

3. Build complete voucher accounting.
   - Create immutable voucher headers and voucher lines.
   - Auto-post sales, GST, stock, COGS, URD, GSS, Girvi, Karigar, refinery, cash, bank, and Udhari entries.
   - Add reversal vouchers instead of destructive edits.

4. Make reports accountant-ready.
   - Day book, cash book, bank book, customer/supplier/Karigar ledgers, GSS liability, Girvi outstanding, trial balance, P&L, balance sheet, GST summaries, HSN summary.

5. Ship production print outputs.
   - Legal invoice, URD voucher, Girvi Pavati, Girvi repayment receipt, GSS receipt, Karigar issue/receipt slip, refinery challan, stock verification variance report.

### Phase 2: Architectural Moats

1. Introduce a universal transaction posting engine.
   - Use domain events such as POS_INVOICE_CREATED, URD_VOUCHER_CREATED, GSS_RECEIPT_CREATED, GIRVI_REPAYMENT_RECEIVED, KARIGAR_JOB_RECEIVED, and REFINERY_RECEIPT_CREATED.
   - Each event should atomically update business tables, stock state, ledgers, audit logs, and message outbox records.

2. Strengthen the database layer.
   - Enable and verify SQLite WAL mode for local installs.
   - Add indexes for barcode, HUID, status, customer phone, invoice date, ledger reference, GSS status, Girvi status/due date, and stock verification sessions.
   - Add period locks, migration checks, backup checksums, and restore validation.

3. Add optional multi-branch/cloud mode.
   - Keep local SQLite for offline branches.
   - Add central Postgres for consolidated reporting and branch stock allocation.
   - Use durable sync events with idempotency keys, branch IDs, stock transfer documents, and clear conflict rules.

4. Build the hardware abstraction layer.
   - Keep RS232 scale support and add profile-based parsers.
   - Add barcode printer support for TSPL/ZPL/ESC-POS.
   - Add scanner audit logs, RFID reader adapters, webcam capture, biometric capture, and device health dashboard.

5. Upgrade message and integration plumbing.
   - Add a transactional outbox for WhatsApp/SMS/email/Tally/e-commerce sync.
   - Implement retry, failure visibility, consent, template variables, and delivery status.
   - Export Tally XML for vouchers, ledgers, GST, and trial balance.

### Phase 3: Next-Gen Features

1. AI-assisted compliance capture.
   - OCR HUID from hallmark images and compare it with inventory records.
   - OCR PAN/Aadhaar/GST documents into the KYC vault with masked storage and human verification.
   - Read Girvi collateral photos into structured item descriptions for faster Pavati creation.

2. Computer-vision jewellery intelligence.
   - Detect product type, likely stone count, visible damage, and photo quality before publishing online.
   - Compare before/after repair or Girvi collateral photos for disputes.
   - Flag mismatch between declared stone weight and visual stone density for QC review.

3. Stock and fraud analytics.
   - Detect unusual Karigar loss patterns, repeated HUID corrections, abnormal discounts, repeated GST bypasses, and risky Girvi LTV patterns.
   - Score stock verification variances by employee, tray, time, and item value.

4. Digital product passport.
   - Generate QR/NFC-backed customer pages showing HUID, item photo, metal/purity, gemstone certificates, warranty, service history, and ownership transfer status.

5. Omnichannel automation.
   - Publish eligible inventory to web storefronts, reserve stock during online checkout, sync sold status back to POS, and automate post-sale WhatsApp invoices and care instructions.

## Strategic Build Order

1. Universal posting engine and voucher model.
2. POS legal parity, invoice/receipt printing, and scan-first billing.
3. URD stock ingestion, refinery settlement, and full GST reports.
4. Girvi Pavati/repayment/release/default workflows.
5. GSS statements, defaulter automation, and maturity-to-sale conversion.
6. Print designer and barcode label designer.
7. Hardware breadth: printer, scanner audit, webcam, biometric, RFID.
8. Optional branch/cloud sync and Tally export.
9. AI/vision and digital passport features.

## Final Competitive Positioning

The winning market message should not be "we are another jewellery ERP." It should be: "Manabh-style jewellery depth, but with modern offline desktop speed, integrated finance, hardware-ready workflows, omnichannel hooks, and an upgrade path from one counter to many branches." The target can out-compete Manabh only if it treats accounting correctness, print/legal paperwork, stock integrity, and hardware reliability as first-class engineering systems rather than screen-level features.
