import request from "supertest";
import { app } from "../../src/server.js";

// P5 — self-serve GSS scheme builder (create/update templates, incl. 11+1 model).
describe("GSS scheme template builder", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  function createTemplate(body: Record<string, unknown>) {
    return request(app)
      .post("/api/gss/templates")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(body);
  }

  const base = {
    scheme_code: "GSS-NEW-11",
    scheme_name: "Pay 11 Get 12",
    scheme_type: "CASH",
    duration_months: 12,
    monthly_amount_paise: 100000,
    bonus_rule_type: "FIXED_AMOUNT",
    bonus_value_paise: 100000,
    customer_months: 11,
    maturity_months: 1
  };

  it("creates an 11+1 scheme and lists it", async () => {
    const res = await createTemplate(base);
    expect(res.status).toBe(201);
    expect(res.body.template.scheme_code).toBe("GSS-NEW-11");
    expect(res.body.template.customer_months).toBe(11);
    expect(res.body.template.maturity_months).toBe(1);

    const list = await request(app)
      .get("/api/gss/templates")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.templates.some((t: { scheme_code: string }) => t.scheme_code === "GSS-NEW-11")).toBe(true);
  });

  it("rejects a duplicate scheme_code with 409", async () => {
    expect((await createTemplate(base)).status).toBe(201);
    const dup = await createTemplate({ ...base, scheme_name: "Dup" });
    expect(dup.status).toBe(409);
  });

  it("rejects an invalid payload with 400", async () => {
    const res = await createTemplate({ scheme_name: "No code", duration_months: 0 });
    expect(res.status).toBe(400);
  });

  it("updates a scheme via PUT", async () => {
    const created = await createTemplate(base);
    const id = created.body.template.id;
    const res = await request(app)
      .put(`/api/gss/templates/${id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...base, monthly_amount_paise: 200000 });
    expect(res.status).toBe(200);
    expect(res.body.template.monthly_amount_paise).toBe(200000);
  });

  it("generates an 11-installment schedule for an enrolled 11+1 account", async () => {
    const template = await createTemplate(base);
    const templateId = template.body.template.id;

    const cust = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Scheme Member", phone: "9445566778" });
    const customerId = cust.body.customer.id;

    const enroll = await request(app)
      .post("/api/gss/enroll")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ customer_id: customerId, template_id: templateId, card_number: "GSSSCHED01", enrollment_date: "2024-01-01" });
    expect(enroll.status).toBe(201);
    const accountId = enroll.body.account.id;

    const sched = await request(app)
      .get(`/api/gss/accounts/${accountId}/schedule`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(sched.status).toBe(200);
    expect(sched.body.total_installments).toBe(11); // customer_months
    expect(sched.body.schedule).toHaveLength(11);
    expect(sched.body.schedule[0].due_date).toBe("2024-01-01");
    expect(sched.body.schedule[1].due_date).toBe("2024-02-01");
    expect(sched.body.schedule[0].amount_paise).toBe(100000);
  });
});
