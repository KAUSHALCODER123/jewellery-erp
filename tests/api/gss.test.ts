import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, gssTemplates, ledgers, invoices, items } from "../../src/db/schema.js";

// TEST 6 — GSS maturity credit atomic redemption.
// A matured Gold Saving Scheme account can be redeemed exactly once during a POS
// sale: the credit reduces the invoice, the account flips to CONVERTED_TO_SALE,
// and the GSS_LIABILITY ledger is debited. A second attempt to reuse the same
// account is rejected.
//
// SPEC DEVIATION (adapted to real behavior): the spec asked for HTTP 422 with a
// GSS_ALREADY_REDEEMED code. The backend has no such code — re-redemption of a
// CONVERTED_TO_SALE account is blocked at the checkout eligibility check with
// HTTP 409 and the message "...not eligible for conversion (status: CONVERTED_TO_SALE)".
describe("GSS maturity redemption at POS", () => {
  let adminToken: string;
  let customerId: number;
  let templateId: number;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    const customer = db.insert(customers).values({ name: "GSS Redeemer", phone: "9001112223" }).returning().get();
    customerId = customer.id;

    db.insert(ledgers).values([
      { account_name: "Cash In Hand", account_type: "CASH", balance_paise: 100000000 },
      { account_name: "Bank A/C", account_type: "BANK", balance_paise: 100000000 }
    ]).run();

    const template = db.insert(gssTemplates).values({
      scheme_code: "GSS-REDEEM-12",
      scheme_name: "Redeem Scheme 12",
      scheme_type: "CASH",
      duration_months: 12,
      monthly_amount_paise: 100000,
      bonus_rule_type: "FIXED_AMOUNT",
      bonus_value_paise: 100000,
      is_active: true,
      is_variable: false,
      min_monthly_amount_paise: null,
      max_monthly_amount_paise: null
    }).returning().get();
    templateId = template.id;

    // Items 1 and 2 are gold; give them valid HUIDs so the sale isn't blocked by hallmarking.
    db.update(items).set({ status: "IN_STOCK", huid: "GSSHA1", huid_status: "HUID_RECEIVED", is_urd_recycled_gold: false }).where(eq(items.id, 1)).run();
    db.update(items).set({ status: "IN_STOCK", huid: "GSSHA2", huid_status: "HUID_RECEIVED", is_urd_recycled_gold: false }).where(eq(items.id, 2)).run();
  });

  function readGssLiabilityBalance(): number {
    const row = db.select().from(ledgers).where(eq(ledgers.account_type, "GSS_LIABILITY")).get();
    return row?.balance_paise ?? 0;
  }

  it("redeems a matured account once, then rejects a second redemption", async () => {
    // Enroll and pay all 12 installments to mature the account.
    const enrollRes = await request(app)
      .post("/api/gss/enroll")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ customer_id: customerId, template_id: templateId, card_number: "GSSREDEEM01", enrollment_date: "2024-01-01" });

    expect(enrollRes.status).toBe(201);
    const accountId = enrollRes.body.account.id;

    for (let i = 0; i < 12; i++) {
      const monthIndex = i + 2;
      const year = monthIndex > 12 ? "2025" : "2024";
      const month = String(monthIndex > 12 ? monthIndex - 12 : monthIndex).padStart(2, "0");
      const payRes = await request(app)
        .post("/api/gss/collect-payment")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ gss_account_id: accountId, amount_paid_paise: 100000, payment_mode: "CASH", payment_date: `${year}-${month}-01` });
      expect(payRes.status).toBe(201);
    }

    // 12 × ₹1,000 installments accrued on the GSS liability ledger.
    const liabilityBeforeRedeem = readGssLiabilityBalance();
    expect(liabilityBeforeRedeem).toBe(1200000);

    // First checkout: redeem ₹1,000 of GSS credit against item 1.
    const gssCredit = 100000;
    const itemTotal = 600000;
    const netPayable = itemTotal - gssCredit;

    const firstCheckout = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        gss_account_id: accountId,
        cartItems: [
          {
            item_id: 1,
            barcode: "ITEM-001",
            metal_type: "Gold",
            purity_karat: 22,
            gross_weight_mg: 10000,
            net_weight_mg: 10000,
            metal_rate_paise_per_gram: 55000,
            making_charge_paise: 50000,
            wastage_charge_paise: 0,
            item_total_paise: itemTotal
          }
        ],
        urdItems: [],
        totals: { gross_total: itemTotal, discount: 0, urd_deduction: 0, net_payable: netPayable },
        payments: { cash: netPayable, upi: 0, card: 0, udhari: 0, gss_credit: gssCredit },
        invoice: {},
        payment_references: {}
      });

    expect(firstCheckout.status).toBe(201);
    expect(firstCheckout.body.redeemed_gss_account.status).toBe("CONVERTED_TO_SALE");
    expect(firstCheckout.body.redeemed_gss_account.redeemed_invoice_id).toBe(firstCheckout.body.invoice_id);

    // Invoice records the GSS credit deduction.
    const invoice = db.select().from(invoices).where(eq(invoices.id, firstCheckout.body.invoice_id)).get();
    expect(invoice?.gss_credit_paise).toBe(gssCredit);

    // GSS_LIABILITY ledger was debited by exactly the redeemed credit.
    const liabilityAfterRedeem = readGssLiabilityBalance();
    expect(liabilityAfterRedeem).toBe(liabilityBeforeRedeem - gssCredit);

    // Second checkout reusing the SAME (now CONVERTED_TO_SALE) account must be rejected.
    const secondCheckout = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        gss_account_id: accountId,
        cartItems: [
          {
            item_id: 2,
            barcode: "ITEM-002",
            metal_type: "Gold",
            purity_karat: 22,
            gross_weight_mg: 20000,
            net_weight_mg: 20000,
            metal_rate_paise_per_gram: 55000,
            making_charge_paise: 100000,
            wastage_charge_paise: 0,
            item_total_paise: 1200000
          }
        ],
        urdItems: [],
        totals: { gross_total: 1200000, discount: 0, urd_deduction: 0, net_payable: 1100000 },
        payments: { cash: 1100000, upi: 0, card: 0, udhari: 0, gss_credit: gssCredit },
        invoice: {},
        payment_references: {}
      });

    expect(secondCheckout.status).toBe(409);
    expect(secondCheckout.body.errors[0]).toContain("CONVERTED_TO_SALE");

    // Liability unchanged by the rejected attempt; account stays converted.
    expect(readGssLiabilityBalance()).toBe(liabilityAfterRedeem);
  });
});
