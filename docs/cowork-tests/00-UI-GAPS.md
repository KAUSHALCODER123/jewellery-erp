# UI Gaps — backend features vs front-end (RESOLVED)

Full audit of every backend API endpoint vs what the React UI can reach.
Re-run any time with: `node scripts/ui-gap-audit.mjs` (maps each router to its mount prefix
and checks every endpoint against `/api/...` references in `src/**/*.tsx`).

## Status: all functional gaps closed ✅

Latest audit: **224 endpoints checked, 0 functional gaps remaining.** The 3 endpoints the
script lists as "unreferenced" are all non-gaps (explained at the bottom).

## What was built to close the gaps

| Feature | Endpoint(s) | Where it now lives |
|---|---|---|
| Logout | `POST /api/auth/logout` | Sidebar footer → **Logout** button |
| Create staff user | `POST /api/users` | Sidebar (admin) → **Users** |
| Sales return | `POST /api/pos/sales-returns` | Sidebar → **Returns** → Sales tab |
| Purchase return | `POST /api/pos/purchase-returns` | Sidebar → **Returns** → Purchase tab |
| Quotation | `POST /api/pos/quotations` | POS → **Save as Quotation** button |
| Tally export | `GET /api/accounts/export/tally` | Accounts → **Export Tally** button |
| E-commerce catalog export | `GET /api/ecommerce/catalog/export` | Settings → **Preview Catalog Export** |
| Manual messaging | `POST /api/messenger/send-manual` | Messenger → **Send Message** tab |
| GSS account merge | `POST /api/gss/merge` | Gold Scheme → Reports & Controls → **Merge Accounts** |
| Weighing scale config | `POST /api/hardware/scale/config` | Hardware → Device Profiles → **Scale Configuration** |
| Serial/COM port list | `GET /api/hardware/ports` | Hardware → **Refresh Ports** |
| HUID certificate print | `POST /api/compliance/huid/print-certificate` | GST Reports → HUID → recorded on card print |
| Stone certificate lookup | `GET /api/inventory/stones/certificates` | Inventory → item → Stones tab → **Certificate Lookup** |
| Karigar job slip PDF | `GET /api/documents/karigar/job/:id/slip` | Karigar → Ledger → **Print Slip** |
| Stock-verification report PDF | `GET /api/documents/stock-verification/:id/report` | Barcode Desk → **Print Report** |
| GSS receipt PDF | `GET /api/documents/gss/receipt/:id` | Gold Scheme → receipt modal → **PDF** |
| Refinery challan PDF | `GET /api/documents/refinery/transfer/:id/challan` | Refinery → after issue → **Print Challan** |
| Accounting voucher PDF | `GET /api/documents/voucher/:id` | Accounts → after save → **Print Voucher** |

## The 3 "unreferenced" endpoints that are NOT gaps
- `GET /api/documents/urd-voucher/:id` — reached via the server-provided `legal_receipt_url`
  field in StandaloneUrdVoucher (a dynamic URL, so literal-string search can't see it).
- `GET /api/images/:filename` — static asset server; consumed by `<img src>` tags, not a button.
- `POST /api/auth/register` — duplicate of `POST /api/users` (staff creation), which IS wired.

## Verify (was flagged earlier, still worth a manual check)
- `GET /api/compliance/gst-export/gstr2` and `…/hsn-summary` — the GST UI builds the export path
  dynamically; confirm the dropdown reaches GSTR-2 and HSN summary, not only GSTR-1 / GSTR-3B.
