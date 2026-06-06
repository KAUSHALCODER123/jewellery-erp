import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items, customers, loyaltyLedger, organizationSettings } from "../../src/db/schema.js";

// P4 — loyalty points earned on a customer sale (1 point per ₹100 by default).
describe("POS loyalty points earning", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    db.update(items).set({ status: "IN_STOCK", huid: "LOYAL1", huid_status: "HUID_RECEIVED", is_urd_recycled_gold: false }).where(eq(items.id, 1)).run();
  });

  it("credits 1 point per ₹100 of net payable to the customer", async () => {
    const cust = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Loyal Customer", phone: "9112233445", loyalty_enrolled: true });
    const customerId = cust.body.customer.id;

    const itemTotalPaise = 6000000; // ₹60,000 → 600 points
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
    expect(checkout.body.loyalty_points_earned).toBe(600);

    const row = db.select().from(customers).where(eq(customers.id, customerId)).get();
    expect(row?.loyalty_points_balance).toBe(600);

    const ledgerRows = db.select().from(loyaltyLedger).where(eq(loyaltyLedger.customer_id, customerId)).all();
    expect(ledgerRows).toHaveLength(1);
    expect(ledgerRows[0].transaction_type).toBe("EARN");
    expect(ledgerRows[0].points).toBe(600);
    expect(ledgerRows[0].balance_after).toBe(600);
  });

  it("does not earn points when the customer is not enrolled", async () => {
    const cust = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Plain Customer", phone: "9112233446" });
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
    expect(checkout.body.loyalty_points_earned).toBe(0);
    expect(db.select().from(loyaltyLedger).where(eq(loyaltyLedger.customer_id, customerId)).all()).toHaveLength(0);
  });

  it("credits points per gram of gold when configured", async () => {
    db.update(organizationSettings)
      .set({ loyalty_earn_mode: "PER_GRAM_GOLD", loyalty_points_per_gram_gold: 2 })
      .where(eq(organizationSettings.id, 1))
      .run();

    const cust = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Gold Gram Customer", phone: "9112233447", loyalty_enrolled: true });
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
    expect(checkout.body.loyalty_points_earned).toBe(20);
  });

  it("earns nothing for a walk-in (no customer)", async () => {
    db.update(items).set({ status: "IN_STOCK" }).where(eq(items.id, 1)).run();
    const itemTotalPaise = 6000000;
    const checkout = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: null,
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
    expect(checkout.body.loyalty_points_earned).toBe(0);
  });
});
