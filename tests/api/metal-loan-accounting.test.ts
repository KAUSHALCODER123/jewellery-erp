import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { suppliers, ledgers, voucherHeaders } from "../../src/db/schema.js";

// Regression coverage for the Test 09 (Metal Loan) finding: fixing a rate must post
// the rupee payable to accounting so it shows up in supplier outstanding. The entry
// mirrors a credit purchase — DEBIT stock / CREDIT the shared "Vendor {name}" ledger.
describe("metal loan rate fix posts to accounting", () => {
  let adminToken: string;
  let supplierId: number;
  const SUPPLIER_NAME = "Metal Loan Supplier";

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    const supplier = db.insert(suppliers).values({ name: SUPPLIER_NAME, phone: "9000000123" }).returning().get();
    supplierId = supplier.id;
  });

  async function createLoan() {
    const res = await request(app)
      .post("/api/metal-loans")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ supplier_id: supplierId, metal_type: "Gold", gross_weight_mg: 100000, purity_basis_points: 9999 });
    expect(res.status).toBe(201);
    return res.body.loan.id as number;
  }

  async function fix(loanId: number, fineMg: number, ratePaisePerGram: number) {
    const res = await request(app)
      .post(`/api/metal-loans/${loanId}/fix`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fine_weight_fixed_mg: fineMg, rate_paise_per_gram: ratePaisePerGram });
    expect(res.status).toBe(201);
    return res.body;
  }

  it("creates no accounting voucher at loan creation (debt is in grams, not rupees)", async () => {
    const loanId = await createLoan();
    const voucher = db.select().from(voucherHeaders).where(eq(voucherHeaders.reference_id, loanId)).get();
    expect(voucher).toBeUndefined();
  });

  it("posts DEBIT stock / CREDIT vendor for a fixing and accrues supplier outstanding", async () => {
    const loanId = await createLoan();

    // Fix 40g @ Rs 6,500/g -> Rs 2,60,000 = 26,000,000 paise
    await fix(loanId, 40000, 650000);

    const stockLedger = db.select().from(ledgers).where(eq(ledgers.account_name, "Gold Metal Loan Stock")).get();
    const vendorLedger = db.select().from(ledgers).where(eq(ledgers.account_name, `Vendor ${SUPPLIER_NAME}`)).get();

    expect(stockLedger?.balance_paise).toBe(26000000);
    // VENDOR is a normal-debit account, so a CREDIT moves its balance negative — the payable owed.
    expect(vendorLedger?.balance_paise).toBe(-26000000);

    const voucher = db.select().from(voucherHeaders).where(eq(voucherHeaders.reference_id, loanId)).get();
    expect(voucher?.voucher_type).toBe("METAL_LOAN_FIX");
    expect(voucher?.total_debit_paise).toBe(26000000);
    expect(voucher?.total_credit_paise).toBe(26000000);
  });

  it("accrues additively across multiple fixings at different rates", async () => {
    const loanId = await createLoan();

    await fix(loanId, 40000, 650000); // Rs 2,60,000
    await fix(loanId, 59990, 660000); // 59.990g x 6,600 = Rs 3,95,934 = 39,593,400 paise

    const vendorLedger = db.select().from(ledgers).where(eq(ledgers.account_name, `Vendor ${SUPPLIER_NAME}`)).get();
    // Sum of the two fixings, not a blended average: 26,000,000 + 39,593,400 = 65,593,400
    expect(vendorLedger?.balance_paise).toBe(-65593400);
  });

  // Test 09 polish: validation messages must read in human terms, not leak raw
  // backend field names (purity_basis_points, fine_weight_fixed_mg, ... mg).
  it("returns human-readable validation messages (no raw field names)", async () => {
    const badPurity = await request(app)
      .post("/api/metal-loans")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ supplier_id: supplierId, gross_weight_mg: 100000, purity_basis_points: 20000 });
    expect(badPurity.status).toBe(400);
    expect(badPurity.body.errors).toContain("Purity must be between 0.01% and 100%.");
    expect(JSON.stringify(badPurity.body.errors)).not.toContain("purity_basis_points");

    const loanId = await createLoan(); // 99.990 g outstanding

    const noRate = await request(app)
      .post(`/api/metal-loans/${loanId}/fix`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fine_weight_fixed_mg: 40000 });
    expect(noRate.status).toBe(400);
    expect(noRate.body.errors).toContain("Enter the rate per gram (in rupees).");

    const noFine = await request(app)
      .post(`/api/metal-loans/${loanId}/fix`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ rate_paise_per_gram: 650000 });
    expect(noFine.status).toBe(400);
    expect(noFine.body.errors).toContain("Enter the fine weight to fix (in grams).");
    expect(JSON.stringify(noFine.body.errors)).not.toContain("fine_weight_fixed_mg");

    const overFix = await request(app)
      .post(`/api/metal-loans/${loanId}/fix`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fine_weight_fixed_mg: 200000, rate_paise_per_gram: 650000 });
    expect(overFix.status).toBe(400);
    // Reported in grams, not raw milligrams.
    expect(overFix.body.errors.join(" ")).toMatch(/Cannot fix 200\.000 g; only 99\.990 g outstanding\./);
  });
});
