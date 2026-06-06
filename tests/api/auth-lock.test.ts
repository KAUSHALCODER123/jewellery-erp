import request from "supertest";
import { app } from "../../src/server.js";

describe("App lock — password re-verification", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  it("unlocks with the correct password", async () => {
    const res = await request(app)
      .post("/api/auth/verify-password")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ password: "admin_pass" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects a wrong password (401) and a missing password (400)", async () => {
    const wrong = await request(app)
      .post("/api/auth/verify-password")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ password: "nope" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.ok).toBe(false);

    const missing = await request(app)
      .post("/api/auth/verify-password")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(missing.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/auth/verify-password").send({ password: "admin_pass" });
    expect(res.status).toBe(401);
  });
});
