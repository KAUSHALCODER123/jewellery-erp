import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, einvoiceDocuments, invoices, organizationSettings } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

describe("GST e-Invoice & e-Way Bill API", () => {
  let adminToken: string;
  let b2bInvoiceId: number;
  let highValueInvoiceId: number;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // setup.ts already seeds one org-settings row (without a GSTIN); update it so the e-invoice
    // generator finds a valid shop GSTIN via db.select().from(organizationSettings).get().
    db.update(organizationSettings).set({ shop_name: "Shree Jewellers", gstin: "27AAAAA0000A1Z5" }).run();

    const b2bCustomer = db.insert(customers).values({ name: "Wholesale Traders", phone: "9000011111", gstin: "27BBBBB1111B1Z3" }).returning().get();

    b2bInvoiceId = db.insert(invoices).values({
      invoice_number: "INV-EI-1",
      customer_id: b2bCustomer.id,
      total_amount_paise: 1030000,
      gst_percentage: 3.0,
      gst_amount_paise: 30000,
      taxable_value_paise: 1000000,
      cgst_paise: 15000,
      sgst_paise: 15000,
      hsn_code: "7113",
      payment_mode: "CASH",
      gst_not_required: false,
      created_at: "2026-06-05 12:00:00"
    }).returning().get().id;

    highValueInvoiceId = db.insert(invoices).values({
      invoice_number: "INV-EI-2",
      total_amount_paise: 7500000, // Rs 75,000 — above e-way threshold
      gst_percentage: 3.0,
      gst_amount_paise: 218447,
      taxable_value_paise: 7281553,
      hsn_code: "7113",
      payment_mode: "CASH",
      gst_not_required: false,
      created_at: "2026-06-05 12:00:00"
    }).returning().get().id;
  });

  test("prepares a B2B e-invoice with a deterministic IRN and QR content, then records the IRP response", async () => {
    const gen = await request(app)
      .post(`/api/einvoice/${b2bInvoiceId}/generate`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(gen.status).toBe(201);
    expect(gen.body.einvoice.supply_category).toBe("B2B");
    expect(gen.body.einvoice.status).toBe("PREPARED");
    expect(gen.body.einvoice.irp_registered).toBe(false);
    expect(gen.body.einvoice.irn).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex
    expect(gen.body.einvoice.qr_content).toContain("27AAAAA0000A1Z5");

    // IRN is deterministic — regenerating yields the same hash.
    const irn1 = gen.body.einvoice.irn;
    const gen2 = await request(app).post(`/api/einvoice/${b2bInvoiceId}/generate`).set("Authorization", `Bearer ${adminToken}`);
    expect(gen2.body.einvoice.irn).toBe(irn1);

    const rec = await request(app)
      .post(`/api/einvoice/${b2bInvoiceId}/record`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ack_no: "112410000123", signed_qr_code: "eyJhbGc..." });

    expect(rec.status).toBe(200);
    expect(rec.body.einvoice.status).toBe("REGISTERED");
    expect(rec.body.einvoice.irp_registered).toBe(true);
    expect(rec.body.einvoice.ack_no).toBe("112410000123");

    const dbDoc = db.select().from(einvoiceDocuments).where(eq(einvoiceDocuments.invoice_id, b2bInvoiceId)).get();
    expect(dbDoc?.status).toBe("REGISTERED");
  });

  test("B2C invoice (no buyer GSTIN) is categorised B2C", async () => {
    const gen = await request(app)
      .post(`/api/einvoice/${highValueInvoiceId}/generate`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(gen.status).toBe(201);
    expect(gen.body.einvoice.supply_category).toBe("B2C");
  });

  test("e-way bill flags requirement above Rs 50,000 and prepares then records the EWB number", async () => {
    const info = await request(app)
      .get(`/api/eway-bills/${highValueInvoiceId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(info.status).toBe(200);
    expect(info.body.required).toBe(true);

    const gen = await request(app)
      .post(`/api/eway-bills/${highValueInvoiceId}/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ transport_mode: "ROAD", vehicle_number: "MH12AB1234", distance_km: 12 });
    expect(gen.status).toBe(201);
    expect(gen.body.ewaybill.status).toBe("PREPARED");
    expect(gen.body.ewaybill.vehicle_number).toBe("MH12AB1234");

    const rec = await request(app)
      .post(`/api/eway-bills/${highValueInvoiceId}/record`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ eway_bill_number: "171000123456" });
    expect(rec.status).toBe(200);
    expect(rec.body.ewaybill.status).toBe("GENERATED");
    expect(rec.body.ewaybill.eway_bill_number).toBe("171000123456");
  });

  test("road e-way bill requires a vehicle number", async () => {
    const gen = await request(app)
      .post(`/api/eway-bills/${highValueInvoiceId}/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ transport_mode: "ROAD" });
    expect(gen.status).toBe(400);
  });

  test("a generated e-way bill can be cancelled with a reason", async () => {
    await request(app)
      .post(`/api/eway-bills/${highValueInvoiceId}/generate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ transport_mode: "ROAD", vehicle_number: "MH12AB1234", distance_km: 12 });
    await request(app)
      .post(`/api/eway-bills/${highValueInvoiceId}/record`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ eway_bill_number: "171000123456" });

    const cancel = await request(app)
      .post(`/api/eway-bills/${highValueInvoiceId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cancel_reason: "Vehicle breakdown" });

    expect(cancel.status).toBe(200);
    expect(cancel.body.ewaybill.status).toBe("CANCELLED");
    expect(cancel.body.ewaybill.cancel_reason).toBe("Vehicle breakdown");
  });

  test("a prepared e-invoice can be cancelled with a reason", async () => {
    await request(app).post(`/api/einvoice/${b2bInvoiceId}/generate`).set("Authorization", `Bearer ${adminToken}`);

    const cancel = await request(app)
      .post(`/api/einvoice/${b2bInvoiceId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cancel_reason: "Duplicate invoice" });

    expect(cancel.status).toBe(200);
    expect(cancel.body.einvoice.status).toBe("CANCELLED");
    expect(cancel.body.einvoice.cancel_reason).toBe("Duplicate invoice");
  });
});
