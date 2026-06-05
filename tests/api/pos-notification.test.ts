import request from "supertest";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items, messageLogs } from "../../src/db/schema.js";

// P3 — a customer invoice automatically queues a WhatsApp/SMS notification (logged).
describe("POS invoice auto-notification", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    db.update(items).set({ status: "IN_STOCK", huid: "NOTIF1", huid_status: "HUID_RECEIVED", is_urd_recycled_gold: false }).where(eq(items.id, 1)).run();
  });

  it("writes a POS_INVOICE_CREATED message log for a customer sale", async () => {
    const cust = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Notify Me", phone: "9123456780" });
    const customerId = cust.body.customer.id;

    const itemTotalPaise = 6000000;
    const checkout = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        cartItems: [
          { itemId: 1, barcode: "ITEM-001", metalType: "Gold", purityKarat: 22, grossWeightMg: 10000, netWeightMg: 10000, stoneWeightMg: 0, metalRatePaisePerGram: 600000, makingChargePaise: 0, wastageChargePaise: 0, gstPaise: 0, itemTotalPaise }
        ],
        urdItems: [],
        totals: { grossTotalPaise: itemTotalPaise, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: itemTotalPaise, gstPaise: 0 },
        payments: { cash: itemTotalPaise, upi: 0, card: 0, udhari: 0, gssCredit: 0 },
        paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
        invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
        kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
      });

    expect(checkout.status).toBe(201);

    const logs = db
      .select()
      .from(messageLogs)
      .where(and(eq(messageLogs.template_name, "POS_INVOICE_CREATED"), eq(messageLogs.customer_id, customerId)))
      .all();
    expect(logs.length).toBe(1);
    expect(logs[0].status).toBe("SENT");
    expect(logs[0].recipient).toBe("9123456780");
  });
});
