# 17 — Hardware & Security (Scale, Printers, Trays, Anti-Theft)

**Prerequisite:** Logged in as admin; some IN_STOCK items with barcodes (test 03).
⚠️ Closing a tray with unreturned items raises **anti-theft alerts** — use a test DB. No physical
hardware is required; flows degrade gracefully to browser/simulated behaviour.

Covers device profiles (printers/scanners/RFID/trays), the **weighing-scale config**, **smart-tray**
sessions (items out/in for showroom viewing), the **exit-gate** anti-theft monitor, and **scan logs**.

> ℹ️ With no real device attached, label print falls back to **BROWSER_PRINT** and the exit gate is a
> **simulator**. A live WebSocket feed (`/ws/hardware`) drives the Monitor tab.

---

## A. Device profiles
1. Sidebar → **Hardware** → tab **Devices** → **Add Device**.
2. Fields: Name, Device Type (**THERMAL_BARCODE_PRINTER / BARCODE_SCANNER / RFID_UHF_READER / SMART_TRAY**),
   Connection Type (**USB_SERIAL / NETWORK / KEYBOARD_WEDGE / MANUAL**), then Port (if USB_SERIAL) or IP (if NETWORK),
   Baud Rate, Command Language (TSPL…), Label Page Size (LABEL_50X25…).
3. Save; then edit it (PUT).
4. **Expected:** device listed; USB_SERIAL requires a port, NETWORK requires an IP (else rejected).

## B. Weighing-scale config
1. Tab around Devices → **Scale Configuration** (Refresh Ports first).
2. Click **Refresh Ports** → COM/serial ports listed (may be empty without hardware).
3. Set Scale Port Name + Baud Rate (default 9600) → save.
4. **Expected:** saved into org settings; error **"Organization settings must be initialized first"** if settings not set up.

## C. Printers — label job
1. Tab **Printers** → search an item by barcode/HUID → pick the printer device → **Print**.
2. **Expected:** a label job dispatches; with a USB/NETWORK printer dispatch_mode = **CONFIGURED_DEVICE**, otherwise **BROWSER_PRINT**; job status PRINTED (or PRINT_FAILED).

## D. Smart trays
1. Tab **Smart Trays** → Tray Code (e.g. `TRAY-A`), Purpose (SHOWROOM_VIEW) → **Open Tray**.
2. Select the open session → add items by barcode (**Add Item**) — items log ADDED_TO_TRAY.
3. **Return Item** for one item; leave another **un-returned**.
4. Click **Close Tray**.
5. **Expected:** session CLOSED; the un-returned item produces an **anti-theft alert** (TRAY_ITEM_NOT_RETURNED) and shows in `outstanding_items`.

## E. Exit-gate monitor + scan logs
1. Tab **Monitor** → Exit Gate Simulator: enter a barcode, pick the gate device → **Simulate Scan**.
2. **Expected:** live feed updates (audio beep); scanning an item that's out/unsold may flash a red alarm.
3. Tab **History** → confirm scan-audit logs (event_type, barcode, result, context) appear newest-first.

## F. Anti-theft alerts
1. Tab **Alerts** → filter by status (OPEN/ACKNOWLEDGED/RESOLVED).
2. Find the tray alert from D; **Acknowledge** then **Resolve** (admin).
3. Optionally create a **manual alert** (alert_type + description, optional barcode).

---

## G. Edge cases

| # | Input / action | Expected |
|---|----------------|----------|
| G1 | Add USB_SERIAL device with no port | Rejected — port required |
| G2 | Add NETWORK device with no IP | Rejected — IP required |
| G3 | Scale config with non-positive baud | Rejected |
| G4 | Add item to a **CLOSED** tray session | Blocked — session must be OPEN |
| G5 | Add an **unknown barcode** to a tray | Raises UNKNOWN_TRAY_ITEM alert / records |
| G6 | Close a tray with all items returned | CLOSED with no alerts |
| G7 | Scan-audit with neither barcode nor RFID | Rejected — at least one required |
| G8 | Non-admin tries to change alert status | Blocked (admin only) |
| G9 | Label job on a non-printer device | Rejected — must be a THERMAL_BARCODE_PRINTER |

## H. Cross-checks
| # | Check | Expected |
|---|-------|----------|
| H1 | After tray add/return/close | History log has matching ADDED_TO_TRAY / return / close events |
| H2 | Unreturned item alert | Appears in Alerts (OPEN) after close (D) |
| H3 | Severity default | Manual alert without severity defaults to HIGH |
| H4 | Resolve flow | Status OPEN → ACKNOWLEDGED → RESOLVED sticks, audit-logged |

## I. What to report
- PASS/FAIL per row + exact error text.
- State which flows ran **simulated/browser** vs with real hardware.
- Confirm the tray "not returned → alert" safety path (D/H2) — the key security behaviour.
- Confirm connection-type validation (G1/G2) and admin-only alert status changes (G8).
