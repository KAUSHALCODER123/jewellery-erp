import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, ledgers } from "../../src/db/schema.js";

// Test 13 Phase 1: a customer's udhari is presented once, netting dues against any
// advance, even when split across multiple CUSTOMER_UDHARI ledgers (legacy data).
describe("udhari list aggregates and nets per customer", () => {
  let adminToken: string;
  let customerId: number;

  beforeEach(async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(login.status).toBe(200);
    adminToken = login.body.token;

    const customer = db.insert(customers).values({ name: "Split Udhari Customer", phone: "9000000456" }).returning().get();
    customerId = customer.id;
  });

  it("collapses two udhari ledgers for one customer into a single netted row", async () => {
    // Two CUSTOMER_UDHARI ledgers for the same customer: a Rs 150 due and a Rs 50 advance.
    db.insert(ledgers).values({ account_name: "Customer Udhari 999", account_type: "CUSTOMER_UDHARI", entity_id: customerId, balance_paise: 15000 }).run();
    db.insert(ledgers).values({ account_name: `Customer Udhari ${"Split Udhari Customer"}`, account_type: "CUSTOMER_UDHARI", entity_id: customerId, balance_paise: -5000 }).run();

    const res = await request(app)
      .get("/api/accounts/udhari")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const mine = res.body.udhari.filter((r: { customer_id: number | null }) => r.customer_id === customerId);
    expect(mine).toHaveLength(1);
    // Net: 15000 due - 5000 advance = 10000.
    expect(mine[0].balance_paise).toBe(10000);
  });

  it("omits a customer whose advance fully offsets their dues", async () => {
    db.insert(ledgers).values({ account_name: "Customer Udhari A", account_type: "CUSTOMER_UDHARI", entity_id: customerId, balance_paise: 8000 }).run();
    db.insert(ledgers).values({ account_name: "Customer Udhari B", account_type: "CUSTOMER_UDHARI", entity_id: customerId, balance_paise: -8000 }).run();

    const res = await request(app)
      .get("/api/accounts/udhari")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const mine = res.body.udhari.filter((r: { customer_id: number | null }) => r.customer_id === customerId);
    expect(mine).toHaveLength(0);
  });
});
