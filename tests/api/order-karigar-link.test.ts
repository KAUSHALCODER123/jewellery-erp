import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, customerOrders } from "../../src/db/schema.js";

describe("Customer order ↔ karigar job auto-linking", () => {
  let adminToken: string;
  let customerId: number;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    const customer = db
      .insert(customers)
      .values({ name: "Order Link Customer", phone: "9111122223" })
      .returning()
      .get();
    customerId = customer.id;
  });

  async function bookOrder(orderNumber: string) {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        order_number: orderNumber,
        customer_id: customerId,
        item_description: "Custom bangle",
        target_weight_grams: "12.000",
        target_purity: 9167,
        advance_paise: 50000
      });
    expect(res.status).toBe(201);
    return res.body.order;
  }

  function createJob(orderNumber: string) {
    return request(app)
      .post("/api/karigar/jobs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        order_number: orderNumber,
        karigar_id: 1,
        target_purity: "91.67",
        target_weight_mg: 12000
      });
  }

  it("links a booked order to its workshop job and moves it into production", async () => {
    const order = await bookOrder("ORD-LINK-1");
    expect(order.status).toBe("OPEN");
    expect(order.karigar_job_id).toBeNull();

    // Job number is entered lower-case to prove the match is case-insensitive.
    const jobRes = await createJob("ord-link-1");
    expect(jobRes.status).toBe(201);
    expect(jobRes.body.linked_customer_order).toMatchObject({
      id: order.id,
      order_number: "ORD-LINK-1",
      status: "IN_PROGRESS"
    });

    const linked = db.select().from(customerOrders).where(eq(customerOrders.id, order.id)).get();
    expect(linked?.karigar_job_id).toBe(jobRes.body.job.id);
    expect(linked?.status).toBe("IN_PROGRESS");
  });

  it("creates a job with no matching order without linking anything", async () => {
    const jobRes = await createJob("JO-NO-MATCH-9");
    expect(jobRes.status).toBe(201);
    expect(jobRes.body.linked_customer_order).toBeNull();
  });

  it("does not downgrade an order that was already past OPEN", async () => {
    const order = await bookOrder("ORD-LINK-2");
    // Manager marks it in progress before the slip is cut.
    await request(app)
      .patch(`/api/orders/${order.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "IN_PROGRESS" });

    const jobRes = await createJob("ORD-LINK-2");
    expect(jobRes.status).toBe(201);
    expect(jobRes.body.linked_customer_order.status).toBe("IN_PROGRESS");

    const linked = db.select().from(customerOrders).where(eq(customerOrders.id, order.id)).get();
    expect(linked?.karigar_job_id).toBe(jobRes.body.job.id);
  });
});
