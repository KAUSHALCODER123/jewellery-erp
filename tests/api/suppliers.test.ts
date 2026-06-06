import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { suppliers } from "../../src/db/schema.js";

describe("Supplier master", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    db.delete(suppliers).run();
  });

  it("creates a supplier and lists it", async () => {
    const create = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Mumbai Bullion Syndicate", phone: "9876500000", gstin: "27ABCDE1234F1Z5" });

    expect(create.status).toBe(201);
    expect(create.body.supplier.name).toBe("Mumbai Bullion Syndicate");
    expect(create.body.supplier.gstin).toBe("27ABCDE1234F1Z5");

    const list = await request(app)
      .get("/api/suppliers")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(list.status).toBe(200);
    expect(list.body.suppliers).toHaveLength(1);
    expect(list.body.suppliers[0].name).toBe("Mumbai Bullion Syndicate");
  });

  it("rejects a nameless supplier (400) and a duplicate name (409)", async () => {
    const nameless = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ phone: "900" });
    expect(nameless.status).toBe(400);

    await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Dup Supplier" });
    const duplicate = await request(app)
      .post("/api/suppliers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Dup Supplier" });
    expect(duplicate.status).toBe(409);
  });
});
