import request from "supertest";
import { app } from "../../src/server.js";

// Regression coverage for the Test 08 (URD / Old-Gold Purchase) fixes:
//  - KYC starts UNVERIFIED on creation (even with full PAN+Aadhaar), and stock
//    ingestion is gated behind an explicit verify-kyc step.
//  - The ingested barcode is the voucher_number itself, not "URD-" + voucher_number
//    (which double-prefixed to "URD-URD-...").
describe("URD voucher KYC gate and ingest barcode", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  async function createVoucher() {
    const res = await request(app)
      .post("/api/pos/urd-vouchers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_name: "Walk In Seller",
        customer_phone: "9999999999",
        voucher_date: "2026-06-04",
        description: "Old chain",
        metal_type: "Gold",
        purity_tunch: "91.6",
        gross_weight_mg: 10000,
        stone_weight_mg: 0,
        black_bead_weight_mg: 0,
        applied_rate_paise_per_gram: 650000,
        total_value_paise: 6500000,
        payment_mode: "CASH",
        payment_reference: "PV-1",
        // Full KYC supplied — must still start UNVERIFIED.
        pan_number: "ABCDE1234F",
        aadhaar_number: "123456789012"
      });

    expect(res.status).toBe(201);
    return res.body.voucher as { id: number; voucher_number: string; kyc_verified: boolean };
  }

  it("starts UNVERIFIED even when full PAN+Aadhaar are supplied", async () => {
    const voucher = await createVoucher();
    expect(voucher.kyc_verified).toBe(false);
  });

  it("blocks stock ingestion until KYC is explicitly verified", async () => {
    const voucher = await createVoucher();

    const blocked = await request(app)
      .post(`/api/pos/urd-vouchers/${voucher.id}/ingest-stock`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(blocked.status).toBe(422);
    expect(blocked.body.errors.join(" ")).toMatch(/KYC must be verified/i);
  });

  it("ingests after verification with a single (non-doubled) URD- barcode", async () => {
    const voucher = await createVoucher();

    const verify = await request(app)
      .patch(`/api/pos/urd-vouchers/${voucher.id}/verify-kyc`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(verify.status).toBe(200);

    const ingest = await request(app)
      .post(`/api/pos/urd-vouchers/${voucher.id}/ingest-stock`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(ingest.status).toBe(201);
    // Barcode is the voucher_number verbatim — already "URD-...", never "URD-URD-...".
    expect(ingest.body.item.barcode).toBe(voucher.voucher_number);
    expect(ingest.body.item.barcode.startsWith("URD-")).toBe(true);
    expect(ingest.body.item.barcode.startsWith("URD-URD-")).toBe(false);
  });
});
