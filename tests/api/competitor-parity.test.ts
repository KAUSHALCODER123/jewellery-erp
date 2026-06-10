import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import {
  customers,
  invoiceLines,
  invoices,
  items,
  journalEntries,
  ledgers,
  printTemplates,
  purchaseInvoices
} from "../../src/db/schema.js";

// Covers the competitor-parity batch: cheque/NEFT split payments, CGST/SGST
// line-vs-header reconciliation, quantity-wise fine weight, location-scoped stock
// verification, batch label printing, TDS on purchases, LOT→LOOSE stock and the
// loose-vs-tagged report, and the day book metal-stock block.
describe("Competitor parity features", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  function checkoutPayload(cartItems: unknown[], totals: Record<string, number>, payments: Record<string, number>) {
    return {
      cartItems,
      urdItems: [],
      totals,
      payments: { cash: 0, upi: 0, card: 0, udhari: 0, gssCredit: 0, ...payments },
      paymentReferences: { cash: null, upi: null, card: null, cheque: "CHQ-001122", dd: null, neft: "NEFT-UTR-9", bankName: "Test Bank" },
      invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
      kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
    };
  }

  function cartLine(itemId: number, barcode: string, netMg: number, itemTotalPaise: number, gstPaise: number) {
    return {
      itemId,
      barcode,
      metalType: "Gold",
      purityKarat: 22,
      grossWeightMg: netMg,
      netWeightMg: netMg,
      stoneWeightMg: 0,
      metalRatePaisePerGram: 600000,
      makingChargePaise: 0,
      wastageChargePaise: 0,
      gstPaise,
      itemTotalPaise
    };
  }

  it("records cheque and NEFT split payments on the invoice and posts them to the bank ledger", async () => {
    const itemTotalPaise = 6000000;
    const res = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        checkoutPayload(
          [cartLine(1, "ITEM-001", 10000, itemTotalPaise, 0)],
          { grossTotalPaise: itemTotalPaise, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: itemTotalPaise, gstPaise: 0 },
          { cash: 2000000, cheque: 2500000, neft: 1500000 }
        )
      );

    expect(res.status).toBe(201);

    const invoice = db.select().from(invoices).where(eq(invoices.id, res.body.invoice_id)).get();
    expect(invoice?.cheque_amount_paise).toBe(2500000);
    expect(invoice?.neft_amount_paise).toBe(1500000);
    expect(invoice?.payment_mode).toBe("MIXED");

    // Cheque + NEFT both land on a BANK ledger.
    const bankEntries = db
      .select({ amount: journalEntries.amount_paise, type: journalEntries.transaction_type, account: ledgers.account_type })
      .from(journalEntries)
      .innerJoin(ledgers, eq(journalEntries.ledger_id, ledgers.id))
      .all()
      .filter((entry) => entry.account === "BANK" && entry.type === "DEBIT");
    const bankTotal = bankEntries.reduce((sum, entry) => sum + entry.amount, 0);
    expect(bankTotal).toBe(2500000 + 1500000);
  });

  it("reconciles per-line CGST/SGST exactly to the invoice header splits", async () => {
    // Three lines with odd-paise GST: per-line floor alone would lose 1 paise vs the header.
    const lines = [
      cartLine(1, "ITEM-001", 10000, 2000101, 101),
      cartLine(2, "ITEM-002", 20000, 3000101, 101),
      cartLine(3, "ITEM-003", 5000, 1000101, 101)
    ];
    const gross = lines.reduce((sum, line) => sum + line.itemTotalPaise, 0);

    const res = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        checkoutPayload(
          lines,
          { grossTotalPaise: gross, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: gross, gstPaise: 303 },
          { cash: gross }
        )
      );

    expect(res.status).toBe(201);

    const invoice = db.select().from(invoices).where(eq(invoices.id, res.body.invoice_id)).get();
    const persistedLines = db.select().from(invoiceLines).where(eq(invoiceLines.invoice_id, res.body.invoice_id)).all();

    const lineCgst = persistedLines.reduce((sum, line) => sum + (line.cgst_paise ?? 0), 0);
    const lineSgst = persistedLines.reduce((sum, line) => sum + (line.sgst_paise ?? 0), 0);
    expect(lineCgst).toBe(invoice?.cgst_paise);
    expect(lineSgst).toBe(invoice?.sgst_paise);
    expect(lineCgst + lineSgst).toBe(303);
  });

  it("returns fine weight 0 for quantity-wise items instead of recalculating from purity", async () => {
    db.insert(items)
      .values({
        barcode: "COIN-QTY-01",
        category: "Coins",
        metal_type: "Gold",
        purity_karat: 22,
        gross_weight_mg: 2000,
        net_weight_mg: 2000,
        fine_weight_mg: 0,
        making_charge_type: "FLAT",
        making_charge_value: 0,
        status: "IN_STOCK",
        sale_mode: "QUANTITY_WISE",
        uom: "PIECE",
        unit_price_paise: 1500000
      })
      .run();

    const res = await request(app)
      .get("/api/inventory?search=COIN-QTY-01")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const coin = res.body.items.find((item: { barcode: string }) => item.barcode === "COIN-QTY-01");
    expect(coin).toBeDefined();
    expect(coin.fine_weight_g).toBe("0.000");
  });

  it("scopes stock verification expected items to the session location when one is set", async () => {
    // Seeded items 1-5 default to VAULT; add one COUNTER item.
    db.insert(items)
      .values({
        barcode: "COUNTER-ITEM-01",
        category: "Rings",
        metal_type: "Gold",
        purity_karat: 22,
        gross_weight_mg: 4000,
        net_weight_mg: 4000,
        making_charge_type: "FLAT",
        making_charge_value: 0,
        status: "IN_STOCK",
        location: "COUNTER"
      })
      .run();

    const startRes = await request(app)
      .post("/api/inventory/stock-verification/start")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Counter audit", location: "COUNTER" });
    expect(startRes.status).toBe(201);

    const summaryRes = await request(app)
      .get(`/api/inventory/stock-verification/${startRes.body.session.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.counts.expected).toBe(1);
  });

  it("prints a batch of labels as a single PDF and validates inputs", async () => {
    const template = db
      .insert(printTemplates)
      .values({
        name: "Test Label",
        document_type: "LABEL",
        page_size: "LABEL_50X25",
        content_json: JSON.stringify({ headerLines: [], fields: [], showHeader: false, showFooter: false, footerText: "" }),
        is_default: true,
        is_active: true
      })
      .returning()
      .get();

    const okRes = await request(app)
      .get(`/api/documents/labels/batch/${template.id}?ids=1,2,3`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(okRes.status).toBe(200);
    expect(okRes.headers["content-type"]).toBe("application/pdf");

    const badIdsRes = await request(app)
      .get(`/api/documents/labels/batch/${template.id}?ids=abc`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(badIdsRes.status).toBe(400);

    const noAuthRes = await request(app).get(`/api/documents/labels/batch/${template.id}?ids=1`);
    expect(noAuthRes.status).toBe(401);
  });

  it("computes TDS server-side on purchase invoices and ingests LOT lines as LOOSE stock", async () => {
    const lineTotal = 6000000; // 10g net at Rs 6,000/g
    const res = await request(app)
      .post("/api/pos/purchases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        supplier_name: "Parity Bullion",
        purchase_date: "2026-06-10",
        payment_mode: "CREDIT",
        gross_total_paise: lineTotal,
        gst_amount_paise: 0,
        discount_paise: 0,
        total_amount_paise: lineTotal,
        tds_percent: 0.1,
        lines: [
          {
            description: "Bulk gold lot",
            category: "Raw Gold",
            quantity: 1,
            stock_mode: "LOT",
            metal_type: "Gold",
            purity_karat: 22,
            gross_weight_mg: 10000,
            stone_weight_mg: 0,
            net_weight_mg: 10000,
            metal_rate_paise_per_gram: 600000,
            making_charge_paise: 0,
            gst_paise: 0,
            line_total_paise: lineTotal
          }
        ]
      });

    expect(res.status).toBe(201);

    const purchase = db.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, res.body.purchase.id)).get();
    expect(purchase?.tds_percent).toBe(0.1);
    expect(purchase?.tds_amount_paise).toBe(Math.round((lineTotal * 0.1) / 100));

    // LOT-mode line lands as one LOOSE weight-wise item.
    const looseItem = res.body.stock_items[0];
    expect(looseItem.stock_form).toBe("LOOSE");

    // The loose-vs-tagged report separates it from the seeded tagged stock.
    const reportRes = await request(app)
      .get("/api/reports/stock/loose-vs-tagged")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.totals.loose.pieces).toBe(1);
    expect(reportRes.body.totals.loose.net_weight_mg).toBe(10000);
    expect(reportRes.body.totals.tagged.pieces).toBeGreaterThan(0);
  });

  it("reports metal-wise opening/sold/closing stock in the day book", async () => {
    // Sell seeded ITEM-003 (5g net gold) today, then read the day book.
    const itemTotalPaise = 3000000;
    const saleRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(
        checkoutPayload(
          [cartLine(3, "ITEM-003", 5000, itemTotalPaise, 0)],
          { grossTotalPaise: itemTotalPaise, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: itemTotalPaise, gstPaise: 0 },
          { cash: itemTotalPaise }
        )
      );
    expect(saleRes.status).toBe(201);

    const dayBookRes = await request(app)
      .get("/api/reports/daybook-summary")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(dayBookRes.status).toBe(200);
    const goldRow = dayBookRes.body.metal_stock.find((row: { metal_type: string }) => row.metal_type === "Gold");
    expect(goldRow).toBeDefined();
    expect(goldRow.sold.net_mg).toBeGreaterThanOrEqual(5000);
    // Opening = closing + sold − added must hold per the response's own numbers.
    expect(goldRow.opening.net_mg).toBe(goldRow.closing.net_mg + goldRow.sold.net_mg - goldRow.added.net_mg);
  });
});
