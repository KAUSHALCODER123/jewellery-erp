import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { ledgers, voucherLines } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

describe("sales invoice parity and standalone URD voucher", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  it("stores invoice metadata, GST toggle, and payment references during checkout", async () => {
    const checkoutRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: null,
        sales_items: [
          {
            item_id: 1,
            barcode: "ITEM-001",
            net_weight_mg: 10000,
            metal_rate_paise_per_gram: 600000,
            making_charge_paise: 50000,
            item_total_paise: 6500000
          }
        ],
        urd_items: [],
        totals_paise: {
          gross_total: 6500000,
          discount: 0,
          urd_deduction: 0,
          net_payable: 6500000
        },
        payments_paise: {
          cash: 0,
          upi: 6500000,
          card: 0,
          udhari: 0
        },
        payment_references: {
          bank_name: "HDFC",
          upi_reference: "UPI123"
        },
        invoice: {
          bill_prefix: "GST",
          manual_number: "M-101",
          due_date: "2026-06-30",
          salesman_name: "Counter 1",
          gst_not_required: true
        }
      });

    expect(checkoutRes.status).toBe(201);
    expect(checkoutRes.body.invoice).toMatchObject({
      bill_prefix: "GST",
      manual_number: "M-101",
      due_date: "2026-06-30",
      salesman_name: "Counter 1",
      gst_not_required: true,
      gst_amount_paise: 0
    });
    expect(JSON.parse(checkoutRes.body.invoice.payment_reference_json)).toMatchObject({
      bankName: "HDFC",
      upi: "UPI123"
    });
    expect(checkoutRes.body.voucher).toMatchObject({
      voucher_type: "POS_SALE",
      reference_type: "POS_INVOICE",
      reference_id: checkoutRes.body.invoice.id,
      total_debit_paise: 6500000,
      total_credit_paise: 6500000
    });
    expect(checkoutRes.body.journal_entries).toHaveLength(2);

    const voucherLinesRows = db
      .select()
      .from(voucherLines)
      .where(eq(voucherLines.voucher_id, checkoutRes.body.voucher.id))
      .all();
    const ledgerRows = db.select().from(ledgers).all();
    const ledgerById = new Map(ledgerRows.map((ledger) => [ledger.id, ledger]));
    const debitLine = voucherLinesRows.find((line) => line.transaction_type === "DEBIT");
    const creditLine = voucherLinesRows.find((line) => line.transaction_type === "CREDIT");

    expect(debitLine?.amount_paise).toBe(6500000);
    expect(ledgerById.get(debitLine?.ledger_id ?? 0)?.account_name).toBe("UPI Bank");
    expect(creditLine?.amount_paise).toBe(6500000);
    expect(ledgerById.get(creditLine?.ledger_id ?? 0)?.account_name).toBe("Sales Revenue");
  });

  it("creates a standalone URD voucher with fine-weight calculation", async () => {
    const voucherRes = await request(app)
      .post("/api/pos/urd-vouchers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_name: "Walk In Seller",
        customer_phone: "9999999999",
        voucher_date: "2026-06-04",
        description: "Old chain",
        metal_type: "Gold",
        purity_tunch: "91.6",
        gross_weight_mg: 10000,
        stone_weight_mg: 500,
        black_bead_weight_mg: 200,
        applied_rate_paise_per_gram: 600000,
        total_value_paise: 5580000,
        payment_mode: "CASH",
        payment_reference: "PV-1"
      });

    expect(voucherRes.status).toBe(201);
    expect(voucherRes.body.voucher).toMatchObject({
      customer_name: "Walk In Seller",
      net_weight_g: "9.300",
      fine_weight_g: "8.519",
      total_value_rupees: "55800.00"
    });
    expect(voucherRes.body.voucher.voucher_number).toMatch(/^URD-/);
  });
});
