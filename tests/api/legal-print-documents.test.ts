import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import {
  customers,
  gssAccounts,
  gssReceipts,
  gssTemplates,
  jobOrders,
  jobReceipts,
  journalEntries,
  karigars,
  ledgers,
  materialIssues,
  refineries,
  refineryTransfers,
  stockVerificationScans,
  stockVerificationSessions,
  urdVouchers,
  voucherHeaders,
  voucherLines
} from "../../src/db/schema.js";

describe("legal production print documents", () => {
  let adminToken: string;

  beforeEach(async () => {
    db.delete(gssReceipts).run();
    db.delete(gssAccounts).run();
    db.delete(gssTemplates).run();
    db.delete(customers).run();

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  it("serves URD, GSS, voucher, Karigar, refinery, and stock verification PDFs", async () => {
    const customer = db.insert(customers).values({
      name: "Legal Print Customer",
      phone: "9000000001",
      pan_number: "ABCDE1234F",
      aadhaar_number: "123456789012"
    }).returning().get();

    const urd = db.insert(urdVouchers).values({
      voucher_number: "URD-LEGAL-001",
      customer_id: customer.id,
      customer_name: customer.name,
      customer_phone: customer.phone,
      voucher_date: "2026-06-04",
      description: "Old gold bangles",
      metal_type: "Gold",
      purity_tunch: "91.60",
      gross_weight_mg: 12000,
      stone_weight_mg: 500,
      black_bead_weight_mg: 0,
      net_weight_mg: 11500,
      fine_weight_mg: 10534,
      applied_rate_paise_per_gram: 600000,
      total_value_paise: 6900000,
      payment_mode: "CASH",
      payment_reference: "CASH-001",
      pan_number: "ABCDE1234F",
      aadhaar_number: "123456789012"
    }).returning().get();

    const template = db.insert(gssTemplates).values({
      scheme_code: "GSSLEGAL",
      scheme_name: "Legal Gold Plan",
      duration_months: 11,
      monthly_amount_paise: 500000,
      bonus_rule_type: "FIXED_AMOUNT",
      bonus_value_paise: 500000,
      is_active: true
    }).returning().get();
    const account = db.insert(gssAccounts).values({
      customer_id: customer.id,
      template_id: template.id,
      card_number: "GSSLEGAL001",
      enrollment_date: "2026-01-01",
      maturity_date: "2026-12-01",
      status: "ACTIVE",
      total_paid_paise: 500000,
      installments_paid_count: 1
    }).returning().get();
    const gssReceipt = db.insert(gssReceipts).values({
      gss_account_id: account.id,
      installment_number: 1,
      payment_date: "2026-06-04",
      amount_paid_paise: 500000,
      payment_mode: "CASH"
    }).returning().get();

    const cashLedger = db.insert(ledgers).values({
      account_name: "Legal Cash",
      account_type: "CASH",
      balance_paise: 0
    }).returning().get();
    const salesLedger = db.insert(ledgers).values({
      account_name: "Legal Sales",
      account_type: "SALES",
      balance_paise: 0
    }).returning().get();
    const journal = db.insert(journalEntries).values({
      ledger_id: cashLedger.id,
      transaction_type: "DEBIT",
      amount_paise: 100000,
      reference_type: "LEGAL_TEST",
      description: "Legal print test"
    }).returning().get();
    const voucher = db.insert(voucherHeaders).values({
      voucher_number: "VCH-LEGAL-001",
      voucher_type: "MANUAL",
      reference_type: "LEGAL_TEST",
      reference_id: null,
      narration: "Legal print test voucher",
      total_debit_paise: 100000,
      total_credit_paise: 100000,
      status: "POSTED"
    }).returning().get();
    db.insert(voucherLines).values([
      {
        voucher_id: voucher.id,
        ledger_id: cashLedger.id,
        transaction_type: "DEBIT",
        amount_paise: 100000,
        description: "Cash received",
        journal_entry_id: journal.id
      },
      {
        voucher_id: voucher.id,
        ledger_id: salesLedger.id,
        transaction_type: "CREDIT",
        amount_paise: 100000,
        description: "Sales credited"
      }
    ]).run();

    const job = db.insert(jobOrders).values({
      order_number: "JOB-LEGAL-001",
      karigar_id: 1,
      target_purity: 9160,
      target_weight_mg: 10000,
      status: "COMPLETED"
    }).returning().get();
    db.insert(materialIssues).values({
      job_id: job.id,
      issue_date: "2026-06-04",
      metal_type: "Gold",
      purity_tunch: 9160,
      gross_weight_mg: 11000,
      fine_gold_mg: 10076,
      issued_by: 1
    }).run();
    db.insert(jobReceipts).values({
      job_id: job.id,
      receive_date: "2026-06-05",
      final_gross_weight_mg: 10100,
      final_net_weight_mg: 10000,
      scrap_returned_mg: 200,
      scrap_purity_tunch: 9160,
      acceptable_loss_mg: 100,
      actual_loss_mg: 80,
      excess_loss_mg: 0,
      is_anomaly: false,
      fine_gold_debited_mg: 10076,
      labor_charge_paise: 250000
    }).run();

    const refinery = db.insert(refineries).values({
      name: "Legal Refinery",
      phone: "9000000002"
    }).returning().get();
    const transfer = db.insert(refineryTransfers).values({
      refinery_id: refinery.id,
      transfer_date: "2026-06-04",
      metal_type: "Gold",
      gross_weight_mg: 50000,
      purity_tunch: 91.6,
      fine_gold_mg: 45800,
      description: "Melting lot"
    }).returning().get();

    const session = db.insert(stockVerificationSessions).values({
      name: "Legal Stock Check",
      location: "VAULT",
      expected_status: "IN_STOCK",
      status: "COMPLETED",
      created_by: 1,
      completed_at: "2026-06-04 18:00:00"
    }).returning().get();
    db.insert(stockVerificationScans).values([
      {
        session_id: session.id,
        barcode: "ITEM-001",
        item_id: 1,
        result: "FOUND"
      },
      {
        session_id: session.id,
        barcode: "UNKNOWN-LEGAL",
        result: "UNKNOWN"
      }
    ]).run();

    const endpoints = [
      `/api/documents/urd-voucher/${urd.id}`,
      `/api/documents/gss/receipt/${gssReceipt.id}`,
      `/api/documents/voucher/${voucher.id}`,
      `/api/documents/karigar/job/${job.id}/slip`,
      `/api/documents/refinery/transfer/${transfer.id}/challan`,
      `/api/documents/stock-verification/${session.id}/report`
    ];

    for (const endpoint of endpoints) {
      const res = await request(app)
        .get(endpoint)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(Number(res.headers["content-length"] ?? res.body.length)).toBeGreaterThan(1000);
    }
  });
});
