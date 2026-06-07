import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items } from "../../src/db/schema.js";

// P8 — unified Day Book business summary (sales / purchase / URD / karigar / cash-bank).
describe("Reports day-book summary", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    db.update(items).set({ status: "IN_STOCK", huid: "DAYBK1", huid_status: "HUID_RECEIVED", is_urd_recycled_gold: false }).where(eq(items.id, 1)).run();
  });

  it("aggregates today's sales and cash position", async () => {
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

    const res = await request(app)
      .get("/api/reports/daybook-summary")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.total_sales_paise).toBeGreaterThanOrEqual(6000000);
    expect(res.body.cash_in_hand_paise).toBeGreaterThanOrEqual(6000000);
    expect(res.body).toHaveProperty("total_urd_purchase_paise");
    expect(res.body).toHaveProperty("karigar_issued_fine_mg");

    // Payment-mode till tally: the all-cash sale lands in cash_received, not bank.
    expect(res.body.payment_modes.cash_received_paise).toBeGreaterThanOrEqual(6000000);
    expect(res.body.payment_modes.bank_received_paise).toBe(0);

    // Cash closing = opening + cash in - cash out (cash-only reconciliation).
    const recon = res.body.cash_reconciliation;
    expect(recon.closing_cash_paise).toBe(recon.opening_cash_paise + recon.cash_received_paise - recon.cash_paid_paise);
    expect(recon.cash_received_paise).toBeGreaterThanOrEqual(6000000);
  });

  it("reports cash-in-hand as of the viewed date, not the live balance", async () => {
    // Take cash today.
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

    // A far-past date predates that cash, so cash-in-hand must read 0 there.
    const past = await request(app)
      .get("/api/reports/daybook-summary?date=2020-01-01")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(past.status).toBe(200);
    expect(past.body.cash_in_hand_paise).toBe(0);
    expect(past.body.bank_balance_paise).toBe(0);
  });

  it("records an expense and reflects it in day-book cash reconciliation", async () => {
    const create = await request(app)
      .post("/api/accounts/expenses")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ category: "Shop Rent", amount_paise: 500000, payment_mode: "CASH", description: "June rent" });
    expect(create.status).toBe(201);
    expect(create.body.expense.category).toBe("Shop Rent");

    const res = await request(app)
      .get("/api/reports/daybook-summary")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body.total_expenses_paise).toBeGreaterThanOrEqual(500000);
    // Cash expense flows out of the till: counted in cash_paid and cash_expenses.
    expect(res.body.cash_reconciliation.cash_expenses_paise).toBeGreaterThanOrEqual(500000);
    expect(res.body.cash_reconciliation.cash_paid_paise).toBeGreaterThanOrEqual(500000);
  });

  it("denies COUNTER_STAFF access (RBAC)", async () => {
    const staffLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_staff", password: "staff_pass" });
    const res = await request(app)
      .get("/api/reports/daybook-summary")
      .set("Authorization", `Bearer ${staffLogin.body.token}`);
    expect(res.status).toBe(403);
  });
});
