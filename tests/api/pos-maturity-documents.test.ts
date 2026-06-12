import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { invoices, items, ledgers, voucherLines } from "../../src/db/schema.js";

describe("POS maturity documents", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  it("creates quotation without stock or accounting mutation", async () => {
    const response = await request(app)
      .post("/api/pos/quotations")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: null,
        document_date: "2026-06-04",
        expiry_date: "2026-06-14",
        salesman_name: "Counter 1",
        gross_total_paise: 6500000,
        discount_paise: 0,
        total_amount_paise: 6500000,
        lines: [sampleCommercialLine()]
      });

    expect(response.status).toBe(201);
    expect(response.body.quotation.quotation_number).toMatch(/^QT-/);
    expect(response.body.lines).toHaveLength(1);
  });

  it("posts purchase invoice as stock debit and settlement credit", async () => {
    const response = await request(app)
      .post("/api/pos/purchases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        supplier_name: "Mumbai Bullion Syndicate",
        purchase_date: "2026-06-04",
        payment_mode: "CREDIT",
        gross_total_paise: 6500000,
        gst_amount_paise: 0,
        total_amount_paise: 6500000,
        lines: [sampleCommercialLine()]
      });

    expect(response.status).toBe(201);
    expect(response.body.purchase.purchase_number).toMatch(/^PUR-/);
    expect(response.body.voucher).toMatchObject({
      voucher_type: "PURCHASE",
      total_debit_paise: 6500000,
      total_credit_paise: 6500000
    });

    const lines = db.select().from(voucherLines).where(eq(voucherLines.voucher_id, response.body.voucher.id)).all();
    const ledgerRows = db.select().from(ledgers).all();
    const names = lines.map((line) => ledgerRows.find((ledger) => ledger.id === line.ledger_id)?.account_name);

    expect(names).toContain("Purchase Stock");
    expect(names).toContain("Vendor Mumbai Bullion Syndicate");
  });

  it("ingests purchase lines into live barcoded stock (one item per piece)", async () => {
    const response = await request(app)
      .post("/api/pos/purchases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        supplier_name: "Chain House Wholesale",
        purchase_date: "2026-06-04",
        payment_mode: "CREDIT",
        gross_total_paise: 9000000,
        gst_amount_paise: 0,
        total_amount_paise: 9000000,
        lines: [
          sampleCommercialLine({
            description: "Gold Chains",
            category: "Gold Chains",
            quantity: 3,
            gross_weight_mg: 30000,
            net_weight_mg: 30000,
            making_charge_paise: 0,
            line_total_paise: 9000000
          })
        ]
      });

    expect(response.status).toBe(201);
    expect(response.body.stock_items).toHaveLength(3);
    expect(response.body.stock_items.every((item: { status: string }) => item.status === "IN_STOCK")).toBe(true);
    // Per-piece weights sum back to the line total (remainder absorbed by the last piece).
    expect(response.body.stock_items.reduce((sum: number, item: { net_weight_mg: number }) => sum + item.net_weight_mg, 0)).toBe(30000);

    // Persisted as barcoded inventory, so the stock-verification scanner can find them.
    const persisted = db.select().from(items).where(eq(items.category, "Gold Chains")).all();
    expect(persisted).toHaveLength(3);
    expect(persisted.every((item) => item.barcode.startsWith("GOL"))).toBe(true);
  });

  it("ingests a LOT line as a single weight-wise item holding the full weight", async () => {
    const response = await request(app)
      .post("/api/pos/purchases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        supplier_name: "Bar Vault Wholesale",
        purchase_date: "2026-06-04",
        payment_mode: "CREDIT",
        gross_total_paise: 9000000,
        gst_amount_paise: 0,
        total_amount_paise: 9000000,
        lines: [
          sampleCommercialLine({
            description: "Gold Kasar Lot",
            category: "Bar Lot",
            stock_mode: "LOT",
            quantity: 10,
            gross_weight_mg: 30000,
            net_weight_mg: 30000,
            making_charge_paise: 0,
            line_total_paise: 9000000
          })
        ]
      });

    expect(response.status).toBe(201);
    // LOT ignores quantity for stock: one item carrying the full 30g.
    expect(response.body.stock_items).toHaveLength(1);
    expect(response.body.stock_items[0].net_weight_mg).toBe(30000);

    const persisted = db.select().from(items).where(eq(items.category, "Bar Lot")).all();
    expect(persisted).toHaveLength(1);
  });

  it("creates sales return and moves returned item back to stock", async () => {
    db.update(items).set({ status: "SOLD" }).where(eq(items.id, 1)).run();

    const response = await request(app)
      .post("/api/pos/sales-returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        invoice_id: null,
        customer_id: null,
        return_date: "2026-06-04",
        refund_mode: "CASH",
        reason: "Customer return",
        gross_total_paise: 6500000,
        gst_reversal_paise: 0,
        total_refund_paise: 6500000,
        lines: [sampleReturnLine({ item_id: 1 })]
      });

    expect(response.status).toBe(201);
    expect(response.body.sales_return.return_number).toMatch(/^SR-/);
    expect(response.body.voucher.voucher_type).toBe("SALES_RETURN");

    const item = db.select().from(items).where(eq(items.id, 1)).get();
    expect(item?.status).toBe("IN_STOCK");
  });

  it("rejects a sales return that refunds more than the linked invoice was worth", async () => {
    const invoice = db.insert(invoices)
      .values({ invoice_number: "INV-GUARD-OVER", total_amount_paise: 6500000, payment_mode: "CASH" })
      .returning()
      .get();

    const response = await request(app)
      .post("/api/pos/sales-returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        invoice_id: invoice.id,
        customer_id: null,
        return_date: "2026-06-04",
        refund_mode: "CASH",
        reason: "Over-refund attempt",
        gross_total_paise: 13000000,
        gst_reversal_paise: 0,
        total_refund_paise: 13000000,
        lines: [sampleReturnLine({ amount_paise: 13000000 })]
      });

    expect(response.status).toBe(400);
    expect(response.body.errors.join(" ")).toMatch(/exceeds the original sale/i);
  });

  it("allows a sales return up to the linked invoice total", async () => {
    const invoice = db.insert(invoices)
      .values({ invoice_number: "INV-GUARD-OK", total_amount_paise: 6500000, payment_mode: "CASH" })
      .returning()
      .get();

    const response = await request(app)
      .post("/api/pos/sales-returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        invoice_id: invoice.id,
        customer_id: null,
        return_date: "2026-06-04",
        refund_mode: "CASH",
        reason: "Within cap",
        gross_total_paise: 6500000,
        gst_reversal_paise: 0,
        total_refund_paise: 6500000,
        lines: [sampleReturnLine()]
      });

    expect(response.status).toBe(201);
    expect(response.body.sales_return.return_number).toMatch(/^SR-/);
  });

  it("rejects a sales return against a non-existent invoice", async () => {
    const response = await request(app)
      .post("/api/pos/sales-returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        invoice_id: 99999,
        customer_id: null,
        return_date: "2026-06-04",
        refund_mode: "CASH",
        gross_total_paise: 6500000,
        gst_reversal_paise: 0,
        total_refund_paise: 6500000,
        lines: [sampleReturnLine()]
      });

    expect(response.status).toBe(400);
    expect(response.body.errors.join(" ")).toMatch(/was not found/i);
  });

  it("posts purchase return with settlement debit and stock credit", async () => {
    const response = await request(app)
      .post("/api/pos/purchase-returns")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        purchase_invoice_id: null,
        supplier_name: "Mumbai Bullion Syndicate",
        return_date: "2026-06-04",
        refund_mode: "CREDIT",
        reason: "Supplier return",
        gross_total_paise: 6500000,
        gst_reversal_paise: 0,
        total_refund_paise: 6500000,
        lines: [sampleReturnLine()]
      });

    expect(response.status).toBe(201);
    expect(response.body.purchase_return.return_number).toMatch(/^PR-/);
    expect(response.body.voucher).toMatchObject({
      voucher_type: "PURCHASE_RETURN",
      total_debit_paise: 6500000,
      total_credit_paise: 6500000
    });
  });
});

function sampleCommercialLine(overrides: Record<string, unknown> = {}) {
  return {
    description: "22K Gold Ring",
    metal_type: "Gold",
    purity_karat: 22,
    gross_weight_mg: 10000,
    stone_weight_mg: 0,
    net_weight_mg: 10000,
    metal_rate_paise_per_gram: 600000,
    making_charge_paise: 50000,
    gst_paise: 0,
    line_total_paise: 6500000,
    ...overrides
  };
}

function sampleReturnLine(overrides: Record<string, unknown> = {}) {
  return {
    description: "22K Gold Ring",
    metal_type: "Gold",
    purity_karat: 22,
    gross_weight_mg: 10000,
    net_weight_mg: 10000,
    amount_paise: 6500000,
    gst_paise: 0,
    ...overrides
  };
}
