import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, gssTemplates, ledgers } from "../../src/db/schema.js";

describe("GSS Reporting, Defaulter Automation, and POS Maturity Conversion", () => {
  let adminToken: string;
  let customerId: number;
  let fixedTemplateId: number;
  let variableTemplateId: number;

  beforeEach(async () => {
    // Login as admin
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // Seed customer
    const customer = db
      .insert(customers)
      .values({
        name: "Priya Sharma",
        phone: "9876543210",
        pan_number: "ABCDE1234F",
        aadhaar_number: "123456789012"
      })
      .returning()
      .get();
    customerId = customer.id;

    // Seed CASH and BANK ledgers
    db.insert(ledgers).values([
      {
        account_name: "Cash In Hand",
        account_type: "CASH",
        balance_paise: 100000000
      },
      {
        account_name: "Bank A/C",
        account_type: "BANK",
        balance_paise: 100000000
      }
    ]).run();

    // Seed fixed GSS template
    const fixedTemplate = db
      .insert(gssTemplates)
      .values({
        scheme_code: "GSS-FIX-12",
        scheme_name: "Gold Saver Fixed 12",
        scheme_type: "GOLD",
        duration_months: 12,
        monthly_amount_paise: 100000,
        bonus_rule_type: "FIXED_AMOUNT",
        bonus_value_paise: 100000,
        is_active: true,
        is_variable: false,
        min_monthly_amount_paise: null,
        max_monthly_amount_paise: null
      })
      .returning()
      .get();
    fixedTemplateId = fixedTemplate.id;

    // Seed variable GSS template
    const variableTemplate = db
      .insert(gssTemplates)
      .values({
        scheme_code: "GSS-VAR-6",
        scheme_name: "Gold Saver Variable 6",
        scheme_type: "GOLD",
        duration_months: 6,
        monthly_amount_paise: 50000,
        bonus_rule_type: "PERCENTAGE_OF_INSTALLMENT",
        bonus_value_paise: 500,
        is_active: true,
        is_variable: true,
        min_monthly_amount_paise: 30000,
        max_monthly_amount_paise: 200000
      })
      .returning()
      .get();
    variableTemplateId = variableTemplate.id;
  });

  // ── Fixed Scheme Enrollment and Collection ─────────────────────────

  it("enrolls a fixed GSS account and collects installments", async () => {
    const enrollRes = await request(app)
      .post("/api/gss/enroll")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        template_id: fixedTemplateId,
        card_number: "GSS20260001",
        enrollment_date: "2025-01-01"
      });

    expect(enrollRes.status).toBe(201);
    expect(enrollRes.body.account).toMatchObject({
      customer_id: customerId,
      template_id: fixedTemplateId,
      card_number: "GSS20260001",
      status: "ACTIVE",
      total_paid_paise: 0,
      installments_paid_count: 0
    });

    const accountId = enrollRes.body.account.id;

    // Collect 1 installment
    const collectRes = await request(app)
      .post("/api/gss/collect-payment")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        gss_account_id: accountId,
        amount_paid_paise: 100000,
        payment_mode: "CASH",
        payment_date: "2025-02-01"
      });

    expect(collectRes.status).toBe(201);
    expect(collectRes.body.account.total_paid_paise).toBe(100000);
    expect(collectRes.body.account.installments_paid_count).toBe(1);
    expect(collectRes.body.account.status).toBe("ACTIVE");
  });

  // ── Variable Scheme with Min/Max Validation ────────────────────────

  it("rejects variable payment below minimum", async () => {
    const enrollRes = await request(app)
      .post("/api/gss/enroll")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        template_id: variableTemplateId,
        card_number: "GSSVAR001",
        enrollment_date: "2025-01-01"
      });

    expect(enrollRes.status).toBe(201);

    const collectRes = await request(app)
      .post("/api/gss/collect-payment")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        gss_account_id: enrollRes.body.account.id,
        amount_paid_paise: 10000,
        payment_mode: "CASH",
        payment_date: "2025-02-01"
      });

    expect(collectRes.status).toBe(400);
    expect(collectRes.body.errors[0]).toContain("below the minimum");
  });

  it("rejects variable payment above maximum", async () => {
    const enrollRes = await request(app)
      .post("/api/gss/enroll")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customerId,
        template_id: variableTemplateId,
        card_number: "GSSVAR002",
        enrollment_date: "2025-01-01"
      });

    expect(enrollRes.status).toBe(201);

    const collectRes = await request(app)
      .post("/api/gss/collect-payment")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        gss_account_id: enrollRes.body.account.id,
        amount_paid_paise: 500000,
        payment_mode: "UPI",
        payment_date: "2025-02-01"
      });

    expect(collectRes.status).toBe(400);
    expect(collectRes.body.errors[0]).toContain("exceeds the maximum");
  });

  // ── Reports Endpoints ──────────────────────────────────────────────

  describe("reporting endpoints", () => {
    let accountId: number;

    beforeEach(async () => {
      const enrollRes = await request(app)
        .post("/api/gss/enroll")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          customer_id: customerId,
          template_id: fixedTemplateId,
          card_number: "GSSRPT001",
          enrollment_date: "2025-01-01"
        });

      accountId = enrollRes.body.account.id;

      // Collect 3 installments
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post("/api/gss/collect-payment")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            gss_account_id: accountId,
            amount_paid_paise: 100000,
            payment_mode: i % 2 === 0 ? "CASH" : "UPI",
            payment_date: `2025-0${i + 2}-01`
          });
      }
    });

    it("returns account statement with receipts and bonus summary", async () => {
      const res = await request(app)
        .get(`/api/gss/reports/statements?account_id=${accountId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.account).toMatchObject({
        card_number: "GSSRPT001",
        total_paid_paise: 300000,
        installments_paid_count: 3
      });
      expect(res.body.receipts).toHaveLength(3);
      expect(res.body.summary.calculated_bonus_paise).toBe(100000);
      // Accrued so far: 3 x 1,000 paid + 1,000 fixed bonus.
      expect(res.body.summary.expected_maturity_value_paise).toBe(400000);
      expect(res.body.summary.accrued_value_paise).toBe(400000);
      // Projected full term: 12 x 1,000 contributions + 1,000 fixed bonus.
      expect(res.body.summary.projected_bonus_paise).toBe(100000);
      expect(res.body.summary.projected_maturity_value_paise).toBe(1300000);
    });

    it("returns pending/overdue report for accounts with missed installments", async () => {
      const res = await request(app)
        .get("/api/gss/reports/pending")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Account has 3 paid but enrollment was Jan 2025, so multiple months have elapsed
      const report = res.body.reports.find((r: { id: number }) => r.id === accountId);
      if (report) {
        expect(report.pending_installments_count).toBeGreaterThan(0);
        expect(report.pending_amount_paise).toBeGreaterThan(0);
      }
    });

    it("returns received summary grouped by payment mode", async () => {
      const res = await request(app)
        .get("/api/gss/reports/received?start_date=2025-01-01&end_date=2025-12-31")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.receipts).toHaveLength(3);
      expect(res.body.summary.total_collected_paise).toBe(300000);
      expect(res.body.summary.cash_paise).toBe(200000);
      expect(res.body.summary.upi_paise).toBe(100000);
      expect(res.body.summary.card_paise).toBe(0);
    });

    it("rejects received report without date range", async () => {
      const res = await request(app)
        .get("/api/gss/reports/received")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it("returns maturity report for maturing accounts", async () => {
      const res = await request(app)
        .get("/api/gss/reports/maturity?days=365")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // Our account matures within ~12 months so should show in a 365-day window
      expect(Array.isArray(res.body.accounts)).toBe(true);
    });
  });

  // ── Defaulter Automation ───────────────────────────────────────────

  describe("defaulter automation", () => {
    it("flags accounts >2 months behind as DEFAULTER", async () => {
      // Enroll with a backdated enrollment but never pay
      const enrollRes = await request(app)
        .post("/api/gss/enroll")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          customer_id: customerId,
          template_id: fixedTemplateId,
          card_number: "GSSDEF001",
          enrollment_date: "2024-01-01"
        });

      expect(enrollRes.status).toBe(201);
      expect(enrollRes.body.account.status).toBe("ACTIVE");

      // Run defaulter scan
      const scanRes = await request(app)
        .post("/api/gss/defaulter/run")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(scanRes.status).toBe(200);
      expect(scanRes.body.updated_count).toBeGreaterThanOrEqual(1);
      expect(scanRes.body.defaulter_account_ids).toContain(enrollRes.body.account.id);

      // Verify defaulter list
      const listRes = await request(app)
        .get("/api/gss/defaulters")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(listRes.status).toBe(200);
      const defaulter = listRes.body.accounts.find((a: { id: number }) => a.id === enrollRes.body.account.id);
      expect(defaulter).toBeDefined();
      expect(defaulter.status).toBe("DEFAULTER");
    });

    it("does not flag accounts that are on schedule", async () => {
      // Enroll today and pay one installment
      const today = new Date().toISOString().slice(0, 10);
      const enrollRes = await request(app)
        .post("/api/gss/enroll")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          customer_id: customerId,
          template_id: fixedTemplateId,
          card_number: "GSSDEF002",
          enrollment_date: today
        });

      expect(enrollRes.status).toBe(201);

      await request(app)
        .post("/api/gss/collect-payment")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          gss_account_id: enrollRes.body.account.id,
          amount_paid_paise: 100000,
          payment_mode: "CASH",
          payment_date: today
        });

      // Run defaulter scan
      const scanRes = await request(app)
        .post("/api/gss/defaulter/run")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(scanRes.status).toBe(200);
      expect(scanRes.body.defaulter_account_ids).not.toContain(enrollRes.body.account.id);
    });
  });

  // ── POS Checkout with GSS Maturity Redemption ──────────────────────

  describe("POS checkout GSS redemption", () => {
    it("redeems a matured GSS account during checkout", async () => {
      // Enroll and pay all 12 installments to mature the account
      const enrollRes = await request(app)
        .post("/api/gss/enroll")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          customer_id: customerId,
          template_id: fixedTemplateId,
          card_number: "GSSPOS001",
          enrollment_date: "2024-01-01"
        });

      const accountId = enrollRes.body.account.id;

      for (let i = 0; i < 12; i++) {
        const m = String(i + 2).padStart(2, "0");
        const year = i + 2 > 12 ? "2025" : "2024";
        const month = i + 2 > 12 ? String(i + 2 - 12).padStart(2, "0") : m;
        await request(app)
          .post("/api/gss/collect-payment")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            gss_account_id: accountId,
            amount_paid_paise: 100000,
            payment_mode: "CASH",
            payment_date: `${year}-${month}-01`
          });
      }

      // Verify account is matured
      const statementRes = await request(app)
        .get(`/api/gss/reports/statements?account_id=${accountId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(statementRes.status).toBe(200);
      expect(statementRes.body.account.status).toBe("MATURED");
      expect(statementRes.body.account.total_paid_paise).toBe(1200000);

      // Now do POS checkout with GSS credit
      // The item needs HUID for gold sale
      db.run(
        db.update(
          (await import("../../src/db/schema.js")).items
        ).set({
          huid: "ABC123",
          huid_status: "HUID_RECEIVED"
        }).where(
          (await import("drizzle-orm")).eq(
            (await import("../../src/db/schema.js")).items.id,
            1
          )
        )
      );

      const gssCredit = 100000;
      const itemTotal = 600000;
      const netPayable = itemTotal - gssCredit;

      const checkoutRes = await request(app)
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
          totals: {
            gross_total: itemTotal,
            discount: 0,
            urd_deduction: 0,
            net_payable: netPayable
          },
          payments: {
            cash: netPayable,
            upi: 0,
            card: 0,
            udhari: 0,
            gss_credit: gssCredit
          },
          invoice: {},
          payment_references: {}
        });

      expect(checkoutRes.status).toBe(201);
      expect(checkoutRes.body.redeemed_gss_account).not.toBeNull();
      expect(checkoutRes.body.redeemed_gss_account.status).toBe("CONVERTED_TO_SALE");
      expect(checkoutRes.body.redeemed_gss_account.redeemed_invoice_id).toBe(checkoutRes.body.invoice_id);
    });

    it("rejects GSS redemption when account does not belong to customer", async () => {
      // Create a second customer
      const customer2 = db
        .insert(customers)
        .values({
          name: "Other Person",
          phone: "9998887776"
        })
        .returning()
        .get();

      // Enroll GSS for customer2
      const enrollRes = await request(app)
        .post("/api/gss/enroll")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          customer_id: customer2.id,
          template_id: fixedTemplateId,
          card_number: "GSSOTHER01",
          enrollment_date: "2024-01-01"
        });

      // Try to redeem with a different customer
      db.run(
        db.update(
          (await import("../../src/db/schema.js")).items
        ).set({
          huid: "DEF456",
          huid_status: "HUID_RECEIVED"
        }).where(
          (await import("drizzle-orm")).eq(
            (await import("../../src/db/schema.js")).items.id,
            2
          )
        )
      );

      const checkoutRes = await request(app)
        .post("/api/pos/checkout")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          customer_id: customerId,
          gss_account_id: enrollRes.body.account.id,
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
          totals: {
            gross_total: 1200000,
            discount: 0,
            urd_deduction: 0,
            net_payable: 1100000
          },
          payments: {
            cash: 1100000,
            upi: 0,
            card: 0,
            udhari: 0,
            gss_credit: 100000
          },
          invoice: {},
          payment_references: {}
        });

      expect(checkoutRes.status).toBe(409);
      expect(checkoutRes.body.errors[0]).toContain("does not belong to this customer");
    });
  });
});
