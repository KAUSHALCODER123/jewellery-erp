import request from "supertest";
import { and, eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { ledgers } from "../../src/db/schema.js";

describe("CRM: loyalty enrollment persistence + single udhari ledger per customer", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  it("persists loyalty_enrolled on create and exposes it via 360", async () => {
    const create = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Loyal Tester", phone: "9111100001", loyalty_enrolled: true });
    expect(create.status).toBe(201);
    expect(create.body.customer.loyalty_enrolled).toBe(true);

    const view = await request(app)
      .get(`/api/crm/customers/${create.body.customer.id}/360`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(view.status).toBe(200);
    expect(view.body.customer.loyalty_enrolled).toBe(true);
  });

  it("toggles loyalty_enrolled on edit (PUT) and persists it", async () => {
    const create = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Toggle Tester", phone: "9111100002", loyalty_enrolled: false });
    expect(create.status).toBe(201);
    expect(create.body.customer.loyalty_enrolled).toBe(false);

    const update = await request(app)
      .put(`/api/crm/customers/${create.body.customer.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Toggle Tester", phone: "9111100002", loyalty_enrolled: true });
    expect(update.status).toBe(200);
    expect(update.body.customer.loyalty_enrolled).toBe(true);
  });

  it("keeps a single CUSTOMER_UDHARI ledger when opening balance and a credit sale both post", async () => {
    // Customer with an opening udhari balance -> creates one CUSTOMER_UDHARI ledger.
    const create = await request(app)
      .post("/api/crm/customers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Udhari Tester", phone: "9111100003", opening_balance: "1000", opening_balance_type: "DEBIT" });
    expect(create.status).toBe(201);
    const customerId = create.body.customer.id;

    // A quantity-wise item we can sell partly on credit.
    const add = await request(app)
      .post("/api/inventory/add")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ barcode: "UDH-COIN-1", category: "Coins", metal_type: "Silver", sale_mode: "QUANTITY_WISE", uom: "PIECE", unit_price_paise: 100000 });
    expect(add.status).toBe(201);
    const coin = add.body.item;

    const checkout = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        cartItems: [
          { itemId: coin.id, barcode: coin.barcode, metalType: "Silver", metalRatePaisePerGram: 0, makingChargePaise: 0, gstPaise: 0, itemTotalPaise: 100000 }
        ],
        urdItems: [],
        totals: { grossTotalPaise: 100000, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: 100000, gstPaise: 0 },
        payments: { cash: 40000, upi: 0, card: 0, udhari: 60000, gssCredit: 0 },
        paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
        invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
        kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
      });
    expect(checkout.status).toBe(201);

    // There must be exactly ONE udhari ledger for this customer, not two.
    const udhariLedgers = db
      .select()
      .from(ledgers)
      .where(and(eq(ledgers.account_type, "CUSTOMER_UDHARI"), eq(ledgers.entity_id, customerId)))
      .all();
    expect(udhariLedgers).toHaveLength(1);
    // Opening 1000 (DEBIT) + 600 credit sale = 1600 outstanding.
    expect(udhariLedgers[0].balance_paise).toBe(160000);
  });
});
