import { eq } from "drizzle-orm";
import { db } from "../../src/db/client.js";
import { ledgers, type LedgerAccountType } from "../../src/db/schema.js";
import {
  NORMAL_DEBIT_ACCOUNT_TYPES,
  postBalancedVoucher
} from "../../src/accounts/posting.js";

describe("Accounting posting: normal-balance-aware balance deltas", () => {
  function createLedger(accountName: string, accountType: LedgerAccountType, initialBalancePaise = 0) {
    return db
      .insert(ledgers)
      .values({
        account_name: accountName,
        account_type: accountType as never,
        balance_paise: initialBalancePaise
      })
      .returning()
      .get();
  }

  function readBalancePaise(ledgerId: number): number {
    const row = db.select().from(ledgers).where(eq(ledgers.id, ledgerId)).get();
    if (!row) {
      throw new Error(`Ledger ${ledgerId} not found`);
    }
    return row.balance_paise;
  }

  function postSale(salesLedgerId: number, salesLedgerName: string, cashLedgerName: string, amountPaise: number) {
    db.transaction((tx) => {
      postBalancedVoucher(tx, {
        voucherType: "SALE",
        referenceType: "TEST_SALE",
        referenceId: null,
        narration: `Sale of ${amountPaise / 100} rupees`,
        lines: [
          {
            ledgerName: cashLedgerName,
            accountType: "CASH",
            transactionType: "DEBIT",
            amountPaise
          },
          {
            ledgerName: salesLedgerName,
            accountType: "SALES_REVENUE",
            transactionType: "CREDIT",
            amountPaise
          }
        ]
      });
    });
    void salesLedgerId;
  }

  it("credits increase SALES_REVENUE balance and debits decrease it (normal-credit account)", () => {
    const salesLedger = createLedger("Sales Revenue A/C", "SALES_REVENUE");
    const cashLedger = createLedger("Sales Counterparty Cash", "CASH");
    expect(readBalancePaise(salesLedger.id)).toBe(0);
    expect(readBalancePaise(cashLedger.id)).toBe(0);

    // Post 1: CREDIT Sales ₹10,000 / DEBIT Cash ₹10,000
    db.transaction((tx) => {
      postBalancedVoucher(tx, {
        voucherType: "SALE",
        referenceType: "TEST_SALE",
        referenceId: null,
        narration: "Sale of 10000 rupees",
        lines: [
          { ledgerName: "Sales Counterparty Cash", accountType: "CASH", transactionType: "DEBIT", amountPaise: 1000000 },
          { ledgerName: "Sales Revenue A/C", accountType: "SALES_REVENUE", transactionType: "CREDIT", amountPaise: 1000000 }
        ]
      });
    });
    expect(readBalancePaise(salesLedger.id)).toBe(1000000);
    expect(readBalancePaise(cashLedger.id)).toBe(1000000);

    // Post 2: CREDIT Sales ₹5,000 / DEBIT Cash ₹5,000
    db.transaction((tx) => {
      postBalancedVoucher(tx, {
        voucherType: "SALE",
        referenceType: "TEST_SALE",
        referenceId: null,
        narration: "Sale of 5000 rupees",
        lines: [
          { ledgerName: "Sales Counterparty Cash", accountType: "CASH", transactionType: "DEBIT", amountPaise: 500000 },
          { ledgerName: "Sales Revenue A/C", accountType: "SALES_REVENUE", transactionType: "CREDIT", amountPaise: 500000 }
        ]
      });
    });
    expect(readBalancePaise(salesLedger.id)).toBe(1500000);
    expect(readBalancePaise(cashLedger.id)).toBe(1500000);

    // Post 3: DEBIT Sales ₹2,000 (refund) / CREDIT Cash ₹2,000
    db.transaction((tx) => {
      postBalancedVoucher(tx, {
        voucherType: "SALES_RETURN",
        referenceType: "TEST_REFUND",
        referenceId: null,
        narration: "Refund of 2000 rupees",
        lines: [
          { ledgerName: "Sales Counterparty Cash", accountType: "CASH", transactionType: "CREDIT", amountPaise: 200000 },
          { ledgerName: "Sales Revenue A/C", accountType: "SALES_REVENUE", transactionType: "DEBIT", amountPaise: 200000 }
        ]
      });
    });
    expect(readBalancePaise(salesLedger.id)).toBe(1300000);
    expect(readBalancePaise(cashLedger.id)).toBe(1300000);

    // postSale helper should be a no-op for the unused id parameter; this is just a smoke test
    postSale(salesLedger.id, "Sales Revenue A/C", "Sales Counterparty Cash", 1);
  });

  it("preserves backward-compatible CASH and BANK behavior (normal-debit accounts)", () => {
    const cashLedger = createLedger("Cash Backward Compat", "CASH");
    const bankLedger = createLedger("Bank Backward Compat", "BANK");

    // Cash deposit into bank: DEBIT Bank ₹7,500 / CREDIT Cash ₹7,500
    db.transaction((tx) => {
      postBalancedVoucher(tx, {
        voucherType: "CONTRA",
        referenceType: "TEST_CONTRA",
        referenceId: null,
        lines: [
          { ledgerName: "Bank Backward Compat", accountType: "BANK", transactionType: "DEBIT", amountPaise: 750000 },
          { ledgerName: "Cash Backward Compat", accountType: "CASH", transactionType: "CREDIT", amountPaise: 750000 }
        ]
      });
    });

    // Both are normal-debit accounts: DEBIT increases, CREDIT decreases
    expect(readBalancePaise(cashLedger.id)).toBe(-750000);
    expect(readBalancePaise(bankLedger.id)).toBe(750000);
  });

  it("classifies account types correctly via NORMAL_DEBIT_ACCOUNT_TYPES", () => {
    // Normal-debit (asset/expense) accounts
    expect(NORMAL_DEBIT_ACCOUNT_TYPES.has("CUSTOMER_UDHARI")).toBe(true);
    expect(NORMAL_DEBIT_ACCOUNT_TYPES.has("CASH")).toBe(true);
    expect(NORMAL_DEBIT_ACCOUNT_TYPES.has("BANK")).toBe(true);
    expect(NORMAL_DEBIT_ACCOUNT_TYPES.has("VENDOR")).toBe(true);
    expect(NORMAL_DEBIT_ACCOUNT_TYPES.has("PURCHASE_EXPENSE")).toBe(true);

    // Normal-credit (liability/revenue) accounts
    expect(NORMAL_DEBIT_ACCOUNT_TYPES.has("SALES_REVENUE")).toBe(false);
    expect(NORMAL_DEBIT_ACCOUNT_TYPES.has("GSS_LIABILITY")).toBe(false);
    expect(NORMAL_DEBIT_ACCOUNT_TYPES.has("TAX")).toBe(false);
  });

  // TEST 1 — Revenue ledger balance correctness across a credit/debit sequence.
  // SALES_REVENUE is a normal-credit account, so credits raise the balance and a
  // debit (refund) lowers it. The running balance must stay non-negative
  // throughout (3 credits 10k+25k+30k = 65k, then a 5k refund = 60k).
  it("keeps a SALES_REVENUE ledger balance correct and non-negative through credits and a refund", () => {
    const sales = createLedger("Revenue Correctness A/C", "SALES_REVENUE");
    const cash = createLedger("Revenue Counterparty Cash", "CASH");

    expect(readBalancePaise(sales.id)).toBe(0);
    expect(readBalancePaise(sales.id)).toBeGreaterThanOrEqual(0);

    // Each revenue posting credits SALES_REVENUE against a cash debit (balanced).
    const credit = (amountPaise: number) =>
      db.transaction((tx) => {
        postBalancedVoucher(tx, {
          voucherType: "SALE",
          referenceType: "TEST_REVENUE",
          referenceId: null,
          lines: [
            { ledgerName: "Revenue Counterparty Cash", accountType: "CASH", transactionType: "DEBIT", amountPaise },
            { ledgerName: "Revenue Correctness A/C", accountType: "SALES_REVENUE", transactionType: "CREDIT", amountPaise }
          ]
        });
      });

    credit(1000000); // +₹10,000
    expect(readBalancePaise(sales.id)).toBe(1000000);
    expect(readBalancePaise(sales.id)).toBeGreaterThanOrEqual(0);

    credit(2500000); // +₹25,000
    expect(readBalancePaise(sales.id)).toBe(3500000);
    expect(readBalancePaise(sales.id)).toBeGreaterThanOrEqual(0);

    credit(3000000); // +₹30,000
    expect(readBalancePaise(sales.id)).toBe(6500000); // = +₹65,000
    expect(readBalancePaise(sales.id)).toBeGreaterThanOrEqual(0);

    // Refund: DEBIT SALES_REVENUE ₹5,000 against a cash credit.
    db.transaction((tx) => {
      postBalancedVoucher(tx, {
        voucherType: "SALES_RETURN",
        referenceType: "TEST_REFUND",
        referenceId: null,
        lines: [
          { ledgerName: "Revenue Counterparty Cash", accountType: "CASH", transactionType: "CREDIT", amountPaise: 500000 },
          { ledgerName: "Revenue Correctness A/C", accountType: "SALES_REVENUE", transactionType: "DEBIT", amountPaise: 500000 }
        ]
      });
    });

    expect(readBalancePaise(sales.id)).toBe(6000000); // = +₹60,000
    expect(readBalancePaise(sales.id)).toBeGreaterThanOrEqual(0);
  });
});
