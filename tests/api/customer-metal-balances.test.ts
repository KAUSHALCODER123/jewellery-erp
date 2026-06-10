import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, items } from "../../src/db/schema.js";

describe("Customer metal balances, blacklist & voter-ID KYC", () => {
  let adminToken: string;
  let staffToken: string;
  let customerId: number;

  beforeEach(async () => {
    const adminRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(adminRes.status).toBe(200);
    adminToken = adminRes.body.token;

    const staffRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_staff", password: "staff_pass" });
    expect(staffRes.status).toBe(200);
    staffToken = staffRes.body.token;

    db.delete(customers).run();
    const customer = db
      .insert(customers)
      .values({ name: "Metal Balance Customer", phone: "9001234567" })
      .returning()
      .get();
    customerId = customer.id;
  });

  test("metal balances: admin CRUD, staff read-only, appears in customer 360", async () => {
    const createRes = await request(app)
      .post(`/api/crm/customers/${customerId}/metal-balances`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ metal_type: "Gold", fine_weight_mg: 25000, direction: "TO_RECEIVE", notes: "Opening migration" });
    expect(createRes.status).toBe(201);
    expect(createRes.body.metal_balance.fine_weight_mg).toBe(25000);

    // Staff cannot create.
    const staffCreateRes = await request(app)
      .post(`/api/crm/customers/${customerId}/metal-balances`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ metal_type: "Silver", fine_weight_mg: 1000 });
    expect(staffCreateRes.status).toBe(403);

    // Staff can read.
    const listRes = await request(app)
      .get(`/api/crm/customers/${customerId}/metal-balances`)
      .set("Authorization", `Bearer ${staffToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.metal_balances).toHaveLength(1);

    // Shows in customer 360.
    const view360 = await request(app)
      .get(`/api/crm/customers/${customerId}/360`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(view360.status).toBe(200);
    expect(view360.body.metal_balances).toHaveLength(1);
    expect(view360.body.metal_balances[0].metal_type).toBe("Gold");

    // Validation: bad metal type rejected.
    const badRes = await request(app)
      .post(`/api/crm/customers/${customerId}/metal-balances`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ metal_type: "Copper", fine_weight_mg: 1000 });
    expect(badRes.status).toBe(400);

    // Admin delete.
    const deleteRes = await request(app)
      .delete(`/api/crm/customers/${customerId}/metal-balances/${createRes.body.metal_balance.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);
  });

  test("blacklist: admin toggle requires a reason and blocks udhari at POS", async () => {
    // Staff cannot blacklist.
    const staffRes = await request(app)
      .patch(`/api/crm/customers/${customerId}/blacklist`)
      .set("Authorization", `Bearer ${staffToken}`)
      .send({ is_blacklisted: true, reason: "x" });
    expect(staffRes.status).toBe(403);

    // Reason is required.
    const noReasonRes = await request(app)
      .patch(`/api/crm/customers/${customerId}/blacklist`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ is_blacklisted: true });
    expect(noReasonRes.status).toBe(400);

    const blacklistRes = await request(app)
      .patch(`/api/crm/customers/${customerId}/blacklist`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ is_blacklisted: true, reason: "Bounced cheques" });
    expect(blacklistRes.status).toBe(200);
    expect(blacklistRes.body.customer.is_blacklisted).toBe(true);

    // Udhari (credit) checkout is blocked...
    db.update(items).set({ status: "IN_STOCK" }).where(eq(items.id, 1)).run();
    const itemTotalPaise = 6000000;
    const buildCheckout = (payments: Record<string, number>) => ({
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
      payments: { cash: 0, upi: 0, card: 0, udhari: 0, gssCredit: 0, ...payments },
      paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
      invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
      kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
    });

    const udhariRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(buildCheckout({ udhari: itemTotalPaise }));
    expect(udhariRes.status).toBe(422);
    expect(udhariRes.body.errors[0]).toContain("blacklisted");

    // ...but a fully-paid cash sale still goes through.
    const cashRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(buildCheckout({ cash: itemTotalPaise }));
    expect(cashRes.status).toBe(201);
  });

  test("KYC vault accepts voter ID and masks the document number", async () => {
    const res = await request(app)
      .post(`/api/crm/customers/${customerId}/kyc`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ document_type: "VOTER_ID", document_number: "XYZ1234567" });

    expect(res.status).toBe(201);
    expect(res.body.kyc_record.document_type).toBe("VOTER_ID");
    expect(res.body.kyc_record.document_number_masked).toBe("******4567");

    const badRes = await request(app)
      .post(`/api/crm/customers/${customerId}/kyc`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ document_type: "RATION_CARD", document_number: "XYZ1234567" });
    expect(badRes.status).toBe(400);
  });
});
