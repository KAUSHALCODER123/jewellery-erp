import request from "supertest";
import { db } from "../../src/db/client.js";
import { app } from "../../src/server.js";
import { ledgers } from "../../src/db/schema.js";

// Regression test for the back-dated audit-lock gap: manual voucher posting must
// honour GST audit locks against the voucher's EFFECTIVE (created_at) date, so a
// back-dated entry cannot slip into a frozen period.
describe("Manual voucher posting enforces audit period locks", () => {
  let adminToken: string;
  let cashLedgerId: number;
  let salesLedgerId: number;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    cashLedgerId = db.insert(ledgers).values({ account_name: "Cash A/C", account_type: "CASH", balance_paise: 0 }).returning().get().id;
    salesLedgerId = db.insert(ledgers).values({ account_name: "Sales Revenue A/C", account_type: "SALES_REVENUE", balance_paise: 0 }).returning().get().id;

    // Lock March 2026.
    const lockRes = await request(app)
      .post("/api/compliance/audit-locks")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ period_from: "2026-03-01", period_to: "2026-03-31", reason: "FY close" });
    expect(lockRes.status).toBe(201);
  });

  function postVoucher(createdAt: string) {
    return request(app)
      .post("/api/accounts/vouchers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        debit_ledger_id: cashLedgerId,
        credit_ledger_id: salesLedgerId,
        amount_paise: 100000,
        reference_type: "MANUAL_TEST",
        description: "test posting",
        created_at: createdAt
      });
  }

  it("blocks a voucher back-dated into the locked period", async () => {
    const res = await postVoucher("2026-03-15");
    expect(res.status).toBe(400);
    expect(res.body.errors[0]).toContain("locked GST audit period");
  });

  it("allows a voucher dated outside the locked period", async () => {
    const res = await postVoucher("2026-07-15");
    expect(res.status).toBe(201);
  });
});
