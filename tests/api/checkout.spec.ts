import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items } from "../../src/db/schema.js";

// TEST 2 — Concurrent checkout race condition.
// Two simultaneous checkouts for the same item must resolve to exactly one
// success (201) and one conflict (409 ITEM_ALREADY_SOLD); the item must end up
// SOLD exactly once. The guard is an atomic conditional UPDATE in the checkout
// transaction (WHERE status = 'IN_STOCK'); see src/pos/routes.ts.
describe("POS concurrent checkout race", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // Seeded ITEM-003 is gold/22k with a valid HUID; reset to a clean sellable state.
    db.update(items).set({
      status: "IN_STOCK",
      huid: "HUID03",
      huid_status: "HUID_RECEIVED",
      is_urd_recycled_gold: false
    }).where(eq(items.id, 3)).run();
  });

  it("fires two simultaneous checkouts for one item → exactly one 201 and one 409 ITEM_ALREADY_SOLD", async () => {
    const itemTotalPaise = 3000000;
    const payload = {
      cartItems: [
        {
          itemId: 3,
          barcode: "ITEM-003",
          metalType: "Gold",
          purityKarat: 22,
          grossWeightMg: 5000,
          netWeightMg: 5000,
          stoneWeightMg: 0,
          metalRatePaisePerGram: 600000,
          makingChargePaise: 0,
          wastageChargePaise: 0,
          gstPaise: 0,
          itemTotalPaise
        }
      ],
      urdItems: [],
      totals: {
        grossTotalPaise: itemTotalPaise,
        discountPaise: 0,
        urdDeductionPaise: 0,
        netPayablePaise: itemTotalPaise,
        gstPaise: 0
      },
      payments: { cash: itemTotalPaise, upi: 0, card: 0, udhari: 0, gssCredit: 0 },
      paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
      invoice: {
        billPrefix: null,
        manualNumber: null,
        dueDate: null,
        salesmanName: "Test",
        gstNotRequired: false,
        placeOfSupplyStateCode: null,
        gstSupplyType: null
      },
      kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
    };

    const [resA, resB] = await Promise.all([
      request(app).post("/api/pos/checkout").set("Authorization", `Bearer ${adminToken}`).send(payload),
      request(app).post("/api/pos/checkout").set("Authorization", `Bearer ${adminToken}`).send(payload)
    ]);

    const statuses = [resA.status, resB.status];
    const bodies = [resA.body, resB.body];

    // Exactly one success, exactly one conflict, no server errors.
    expect(statuses.filter((s) => s === 201).length).toBe(1);
    expect(statuses.filter((s) => s === 409).length).toBe(1);
    expect(statuses.filter((s) => s >= 500).length).toBe(0);

    const conflictIdx = statuses.indexOf(409);
    expect(bodies[conflictIdx]).toHaveProperty("error", "ITEM_ALREADY_SOLD");

    // Item is SOLD exactly once (single row, single terminal state).
    const item = db.select().from(items).where(eq(items.id, 3)).get();
    expect(item?.status).toBe("SOLD");
  });
});
