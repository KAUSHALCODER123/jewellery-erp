import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, girviCollateral, girviLoans, girviRepayments, ledgers } from "../../src/db/schema.js";

describe("Girvi account statement & statutory forms", () => {
  let adminToken: string;
  let customerId: number;
  let loanId: number;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    db.delete(girviRepayments).run();
    db.delete(girviCollateral).run();
    db.delete(girviLoans).run();
    db.delete(customers).run();
    db.delete(ledgers).run();

    const customer = db
      .insert(customers)
      .values({ name: "Statement Customer", phone: "9876501234", address: "Statement Street" })
      .returning()
      .get();
    customerId = customer.id;

    const loan = db
      .insert(girviLoans)
      .values({
        customer_id: customerId,
        principal_amount_paise: 3000000,
        loan_number: "L-STMT-001",
        interest_rate_percentage: 2.0,
        interest_type: "SIMPLE",
        rate_period: "MONTHLY",
        interest_period_type: "MONTHLY",
        issue_date: "2026-01-01",
        total_repaid_paise: 0,
        status: "ACTIVE"
      })
      .returning()
      .get();
    loanId = loan.id;

    db.insert(girviCollateral)
      .values({ loan_id: loanId, item_description: "Gold Chain", metal_type: "GOLD", purity_karat: 22, weight_mg: 12000, valuation_rate_paise_per_gram: 600000 })
      .run();

    db.insert(girviRepayments)
      .values({
        loan_id: loanId,
        payment_date: "2026-03-01",
        amount_paise: 500000,
        interest_allocated_paise: 120000,
        principal_allocated_paise: 380000,
        discount_paise: 0,
        notice_fee_paid_paise: 0,
        loan_letter_fee_paid_paise: 0
      })
      .run();
  });

  test("GET /api/documents/girvi/:id/statement serves the account-statement PDF", async () => {
    const res = await request(app)
      .get(`/api/documents/girvi/${loanId}/statement?from=2026-01-01&to=2026-06-01`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("girvi-statement");
  });

  test("statement 404s for an unknown loan and 401s without a token", async () => {
    const missingRes = await request(app)
      .get("/api/documents/girvi/999999/statement")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missingRes.status).toBe(404);

    const noAuthRes = await request(app).get(`/api/documents/girvi/${loanId}/statement`);
    expect(noAuthRes.status).toBe(401);
  });

  test("GET /api/documents/girvi/:id/statutory/:formCode renders registry forms and rejects unknown codes", async () => {
    const okRes = await request(app)
      .get(`/api/documents/girvi/${loanId}/statutory/LOAN_DECLARATION`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(okRes.status).toBe(200);
    expect(okRes.headers["content-type"]).toBe("application/pdf");

    const unknownRes = await request(app)
      .get(`/api/documents/girvi/${loanId}/statutory/FORM_42`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(unknownRes.status).toBe(404);
  });

  test("blacklisted customers cannot be issued new girvi loans", async () => {
    db.update(customers).set({ is_blacklisted: true, blacklist_reason: "Repeated defaults" }).run();
    const ledger = db
      .insert(ledgers)
      .values({ account_name: "Cash In Hand", account_type: "CASH", balance_paise: 100000000 })
      .returning()
      .get();

    const res = await request(app)
      .post("/api/girvi/issue")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        principal_amount_paise: 1000000,
        disbursement_ledger_id: ledger.id,
        loan_number: "L-BLK-001",
        interest_rate_percentage: 2.0,
        interest_type: "SIMPLE",
        rate_period: "MONTHLY",
        interest_period_type: "MONTHLY",
        issue_date: "2026-06-01",
        collateral: [
          { item_description: "Gold Ring", metal_type: "GOLD", purity_karat: 22, gross_weight_mg: 10000, stone_deduction_mg: 0 }
        ]
      });

    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toContain("blacklisted");
  });
});
