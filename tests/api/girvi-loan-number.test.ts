import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, ledgers } from "../../src/db/schema.js";

describe("Girvi auto loan/Pavati number", () => {
  let adminToken: string;
  let customerId: number;
  let cashLedgerId: number;

  beforeEach(async () => {
    const loginRes = await request(app).post("/api/auth/login").send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    customerId = db.insert(customers).values({ name: "Pledgor", phone: "9001234567" }).returning().get().id;
    cashLedgerId = db.insert(ledgers).values({ account_name: "Cash", account_type: "CASH", balance_paise: 100000000 }).returning().get().id;
  });

  function issue(extra: Record<string, unknown> = {}) {
    return request(app)
      .post("/api/girvi/issue")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        principal_amount_paise: 100000,
        disbursement_ledger_id: cashLedgerId,
        interest_rate_percentage: 2,
        interest_type: "SIMPLE",
        rate_period: "MONTHLY",
        issue_date: "2026-06-01",
        collateral: [{ item_description: "Ring", metal_type: "GOLD", purity_karat: 22, weight_mg: 50000 }],
        ...extra
      });
  }

  it("suggests and auto-assigns sequential loan numbers", async () => {
    const next1 = await request(app).get("/api/girvi/next-loan-number").set("Authorization", `Bearer ${adminToken}`);
    expect(next1.status).toBe(200);
    expect(next1.body.loan_number).toBe("GRV-0001");

    const first = await issue();
    expect(first.status).toBe(201);
    expect(first.body.loan.loan_number).toBe("GRV-0001");

    const next2 = await request(app).get("/api/girvi/next-loan-number").set("Authorization", `Bearer ${adminToken}`);
    expect(next2.body.loan_number).toBe("GRV-0002");

    const second = await issue();
    expect(second.status).toBe(201);
    expect(second.body.loan.loan_number).toBe("GRV-0002");
  });

  it("rejects a duplicate explicit loan number with 409", async () => {
    expect((await issue({ loan_number: "GRV-0001" })).status).toBe(201);
    expect((await issue({ loan_number: "GRV-0001" })).status).toBe(409);
  });
});
