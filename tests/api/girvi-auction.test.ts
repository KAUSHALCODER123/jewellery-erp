import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, girviCollateral, girviLoans, girviRepayments, ledgers, organizationSettings } from "../../src/db/schema.js";

// Auction notices: a pledge past its statutory redemption period appears on the
// auction-due worklist and can be issued a multilingual Item/Auction notice
// (per-loan and batch).
describe("Girvi auction notices & redemption period", () => {
  let adminToken: string;
  let customerId: number;
  let ledgerId: number;

  beforeEach(async () => {
    const loginRes = await request(app).post("/api/auth/login").send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    db.delete(girviRepayments).run();
    db.delete(girviCollateral).run();
    db.delete(girviLoans).run();
    db.delete(customers).run();
    db.delete(ledgers).run();
    db.update(organizationSettings).set({ girvi_redemption_months: 12 }).run();

    const customer = db.insert(customers).values({ name: "Auction Customer", phone: "9811122233" }).returning().get();
    customerId = customer.id;

    const ledger = db.insert(ledgers).values({ account_name: "Cash In Hand", account_type: "CASH", balance_paise: 100000000 }).returning().get();
    ledgerId = ledger.id;
  });

  it("defaults redemption_deadline to issue date + redemption months on issue", async () => {
    const res = await request(app)
      .post("/api/girvi/issue")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        principal_amount_paise: 1000000,
        disbursement_ledger_id: ledgerId,
        loan_number: "L-AUC-001",
        interest_rate_percentage: 2.0,
        interest_type: "SIMPLE",
        rate_period: "MONTHLY",
        interest_period_type: "MONTHLY",
        issue_date: "2025-01-01",
        collateral: [{ item_description: "Gold Ring", metal_type: "GOLD", purity_karat: 22, gross_weight_mg: 10000, stone_deduction_mg: 0 }]
      });

    expect(res.status).toBe(201);
    expect(res.body.loan.redemption_deadline).toBe("2026-01-01"); // +12 months
  });

  it("lists loans past redemption on the auction-due worklist and prints notices", async () => {
    // A loan issued well in the past so its deadline (issue + 12m) is already overdue.
    const overdueLoan = db
      .insert(girviLoans)
      .values({
        customer_id: customerId,
        principal_amount_paise: 2000000,
        loan_number: "L-AUC-OVERDUE",
        interest_rate_percentage: 2.0,
        interest_type: "SIMPLE",
        rate_period: "MONTHLY",
        interest_period_type: "MONTHLY",
        issue_date: "2023-01-01",
        redemption_deadline: "2024-01-01",
        status: "ACTIVE",
        total_repaid_paise: 0
      })
      .returning()
      .get();

    db.insert(girviCollateral)
      .values({ loan_id: overdueLoan.id, item_description: "Gold Bangle", metal_type: "GOLD", purity_karat: 22, weight_mg: 12000, valuation_rate_paise_per_gram: 600000 })
      .run();

    // A loan not yet past redemption — must NOT appear.
    db.insert(girviLoans)
      .values({
        customer_id: customerId,
        principal_amount_paise: 1000000,
        loan_number: "L-AUC-FRESH",
        interest_rate_percentage: 2.0,
        interest_type: "SIMPLE",
        rate_period: "MONTHLY",
        interest_period_type: "MONTHLY",
        issue_date: "2099-01-01",
        redemption_deadline: "2100-01-01",
        status: "ACTIVE",
        total_repaid_paise: 0
      })
      .run();

    const dueRes = await request(app)
      .get("/api/girvi/auction-due")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(dueRes.status).toBe(200);
    expect(dueRes.body.count).toBe(1);
    expect(dueRes.body.loans[0].loan_number).toBe("L-AUC-OVERDUE");
    expect(dueRes.body.loans[0].days_overdue).toBeGreaterThan(0);

    // Per-loan auction notice PDF (Gujarati to exercise the multilingual path).
    const noticeRes = await request(app)
      .get(`/api/documents/girvi/${overdueLoan.id}/auction-notice?lang=gu`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(noticeRes.status).toBe(200);
    expect(noticeRes.headers["content-type"]).toBe("application/pdf");

    // Batch notices PDF.
    const batchRes = await request(app)
      .get(`/api/documents/girvi/auction-notices?ids=${overdueLoan.id}&lang=mr`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(batchRes.status).toBe(200);
    expect(batchRes.headers["content-type"]).toBe("application/pdf");

    // Validation + auth.
    const badBatch = await request(app)
      .get("/api/documents/girvi/auction-notices?ids=")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(badBatch.status).toBe(400);

    const noAuth = await request(app).get(`/api/documents/girvi/${overdueLoan.id}/auction-notice`);
    expect(noAuth.status).toBe(401);
  });
});
