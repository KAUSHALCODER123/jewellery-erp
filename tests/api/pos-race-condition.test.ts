import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items } from "../../src/db/schema.js";

describe("POS checkout race condition", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // Reset ITEM-002 to a clean sellable state
    db.update(items).set({
      status: "IN_STOCK",
      huid: "HUID02",
      huid_status: "HUID_RECEIVED",
      is_urd_recycled_gold: false
    }).where(eq(items.id, 2)).run();
  });

  it("handles simultaneous checkout of the same item (one 201, one 409, zero 500)", async () => {
    const payload = {
      cartItems: [
        {
          itemId: 2,
          barcode: "ITEM-002",
          metalType: "Gold",
          purityKarat: 22,
          grossWeightMg: 20000,
          netWeightMg: 20000,
          stoneWeightMg: 0,
          metalRatePaisePerGram: 600000,
          makingChargePaise: 0,
          wastageChargePaise: 0,
          gstPaise: 36000,
          itemTotalPaise: 1236000
        }
      ],
      urdItems: [],
      totals: {
        grossTotalPaise: 1236000,
        discountPaise: 0,
        urdDeductionPaise: 0,
        netPayablePaise: 1236000,
        gstPaise: 36000
      },
      payments: {
        cash: 1236000,
        upi: 0,
        card: 0,
        udhari: 0,
        gssCredit: 0
      },
      paymentReferences: {
        cash: null,
        upi: null,
        card: null,
        cheque: null,
        dd: null,
        neft: null,
        bankName: null
      },
      invoice: {
        billPrefix: null,
        manualNumber: null,
        dueDate: null,
        salesmanName: "Test",
        gstNotRequired: false,
        placeOfSupplyStateCode: null,
        gstSupplyType: null
      },
      kyc: {
        panNumber: null,
        aadhaarNumber: null,
        documentImagePath: null
      }
    };

    // Fire two checkout requests simultaneously
    const [resA, resB] = await Promise.all([
      request(app)
        .post("/api/pos/checkout")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(payload),
      request(app)
        .post("/api/pos/checkout")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(payload)
    ]);

    const statuses = [resA.status, resB.status];
    const bodies = [resA.body, resB.body];

    // Exactly one must succeed (201) and the other must be 409 with ITEM_ALREADY_SOLD
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(1);
    expect(statuses.filter((s) => s >= 500).length).toBe(0);

    // The 409 response must have the ITEM_ALREADY_SOLD error format
    const conflictIdx = statuses.indexOf(409);
    expect(bodies[conflictIdx]).toHaveProperty("error", "ITEM_ALREADY_SOLD");
    expect(bodies[conflictIdx]).toHaveProperty("message");

    // The item must be SOLD exactly once
    const item = db.select().from(items).where(eq(items.id, 2)).get();
    expect(item?.status).toBe("SOLD");
  });
});
