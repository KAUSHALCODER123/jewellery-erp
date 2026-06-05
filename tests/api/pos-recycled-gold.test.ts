import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items, invoices, urdPurchases } from "../../src/db/schema.js";

describe("POS URD recycled gold", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // Ensure ITEM-001 is in a sellable state for any checkout that uses it
    db.update(items).set({ status: "IN_STOCK" }).where(eq(items.id, 1)).run();

    // Seed a minimal invoice + URD purchase for the ingest step
    const existing = db.select().from(invoices).where(eq(invoices.id, 9999)).get();
    if (!existing) {
      db.insert(invoices)
        .values({
          id: 9999,
          invoice_number: "URD-TEST-INV-9999",
          total_amount_paise: 0,
          payment_mode: "CASH"
        })
        .run();
    }

    const urdExisting = db.select().from(urdPurchases).where(eq(urdPurchases.id, 9999)).get();
    if (!urdExisting) {
      db.insert(urdPurchases)
        .values({
          id: 9999,
          invoice_id: 9999,
          description: "Test 10g old gold purchase",
          metal_type: "Gold",
          purity_tunch: "91.67",
          weight_mg: 10000,
          applied_rate_paise_per_gram: 600000,
          deduction_amount_paise: 6000000
        })
        .run();
    }
  });

  it("allows POS checkout without HUID for URD recycled gold items", async () => {
    // 1. Ingest the pre-seeded URD purchase into stock
    const ingestRes = await request(app)
      .post("/api/pos/urd-purchases/9999/ingest-stock")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        barcode: "URD-RECYCLED-10G",
        location: "OLD_GOLD_VAULT"
      });

    expect(ingestRes.status).toBe(201);
    const recycledItem = ingestRes.body.item;
    expect(recycledItem.is_urd_recycled_gold).toBe(true);
    expect(recycledItem.huid).toBeNull();
    expect(recycledItem.huid_status).toBe("NOT_APPLIED");
    expect(recycledItem.status).toBe("IN_STOCK");

    // 2. Checkout: sell the recycled gold item (should bypass HUID check)
    const itemTotalPaise = 6000000;
    const gstPaise = 180000;
    const grossTotalPaise = itemTotalPaise;

    const checkoutRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        cartItems: [
          {
            itemId: recycledItem.id,
            barcode: recycledItem.barcode,
            metalType: "Gold",
            purityKarat: recycledItem.purity_karat,
            grossWeightMg: recycledItem.gross_weight_mg,
            netWeightMg: recycledItem.net_weight_mg,
            stoneWeightMg: 0,
            metalRatePaisePerGram: 600000,
            makingChargePaise: 0,
            wastageChargePaise: 0,
            gstPaise,
            itemTotalPaise
          }
        ],
        urdItems: [],
        totals: {
          grossTotalPaise,
          discountPaise: 0,
          urdDeductionPaise: 0,
          netPayablePaise: grossTotalPaise,
          gstPaise
        },
        payments: {
          cash: grossTotalPaise,
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
      });

    // Must succeed — recycled gold is exempt from HUID validation
    expect(checkoutRes.status).toBe(201);

    // 3. Verify the item is now sold
    const soldItem = db.select().from(items).where(eq(items.id, recycledItem.id)).get();
    expect(soldItem?.status).toBe("SOLD");
  });

  it("still blocks regular hallmarked gold without HUID at checkout", async () => {
    // Reset ITEM-005 (gold, no HUID) to IN_STOCK
    db.update(items).set({
      status: "IN_STOCK",
      huid: null,
      huid_status: "NOT_APPLIED",
      is_urd_recycled_gold: false
    }).where(eq(items.id, 5)).run();

    const checkoutRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        cartItems: [
          {
            itemId: 5,
            barcode: "ITEM-005",
            metalType: "Gold",
            purityKarat: 22,
            grossWeightMg: 12000,
            netWeightMg: 12000,
            stoneWeightMg: 0,
            metalRatePaisePerGram: 600000,
            makingChargePaise: 0,
            wastageChargePaise: 0,
            gstPaise: 0,
            itemTotalPaise: 7200000
          }
        ],
        urdItems: [],
        totals: {
          grossTotalPaise: 7200000,
          discountPaise: 0,
          urdDeductionPaise: 0,
          netPayablePaise: 7200000,
          gstPaise: 0
        },
        payments: {
          cash: 7200000,
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
      });

    expect(checkoutRes.status).toBe(409);
    expect(checkoutRes.body.errors?.[0]).toContain("HUID");
  });
});
