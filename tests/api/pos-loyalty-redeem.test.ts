import request from "supertest";
import { asc, eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items, customers, loyaltyLedger } from "../../src/db/schema.js";

// P4 (redeem) — loyalty points redeemed as a credit toward the bill (1 point = Rs 1).
describe("POS loyalty points redemption", () => {
  let adminToken: string;
  let customerId: number;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    db.update(items).set({ status: "IN_STOCK", huid: "REDEEM", huid_status: "HUID_RECEIVED", is_urd_recycled_gold: false }).where(eq(items.id, 1)).run();

    const cust = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Points Holder", phone: "9009009001", loyalty_enrolled: true });
    customerId = cust.body.customer.id;
  });

  function checkout(extra: Record<string, unknown>, netPayablePaise: number) {
    const itemTotalPaise = 6000000;
    return request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        cartItems: [
          { itemId: 1, barcode: "ITEM-001", metalType: "Gold", purityKarat: 22, grossWeightMg: 10000, netWeightMg: 10000, stoneWeightMg: 0, metalRatePaisePerGram: 600000, makingChargePaise: 0, wastageChargePaise: 0, gstPaise: 0, itemTotalPaise }
        ],
        urdItems: [],
        totals: { grossTotalPaise: itemTotalPaise, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise, gstPaise: 0 },
        payments: { cash: netPayablePaise, upi: 0, card: 0, udhari: 0, gssCredit: 0 },
        paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
        invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
        kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null },
        ...extra
      });
  }

  it("redeems points, reduces net payable, and updates the balance (earn − redeem)", async () => {
    db.update(customers).set({ loyalty_points_balance: 1000 }).where(eq(customers.id, customerId)).run();

    // Redeem 500 points = Rs 500 = 50,000 paise → net payable 6,000,000 − 50,000 = 5,950,000.
    const res = await checkout({ loyalty_points_redeemed: 500 }, 5950000);
    expect(res.status).toBe(201);
    expect(res.body.loyalty_points_redeemed).toBe(500);
    // Earn on net payable 5,950,000 → 595 points.
    expect(res.body.loyalty_points_earned).toBe(595);

    // Balance: 1000 − 500 + 595 = 1095.
    const row = db.select().from(customers).where(eq(customers.id, customerId)).get();
    expect(row?.loyalty_points_balance).toBe(1095);

    const ledgerRows = db.select().from(loyaltyLedger).where(eq(loyaltyLedger.customer_id, customerId)).orderBy(asc(loyaltyLedger.id)).all();
    expect(ledgerRows.map((row) => row.transaction_type)).toEqual(["REDEEM", "EARN"]);
    expect(ledgerRows.map((row) => row.points)).toEqual([-500, 595]);
    expect(ledgerRows.map((row) => row.balance_after)).toEqual([500, 1095]);
  });

  it("rejects redemption beyond the available balance with 409", async () => {
    db.update(customers).set({ loyalty_points_balance: 100 }).where(eq(customers.id, customerId)).run();
    const res = await checkout({ loyalty_points_redeemed: 500 }, 5950000);
    expect(res.status).toBe(409);
  });

  it("rejects redemption when the customer is not enrolled", async () => {
    db.update(customers)
      .set({ loyalty_enrolled: false, loyalty_points_balance: 1000 })
      .where(eq(customers.id, customerId))
      .run();

    const res = await checkout({ loyalty_points_redeemed: 500 }, 5950000);
    expect(res.status).toBe(409);
  });
});
