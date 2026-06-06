import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, ledgers, messageLogs, voucherHeaders, voucherLines } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

describe("Voucher accounting and ledger reports API", () => {
  let adminToken: string;
  let cashLedgerId: number;
  let bankLedgerId: number;
  let expenseLedgerId: number;

  beforeEach(async () => {
    // 1. Log in as admin to get token
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // 2. Seed custom test ledgers inside the test database (isolated per test)
    const cashLedger = db
      .insert(ledgers)
      .values({
        account_name: "Cash A/C",
        account_type: "CASH",
        balance_paise: 0
      })
      .returning()
      .get();
    cashLedgerId = cashLedger.id;

    const bankLedger = db
      .insert(ledgers)
      .values({
        account_name: "HDFC Bank A/C",
        account_type: "BANK",
        balance_paise: 0
      })
      .returning()
      .get();
    bankLedgerId = bankLedger.id;

    const expenseLedger = db
      .insert(ledgers)
      .values({
        account_name: "Office Rent Expense",
        account_type: "VENDOR",
        balance_paise: 0
      })
      .returning()
      .get();
    expenseLedgerId = expenseLedger.id;
  });

  it("posts manual payment and contra vouchers and updates ledger balances", async () => {
    // Post payment voucher: Debit Rent Expense, Credit Cash A/C
    const paymentRes = await request(app)
      .post("/api/accounts/vouchers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        debit_ledger_id: expenseLedgerId,
        credit_ledger_id: cashLedgerId,
        amount_paise: 500000, // Rs 5000
        reference_type: "MANUAL",
        description: "May 2026 Office Rent Payment"
      });

    expect(paymentRes.status).toBe(201);
    expect(paymentRes.body.voucher).toMatchObject({
      voucher_type: "MANUAL",
      reference_type: "MANUAL",
      total_debit_paise: 500000,
      total_credit_paise: 500000,
      status: "POSTED"
    });
    expect(paymentRes.body.journal_entries).toHaveLength(2);
    const debit = paymentRes.body.journal_entries.find((e: any) => e.transaction_type === "DEBIT");
    const credit = paymentRes.body.journal_entries.find((e: any) => e.transaction_type === "CREDIT");
    expect(debit.ledger_id).toBe(expenseLedgerId);
    expect(credit.ledger_id).toBe(cashLedgerId);
    expect(debit.reference_id).toBe(credit.reference_id); // Map counterpart match

    // Check balances in database
    const dbCash = db.select().from(ledgers).where(eq(ledgers.id, cashLedgerId)).get();
    const dbExpense = db.select().from(ledgers).where(eq(ledgers.id, expenseLedgerId)).get();
    expect(dbCash?.balance_paise).toBe(-500000);
    expect(dbExpense?.balance_paise).toBe(500000);

    const dbVoucher = db.select().from(voucherHeaders).where(eq(voucherHeaders.id, paymentRes.body.voucher.id)).get();
    const dbVoucherLines = db.select().from(voucherLines).where(eq(voucherLines.voucher_id, paymentRes.body.voucher.id)).all();
    expect(dbVoucher?.total_debit_paise).toBe(500000);
    expect(dbVoucherLines).toHaveLength(2);
  });

  it("supports backdating / custom voucher dates", async () => {
    const customDate = "2026-05-15";
    const contraRes = await request(app)
      .post("/api/accounts/vouchers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        debit_ledger_id: bankLedgerId,
        credit_ledger_id: cashLedgerId,
        amount_paise: 1000000, // Rs 10000 deposit to bank
        reference_type: "MANUAL",
        created_at: customDate,
        description: "Cash deposit to bank"
      });

    expect(contraRes.status).toBe(201);
    const debit = contraRes.body.journal_entries[0];
    expect(debit.created_at).toContain("2026-05-15");
  });

  it("generates a correct ledger statement report with opening balance and counterparts", async () => {
    // 1. Create a prior entry before report date range (e.g. 2026-04-10)
    await request(app)
      .post("/api/accounts/vouchers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        debit_ledger_id: bankLedgerId,
        credit_ledger_id: cashLedgerId,
        amount_paise: 300000, // Rs 3000
        reference_type: "MANUAL",
        created_at: "2026-04-10",
        description: "Prior contra entry"
      });

    // 2. Create an entry within report date range (e.g. 2026-05-10)
    await request(app)
      .post("/api/accounts/vouchers")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        debit_ledger_id: expenseLedgerId,
        credit_ledger_id: cashLedgerId,
        amount_paise: 500000, // Rs 5000
        reference_type: "MANUAL",
        created_at: "2026-05-10",
        description: "Current rent payment"
      });

    // 3. Fetch ledger report for Cash A/C from 2026-05-01 to 2026-05-30
    const reportRes = await request(app)
      .get("/api/accounts/ledger-report")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        ledger_id: cashLedgerId,
        from_date: "2026-05-01",
        to_date: "2026-05-30"
      });

    expect(reportRes.status).toBe(200);
    expect(reportRes.body.ledger.id).toBe(cashLedgerId);
    
    // Prior entry at 2026-04-10: Credit Cash Rs 3000 (-300000)
    // Opening balance before 2026-05-01 should be -300000 paise
    expect(reportRes.body.opening_balance_paise).toBe(-300000);
    
    // There should be exactly 1 entry in the report matching 2026-05-10
    expect(reportRes.body.entries).toHaveLength(1);
    const entry = reportRes.body.entries[0];
    expect(entry.created_at).toContain("2026-05-10");
    expect(entry.transaction_type).toBe("CREDIT");
    expect(entry.amount_paise).toBe(500000);
    
    // Running balance should go from -300000 (opening) to -800000 (after -500000)
    expect(entry.running_balance_paise).toBe(-800000);
    
    // Counterpart particular should correctly show the opposite ledger name: "Office Rent Expense"
    expect(entry.particulars).toBe("Office Rent Expense");
    
    // Closing balance
    expect(reportRes.body.closing_balance_paise).toBe(-800000);
  });

  it("sends a real dues reminder to a sundry debtor", async () => {
    const customer = db.insert(customers).values({ name: "Debtor Dilip", phone: "9876512345" }).returning().get();
    const udhariLedger = db.insert(ledgers).values({
      account_name: `Customer Udhari ${customer.name}`,
      account_type: "CUSTOMER_UDHARI",
      entity_id: customer.id,
      balance_paise: 750000
    }).returning().get();

    const res = await request(app)
      .post(`/api/accounts/udhari/${udhariLedger.id}/remind`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("SENT");
    // Returns a real WhatsApp deep link the jeweler can open to send.
    expect(res.body.whatsapp_link).toContain("wa.me/919876512345");
    expect(decodeURIComponent(res.body.whatsapp_link)).toContain("7500.00");

    // A WhatsApp message log was written for this customer with the dues amount.
    const log = db.select().from(messageLogs).where(eq(messageLogs.customer_id, customer.id)).get();
    expect(log?.template_name).toBe("UDHARI_BALANCE_REMINDER");
    expect(log?.message_body).toContain("7500.00");

    const statementRes = await request(app)
      .get("/api/accounts/ledger-report")
      .set("Authorization", `Bearer ${adminToken}`)
      .query({
        ledger_id: udhariLedger.id,
        from_date: "2026-05-01",
        to_date: "2026-05-30"
      });

    expect(statementRes.status).toBe(200);
    expect(statementRes.body.statement_share.customer_name).toBe("Debtor Dilip");
    expect(statementRes.body.statement_share.whatsapp_link).toContain("wa.me/919876512345");
    expect(decodeURIComponent(statementRes.body.statement_share.whatsapp_link)).toContain("Udhari ledger statement");
  });

  it("collects a standalone Udhari receipt and reduces customer outstanding balance", async () => {
    const customer = db.insert(customers).values({ name: "Sandeep", phone: "9000012345" }).returning().get();
    const udhariLedger = db.insert(ledgers).values({
      account_name: `Udhari - ${customer.name}`,
      account_type: "CUSTOMER_UDHARI",
      entity_id: customer.id,
      balance_paise: 950000
    }).returning().get();

    const res = await request(app)
      .post("/api/accounts/receipts/udhari")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: customer.id,
        amount_paise: 300000,
        payment_mode: "CASH",
        receipt_date: "2026-06-06"
      });

    expect(res.status).toBe(201);
    expect(res.body.receipt).toMatchObject({
      customer_id: customer.id,
      customer_name: "Sandeep",
      amount_paise: 300000,
      previous_balance_paise: 950000,
      balance_after_paise: 650000,
      payment_mode: "CASH"
    });
    expect(res.body.voucher.voucher_type).toBe("RECEIPT");
    expect(res.body.voucher.reference_type).toBe("UDHARI_RECEIPT");

    const updatedUdhari = db.select().from(ledgers).where(eq(ledgers.id, udhariLedger.id)).get();
    expect(updatedUdhari?.balance_paise).toBe(650000);

    const cashLedger = db.select().from(ledgers).where(eq(ledgers.account_name, "Cash")).get();
    expect(cashLedger?.balance_paise).toBeGreaterThanOrEqual(300000);
    expect(res.body.journal_entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transaction_type: "DEBIT", amount_paise: 300000 }),
        expect.objectContaining({ transaction_type: "CREDIT", amount_paise: 300000 })
      ])
    );
  });

  it("produces P&L, balance sheet and a balanced trial balance", async () => {
    // A cash expense: DEBIT Expense, CREDIT Cash.
    const exp = await request(app)
      .post("/api/accounts/expenses")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ category: "Electricity", amount_paise: 200000, payment_mode: "CASH" });
    expect(exp.status).toBe(201);

    const res = await request(app)
      .get("/api/accounts/financials")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    // Double-entry invariant: trial balance always balances.
    expect(res.body.trial_balance.balanced).toBe(true);
    expect(res.body.trial_balance.total_debit_paise).toBe(res.body.trial_balance.total_credit_paise);
    // Expense flows into the P&L.
    expect(res.body.pnl.expense_paise).toBeGreaterThanOrEqual(200000);
    expect(res.body.balance_sheet).toHaveProperty("total_assets_paise");
    expect(res.body.balance_sheet).toHaveProperty("equity_paise");
    // Opening Capital is the balancing plug → sheet always balances (Assets = Liabilities + Equity).
    expect(res.body.balance_sheet.balanced_difference_paise).toBe(0);
    expect(res.body.balance_sheet.total_assets_paise).toBe(
      res.body.balance_sheet.total_liabilities_paise + res.body.balance_sheet.equity_paise
    );
  });
});
