import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { invoices } from "../../src/db/schema.js";

// Regression test for the Broken Access Control fix: every /api/documents/* route
// must require a valid session token. Because documents are opened via browser
// navigation (no Authorization header possible), the token is also accepted as a
// `?token=` query param.
describe("Documents API requires authentication", () => {
  let adminToken: string;
  let invoiceId: number;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    const invoice = db
      .insert(invoices)
      .values({ invoice_number: "DOC-AUTH-INV-1", total_amount_paise: 0, payment_mode: "CASH" })
      .returning()
      .get();
    invoiceId = invoice.id;
  });

  it("rejects an unauthenticated document request with 401", async () => {
    const res = await request(app).get(`/api/documents/invoice/${invoiceId}/a5`);
    expect(res.status).toBe(401);
  });

  it("rejects a bogus query token with 401", async () => {
    const res = await request(app).get(`/api/documents/invoice/${invoiceId}/a5?token=not-a-real-jwt`);
    expect(res.status).toBe(401);
  });

  it("accepts a valid Authorization header (auth passes — not 401)", async () => {
    const res = await request(app)
      .get(`/api/documents/invoice/${invoiceId}/a5`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).not.toBe(401);
  });

  it("accepts a valid token via the ?token= query param (auth passes — not 401)", async () => {
    const res = await request(app).get(`/api/documents/invoice/${invoiceId}/a5?token=${adminToken}`);
    expect(res.status).not.toBe(401);
  });
});
