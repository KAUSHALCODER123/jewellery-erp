import request from "supertest";
import { app } from "../../src/server.js";

describe("JWT revocation on logout", () => {
  test("token is rejected with TOKEN_REVOKED after logout", async () => {
    // 1. Log in as the seeded counter staff user.
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_staff", password: "staff_pass" });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body).toHaveProperty("token");
    const token = loginRes.body.token as string;

    // 2. Token works against a protected endpoint.
    const before = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${token}`);

    expect(before.status).toBe(200);

    // 3. Log out — should blacklist the token's jti.
    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body).toEqual({ message: "Logged out" });

    // 4. Same token is now revoked.
    const after = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${token}`);

    expect(after.status).toBe(401);
    expect(after.body.error).toBe("TOKEN_REVOKED");
  });

  test("deactivated user's still-valid token is rejected", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_staff", password: "staff_pass" });

    expect(loginRes.status).toBe(200);
    const token = loginRes.body.token as string;

    // Admin deactivates the user directly in the DB (no token reissue).
    const { db } = await import("../../src/db/client.js");
    const { users } = await import("../../src/db/schema.js");
    const { eq } = await import("drizzle-orm");
    db.update(users).set({ is_active: false }).where(eq(users.username, "test_staff")).run();

    const after = await request(app)
      .get("/api/inventory")
      .set("Authorization", `Bearer ${token}`);

    expect(after.status).toBe(401);
    expect(after.body.error).toBe("TOKEN_REVOKED");
  });
});
