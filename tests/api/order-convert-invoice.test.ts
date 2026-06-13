import request from "supertest";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, customerOrders, items, ledgers } from "../../src/db/schema.js";

// Convert a booked customer order (with an advance already collected) into a sale.
// The advance is journaled as a customer credit at booking and consumed as a tender
// at checkout, so GST/revenue stay on the full bill and the customer pays the balance.
describe("Convert customer order to invoice (advance applied)", () => {
  let adminToken: string;
  let customerId: number;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // ITEM-003 is gold/22k; reset to a clean, hallmarked, sellable state.
    db.update(items).set({
      status: "IN_STOCK",
      huid: "HUID03",
      huid_status: "HUID_RECEIVED",
      is_urd_recycled_gold: false
    }).where(eq(items.id, 3)).run();

    customerId = db.insert(customers).values({ name: "Advance Customer", phone: "9333344445" }).returning().get().id;
  });

  function udhariBalance(): number {
    const row = db.select().from(ledgers)
      .where(and(eq(ledgers.account_type, "CUSTOMER_UDHARI"), eq(ledgers.entity_id, customerId)))
      .get();
    return row?.balance_paise ?? 0;
  }

  async function bookOrderWithAdvance(advancePaise: number) {
    const res = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        item_description: "Custom necklace",
        target_weight_grams: "15.000",
        target_purity: 9167,
        advance_paise: advancePaise
      });
    expect(res.status).toBe(201);
    return res.body.order;
  }

  function checkoutPayload(orderId: number, itemTotalPaise: number, advancePaise: number) {
    return {
      customer_id: customerId,
      customer_order_id: orderId,
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
      totals: { grossTotalPaise: itemTotalPaise, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: itemTotalPaise, gstPaise: 0 },
      payments: { cash: itemTotalPaise - advancePaise, upi: 0, card: 0, cheque: 0, neft: 0, udhari: 0, gssCredit: 0, advance: advancePaise },
      paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
      invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
      kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
    };
  }

  it("books the advance as a customer credit and consumes it on conversion", async () => {
    const order = await bookOrderWithAdvance(50000); // Rs 500 advance

    // Advance recorded the customer into credit (normal-debit ledger goes negative).
    expect(udhariBalance()).toBe(-50000);

    const itemTotalPaise = 3000000; // Rs 30,000 bill
    const res = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(checkoutPayload(order.id, itemTotalPaise, 50000));

    expect(res.status).toBe(201);

    // The bill (and therefore GST) is the full value; advance is a tender, not a discount.
    expect(res.body.invoice.total_amount_paise).toBe(itemTotalPaise);
    expect(res.body.voucher.total_debit_paise).toBe(itemTotalPaise);
    expect(res.body.voucher.total_credit_paise).toBe(itemTotalPaise);

    // Advance credit fully consumed → customer back to a zero balance.
    expect(udhariBalance()).toBe(0);

    // Order closed out, item sold.
    const closedOrder = db.select().from(customerOrders).where(eq(customerOrders.id, order.id)).get();
    expect(closedOrder?.status).toBe("COMPLETED");
    const soldItem = db.select().from(items).where(eq(items.id, 3)).get();
    expect(soldItem?.status).toBe("SOLD");
  });

  it("rejects applying more advance than was collected on the order", async () => {
    const order = await bookOrderWithAdvance(50000);
    const res = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(checkoutPayload(order.id, 3000000, 60000)); // claims Rs 600 advance vs Rs 500 booked

    expect(res.status).toBe(422);
    expect(res.body.errors.join(" ")).toMatch(/advance exceeds/i);
  });

  it("rejects an advance tender with no customer_order_id", async () => {
    const payload = checkoutPayload(0, 3000000, 50000);
    delete (payload as { customer_order_id?: number }).customer_order_id;

    const res = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.errors.join(" ")).toMatch(/customer_order_id is required/i);
  });
});
