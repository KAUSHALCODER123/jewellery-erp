import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { invoices, invoiceLines } from "../../src/db/schema.js";

describe("GST compliance reports and invoice printing layouts API", () => {
  let adminToken: string;
  let saleInvoiceId: number;
  let purchaseInvoiceId: number;

  beforeEach(async () => {
    // 1. Log in as admin to get token
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // 2. Seed a test SALE invoice directly in the test database
    const saleInvoice = db
      .insert(invoices)
      .values({
        invoice_number: "SALE-INV-999",
        invoice_type: "SALE",
        total_amount_paise: 103000, // Rs 1030 (Rs 1000 taxable + Rs 30 GST)
        gst_percentage: 3.0,
        gst_amount_paise: 3000,
        hsn_code: "7113",
        payment_mode: "CASH",
        gst_not_required: false,
        created_at: "2026-06-05 12:00:00"
      })
      .returning()
      .get();
    saleInvoiceId = saleInvoice.id;

    db.insert(invoiceLines)
      .values({
        invoice_id: saleInvoiceId,
        item_id: 1,
        metal_type: "Gold",
        purity_karat: 22,
        gross_weight_mg: 10000,
        net_weight_mg: 10000,
        metal_rate_paise_per_gram: 10000,
        making_charge_paise: 0,
        gst_paise: 3000,
        line_total_paise: 103000
      })
      .run();

    // 3. Seed a test PURCHASE invoice directly
    const purchaseInvoice = db
      .insert(invoices)
      .values({
        invoice_number: "PURCHASE-INV-888",
        invoice_type: "PURCHASE",
        total_amount_paise: 206000, // Rs 2060 (Rs 2000 taxable + Rs 60 GST)
        gst_percentage: 3.0,
        gst_amount_paise: 6000,
        hsn_code: "7113",
        payment_mode: "CASH",
        gst_not_required: false,
        created_at: "2026-06-06 14:00:00"
      })
      .returning()
      .get();
    purchaseInvoiceId = purchaseInvoice.id;

    db.insert(invoiceLines)
      .values({
        invoice_id: purchaseInvoiceId,
        item_id: 2,
        metal_type: "Gold",
        purity_karat: 22,
        gross_weight_mg: 20000,
        net_weight_mg: 20000,
        metal_rate_paise_per_gram: 10000,
        making_charge_paise: 0,
        gst_paise: 6000,
        line_total_paise: 206000
      })
      .run();
  });

  it("serves landscape A5 invoice print layouts", async () => {
    const res = await request(app)
      .get(`/api/documents/invoice/${saleInvoiceId}/a5`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.header["content-type"]).toBe("application/pdf");
  });

  it("exports GSTR-1 containing outward sales only", async () => {
    const res = await request(app)
      .get("/api/compliance/gst-export/gstr1")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        from: "2026-06-01",
        to: "2026-06-30"
      });

    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    // Should filter out GSTR-2 purchases, returning only 1 sale entry
    expect(res.body).toHaveLength(1);
    const saleItem = res.body[0];
    expect(saleItem.hsn_sc).toBe("7113");
    expect(saleItem.txval).toBe("1000.00");
    expect(saleItem.camt).toBe("15.00");
    expect(saleItem.samt).toBe("15.00");
  });

  it("exports GSTR-2 containing inward purchases only", async () => {
    const res = await request(app)
      .get("/api/compliance/gst-export/gstr2")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        from: "2026-06-01",
        to: "2026-06-30"
      });

    expect(res.status).toBe(200);
    expect(res.body).toBeInstanceOf(Array);
    // Should filter out GSTR-1 sales, returning only 1 purchase entry
    expect(res.body).toHaveLength(1);
    const purchaseItem = res.body[0];
    expect(purchaseItem.hsn_sc).toBe("7113");
    expect(purchaseItem.txval).toBe("2000.00");
    expect(purchaseItem.camt).toBe("30.00");
    expect(purchaseItem.samt).toBe("30.00");
  });

  it("provides GSTR-3B monthly summary return matching liabilities and credits", async () => {
    const res = await request(app)
      .get("/api/compliance/gst-export/gstr3b")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        from: "2026-06-01",
        to: "2026-06-30"
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      outward_supplies: {
        taxable_value_paise: 100000,
        cgst_paise: 1500,
        sgst_paise: 1500
      },
      inward_supplies: {
        taxable_value_paise: 200000,
        cgst_paise: 3000,
        sgst_paise: 3000
      },
      net_payable: {
        cgst_paise: 0, // outward 1500 - inward 3000 is negative -> bounded to 0
        sgst_paise: 0
      }
    });
  });
});
