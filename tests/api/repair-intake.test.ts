import request from "supertest";
import { app } from "../../src/server.js";

// P7 — customer repair / custom-order intake lifecycle.
describe("Repair / custom-order intake", () => {
  let adminToken: string;
  let customerId: number;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    const cust = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Repair Customer", phone: "9778899001" });
    customerId = cust.body.customer.id;
  });

  it("creates, lists, and progresses a repair job to delivery", async () => {
    const create = await request(app)
      .post("/api/karigar/repairs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        description: "Resize gold ring + polish",
        estimated_charge_paise: 150000,
        karigar_id: 1,
        intake_date: "2026-06-01",
        delivery_date: "2026-06-05"
      });

    expect(create.status).toBe(201);
    expect(create.body.repair.status).toBe("RECEIVED");
    const repairId = create.body.repair.id;

    const list = await request(app)
      .get("/api/karigar/repairs?status=RECEIVED")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.repairs.some((r: { id: number }) => r.id === repairId)).toBe(true);

    const wip = await request(app)
      .patch(`/api/karigar/repairs/${repairId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "WIP" });
    expect(wip.status).toBe(200);
    expect(wip.body.repair.status).toBe("WIP");

    const delivered = await request(app)
      .patch(`/api/karigar/repairs/${repairId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "DELIVERED", actual_charge_paise: 175000 });
    expect(delivered.status).toBe(200);
    expect(delivered.body.repair.status).toBe("DELIVERED");
    expect(delivered.body.repair.actual_charge_paise).toBe(175000);
  });

  it("rejects an invalid status", async () => {
    const create = await request(app)
      .post("/api/karigar/repairs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ customer_id: customerId, description: "Chain repair" });
    const repairId = create.body.repair.id;

    const bad = await request(app)
      .patch(`/api/karigar/repairs/${repairId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "SHIPPED" });
    expect(bad.status).toBe(400);
  });

  it("rejects a repair for a missing customer", async () => {
    const res = await request(app)
      .post("/api/karigar/repairs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ customer_id: 999999, description: "Ghost repair" });
    expect(res.status).toBe(404);
  });
});
