import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items, huidLifecycleEvents } from "../../src/db/schema.js";

// Quick Bill (POS) creates an inventory item on the fly. For gold, BIS hallmarking
// means the piece can only be sold if it carries a valid HUID and a hallmarked
// status. The `mark_hallmarked` flag on /api/inventory/barcode/create lets the
// cashier attest the physical HUID so the item passes the checkout guard.
describe("POS Quick Bill hallmark attestation", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  function checkoutPayload(item: { id: number; barcode: string; purity_karat: number; gross_weight_mg: number; net_weight_mg: number }) {
    const itemTotalPaise = 5000000;
    return {
      cartItems: [
        {
          itemId: item.id,
          barcode: item.barcode,
          metalType: "Gold",
          purityKarat: item.purity_karat,
          grossWeightMg: item.gross_weight_mg,
          netWeightMg: item.net_weight_mg,
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
      invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
      kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
    };
  }

  it("marks a gold item hallmarked when mark_hallmarked + HUID are supplied, and allows checkout", async () => {
    const createRes = await request(app)
      .post("/api/inventory/barcode/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        quantity: 1,
        sale_mode: "WEIGHT_WISE",
        category: "Ring",
        metal_type: "Gold",
        purity_karat: 22,
        gross_weight_mg: 8000,
        stone_weight_mg: 0,
        making_charge_type: "FLAT",
        making_charge_value: 150000,
        huid: "QB1234",
        mark_hallmarked: true
      });

    expect(createRes.status).toBe(201);
    const created = createRes.body.items[0];

    const stored = db.select().from(items).where(eq(items.id, created.id)).get();
    expect(stored?.huid).toBe("QB1234");
    expect(stored?.huid_status).toBe("HUID_RECEIVED");

    // The attestation is recorded in the HUID lifecycle log.
    const events = db.select().from(huidLifecycleEvents).where(eq(huidLifecycleEvents.item_id, created.id)).all();
    expect(events).toHaveLength(1);
    expect(events[0].to_status).toBe("HUID_RECEIVED");
    expect(events[0].event_type).toBe("HUID_ATTESTED");

    const checkoutRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(checkoutPayload(stored!));

    expect(checkoutRes.status).toBe(201);
    expect(db.select().from(items).where(eq(items.id, created.id)).get()?.status).toBe("SOLD");
  });

  it("leaves a gold item NOT_APPLIED without the flag, and checkout is still blocked", async () => {
    const createRes = await request(app)
      .post("/api/inventory/barcode/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        quantity: 1,
        sale_mode: "WEIGHT_WISE",
        category: "Ring",
        metal_type: "Gold",
        purity_karat: 22,
        gross_weight_mg: 8000,
        stone_weight_mg: 0,
        making_charge_type: "FLAT",
        making_charge_value: 150000
      });

    expect(createRes.status).toBe(201);
    const created = createRes.body.items[0];

    const stored = db.select().from(items).where(eq(items.id, created.id)).get();
    expect(stored?.huid_status).toBe("NOT_APPLIED");

    const checkoutRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(checkoutPayload(stored!));

    expect(checkoutRes.status).toBe(409);
    expect(checkoutRes.body.errors?.[0]).toContain("HUID");
  });

  it("rejects mark_hallmarked without a valid HUID", async () => {
    const createRes = await request(app)
      .post("/api/inventory/barcode/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        quantity: 1,
        sale_mode: "WEIGHT_WISE",
        category: "Ring",
        metal_type: "Gold",
        purity_karat: 22,
        gross_weight_mg: 8000,
        making_charge_type: "FLAT",
        making_charge_value: 150000,
        mark_hallmarked: true
      });

    expect(createRes.status).toBe(400);
    expect(createRes.body.errors.join(" ")).toContain("HUID");
  });
});
