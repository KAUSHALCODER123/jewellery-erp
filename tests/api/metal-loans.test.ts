import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { metalLoans, suppliers } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

describe("Metal Loan / Unfixed Purchase API", () => {
  let adminToken: string;
  let supplierId: number;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    supplierId = db.insert(suppliers).values({ name: "Bullion Bank Ltd" }).returning().get().id;
  });

  test("create loan derives fine weight, partial fix then fix-all settles the gram balance", async () => {
    // 100 g gross at 99.50% => 99.5 g (99,500 mg) fine owed
    const createRes = await request(app)
      .post("/api/metal-loans")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        supplier_id: supplierId,
        gross_weight_mg: 100000,
        purity_basis_points: 9950,
        issue_date: "2026-06-01"
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.loan.loan_number).toMatch(/^ML-\d{4}$/);
    expect(createRes.body.loan.fine_weight_mg).toBe(99500);
    expect(createRes.body.loan.fine_outstanding_mg).toBe(99500);
    expect(createRes.body.loan.status).toBe("UNFIXED");
    const loanId = createRes.body.loan.id;

    // Fix 50 g at Rs 7000/g => amount = 50 * 7000 = Rs 350,000 = 35,000,000 paise
    const fix1 = await request(app)
      .post(`/api/metal-loans/${loanId}/fix`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fine_weight_fixed_mg: 50000, rate_paise_per_gram: 700000, fixing_date: "2026-06-02" });

    expect(fix1.status).toBe(201);
    expect(fix1.body.loan.fine_outstanding_mg).toBe(49500);
    expect(fix1.body.loan.status).toBe("PARTIALLY_FIXED");
    expect(fix1.body.loan.fixed_amount_paise).toBe(35000000);

    // Fix the rest at Rs 7100/g
    const fix2 = await request(app)
      .post(`/api/metal-loans/${loanId}/fix`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fix_all: true, rate_paise_per_gram: 710000, fixing_date: "2026-06-03" });

    expect(fix2.status).toBe(201);
    expect(fix2.body.loan.fine_outstanding_mg).toBe(0);
    expect(fix2.body.loan.status).toBe("FIXED");
    // 49.5 g * 710000 paise/g = 35,145,000 paise added => total 70,145,000
    expect(fix2.body.loan.fixed_amount_paise).toBe(35000000 + 35145000);

    const dbLoan = db.select().from(metalLoans).where(eq(metalLoans.id, loanId)).get();
    expect(dbLoan?.status).toBe("FIXED");
    expect(dbLoan?.fine_outstanding_mg).toBe(0);
  });

  test("rejects fixing more grams than outstanding", async () => {
    const createRes = await request(app)
      .post("/api/metal-loans")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ supplier_id: supplierId, fine_weight_mg: 10000, purity_basis_points: 10000 });
    const loanId = createRes.body.loan.id;

    const overFix = await request(app)
      .post(`/api/metal-loans/${loanId}/fix`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fine_weight_fixed_mg: 20000, rate_paise_per_gram: 700000 });

    expect(overFix.status).toBe(400);
  });

  test("summary aggregates outstanding fine grams across loans", async () => {
    await request(app).post("/api/metal-loans").set("Authorization", `Bearer ${adminToken}`)
      .send({ supplier_id: supplierId, fine_weight_mg: 30000, purity_basis_points: 10000 });
    await request(app).post("/api/metal-loans").set("Authorization", `Bearer ${adminToken}`)
      .send({ supplier_id: supplierId, fine_weight_mg: 20000, purity_basis_points: 10000 });

    const summary = await request(app)
      .get("/api/metal-loans/summary")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(summary.status).toBe(200);
    expect(summary.body.fine_outstanding_mg).toBe(50000);
    expect(summary.body.open_loans).toBe(2);
  });
});
