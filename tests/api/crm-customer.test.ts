import request from "supertest";
import { app } from "../../src/server.js";

describe("CRM customer creation", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  function createCustomer(body: Record<string, unknown>) {
    return request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(body);
  }

  it("creates a customer and seeds opening-balance udhari ledger", async () => {
    const res = await createCustomer({
      name: "Asha Patel",
      phone: "9811122233",
      email: "asha@example.com",
      gstin: "27ABCDE1234F1Z5",
      opening_balance: "5000",
      opening_balance_type: "DEBIT"
    });

    expect(res.status).toBe(201);
    expect(res.body.customer.name).toBe("Asha Patel");
    const customerId = res.body.customer.id;

    // Opening balance reflected in the 360 udhari balance (₹5,000 = 500000 paise).
    const view = await request(app)
      .get(`/api/crm/customers/${customerId}/360`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(view.status).toBe(200);
    expect(view.body.udhari_balance_paise).toBe(500000);
  });

  it("rejects a duplicate phone with 409", async () => {
    const first = await createCustomer({ name: "Ravi", phone: "9700000001" });
    expect(first.status).toBe(201);
    const dup = await createCustomer({ name: "Ravi 2", phone: "9700000001" });
    expect(dup.status).toBe(409);
  });

  it("rejects missing/invalid phone with 400", async () => {
    const res = await createCustomer({ name: "No Phone", phone: "abc" });
    expect(res.status).toBe(400);
  });

  it("updates a customer via PUT", async () => {
    const created = await createCustomer({ name: "Edit Me", phone: "9700000002" });
    const id = created.body.customer.id;

    const res = await request(app)
      .put(`/api/crm/customers/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Edited Name", phone: "9700000002", area: "Andheri" });

    expect(res.status).toBe(200);
    expect(res.body.customer.name).toBe("Edited Name");
    expect(res.body.customer.area).toBe("Andheri");
  });
});
