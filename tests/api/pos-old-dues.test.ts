import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items } from "../../src/db/schema.js";

// P2 — collecting against a customer's old dues (udhari) inside the sale bill.
describe("POS old-dues collection", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    db.update(items).set({ status: "IN_STOCK", huid: "OLDDUE", huid_status: "HUID_RECEIVED", is_urd_recycled_gold: false }).where(eq(items.id, 1)).run();
  });

  it("reduces the customer's udhari balance by the amount collected in the bill", async () => {
    // Customer with ₹10,000 opening udhari.
    const cust = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Dues Payer", phone: "9665544332", opening_balance: "10000", opening_balance_type: "DEBIT" });
    expect(cust.status).toBe(201);
    const customerId = cust.body.customer.id;

    const itemTotalPaise = 6000000;
    const checkout = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        cartItems: [
          {
            itemId: 1,
            barcode: "ITEM-001",
            metalType: "Gold",
            purityKarat: 22,
            grossWeightMg: 10000,
            netWeightMg: 10000,
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
        payments: { cash: itemTotalPaise, upi: 0, card: 0, udhari: 0, gssCredit: 0 },
        paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
        invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
        kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null },
        old_dues_payment_paise: 500000,
        old_dues_payment_mode: "CASH"
      });

    expect(checkout.status).toBe(201);
    expect(checkout.body.old_dues_collected_paise).toBe(500000);

    // Udhari dropped from ₹10,000 to ₹5,000.
    const view = await request(app)
      .get(`/api/crm/customers/${customerId}/360`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(view.status).toBe(200);
    expect(view.body.udhari_balance_paise).toBe(500000);
  });

  it("rejects old-dues collection without a customer", async () => {
    db.update(items).set({ status: "IN_STOCK" }).where(eq(items.id, 1)).run();
    const itemTotalPaise = 6000000;
    const res = await request(app)
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
        kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null },
        old_dues_payment_paise: 100000
      });

    expect(res.status).toBe(400);
    expect(res.body.errors.join(" ")).toContain("old dues");
  });
});
