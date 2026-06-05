import request from "supertest";
import { app } from "../../src/server.js";

describe("API Privilege Escalation Checks (RBAC)", () => {
  let staffToken: string;

  beforeEach(async () => {
    // Log in as Counter Staff using the seeded credentials
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        username: "test_staff",
        password: "staff_pass",
      });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toHaveProperty("token");
    staffToken = loginRes.body.token;
  });

  test("GET /api/reports/mis/true-margin should return 403 Forbidden for COUNTER_STAFF", async () => {
    const response = await request(app)
      .get("/api/reports/mis/true-margin")
      .set("Authorization", `Bearer ${staffToken}`);

    // Assert access is denied
    expect(response.status).toBe(403);
    // Verify no financial data leaks in the body
    expect(response.body.margin_by_category).toBeUndefined();
    expect(response.body.errors).toContain("Insufficient role access.");
  });

  test("POST /api/settings/rates/sync should return 403 Forbidden for COUNTER_STAFF", async () => {
    const response = await request(app)
      .post("/api/settings/rates/sync")
      .set("Authorization", `Bearer ${staffToken}`)
      .send({});

    // Assert access is denied
    expect(response.status).toBe(403);
    expect(response.body.rates).toBeUndefined();
    expect(response.body.errors).toContain("Insufficient role access.");
  });
});
