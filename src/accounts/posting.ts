import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  journalEntries,
  ledgers,
  voucherHeaders,
  voucherLines,
  type JournalTransactionType,
  type LedgerAccountType
} from "../db/schema.js";

export const NORMAL_DEBIT_ACCOUNT_TYPES = new Set<LedgerAccountType>([
  "CUSTOMER_UDHARI",
  "CASH",
  "BANK",
  "VENDOR",
  "STOCK",
  "EXPENSE",
  "PURCHASE_EXPENSE"
]);

type PostingTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type VoucherPostingLine = {
  ledgerName: string;
  accountType: LedgerAccountType;
  entityId?: number | null;
  transactionType: JournalTransactionType;
  amountPaise: number;
  description?: string | null;
};

export type VoucherPostingInput = {
  voucherType: string;
  referenceType: string;
  referenceId: number | null;
  narration?: string | null;
  createdBy?: number | null;
  createdAt?: string | null;
  lines: VoucherPostingLine[];
};

export function postBalancedVoucher(tx: PostingTx, input: VoucherPostingInput) {
  const normalizedLines = input.lines.filter((line) => line.amountPaise > 0);
  const totalDebitPaise = normalizedLines
    .filter((line) => line.transactionType === "DEBIT")
    .reduce((total, line) => total + line.amountPaise, 0);
  const totalCreditPaise = normalizedLines
    .filter((line) => line.transactionType === "CREDIT")
    .reduce((total, line) => total + line.amountPaise, 0);

  if (normalizedLines.length < 2) {
    throw new VoucherPostingError("A voucher must have at least two non-zero lines.");
  }

  if (totalDebitPaise !== totalCreditPaise) {
    throw new VoucherPostingError("Voucher debits and credits must be equal.");
  }

  const voucher = tx
    .insert(voucherHeaders)
    .values({
      voucher_number: generateVoucherNumber(input.voucherType),
      voucher_type: input.voucherType,
      reference_type: input.referenceType,
      reference_id: input.referenceId,
      narration: input.narration ?? null,
      total_debit_paise: totalDebitPaise,
      total_credit_paise: totalCreditPaise,
      created_by: input.createdBy ?? null,
      ...(input.createdAt ? { created_at: input.createdAt } : {})
    })
    .returning()
    .get();

  const postedLines = normalizedLines.map((line) => {
    const ledger = getOrCreateLedger(tx, line.ledgerName, line.accountType, line.entityId ?? null);
    const journalEntry = tx
      .insert(journalEntries)
      .values({
        ledger_id: ledger.id,
        transaction_type: line.transactionType,
        amount_paise: line.amountPaise,
        reference_type: input.referenceType,
        reference_id: input.referenceId,
        description: line.description ?? input.narration ?? null,
        ...(input.createdAt ? { created_at: input.createdAt } : {})
      })
      .returning()
      .get();

    tx.update(ledgers)
      .set({
        balance_paise: ledger.balance_paise + getBalanceDeltaPaise(line.transactionType, line.amountPaise, ledger.account_type)
      })
      .where(eq(ledgers.id, ledger.id))
      .run();

    const voucherLine = tx
      .insert(voucherLines)
      .values({
        voucher_id: voucher.id,
        ledger_id: ledger.id,
        transaction_type: line.transactionType,
        amount_paise: line.amountPaise,
        description: line.description ?? null,
        journal_entry_id: journalEntry.id
      })
      .returning()
      .get();

    return {
      ledger,
      journalEntry,
      voucherLine
    };
  });

  return {
    voucher,
    lines: postedLines
  };
}

export function getOrCreateLedger(tx: PostingTx, accountName: string, accountType: LedgerAccountType, entityId: number | null) {
  // Entity-scoped ledgers (e.g. CUSTOMER_UDHARI, VENDOR) are unique per (account_type, entity_id) —
  // match on those alone, ignoring account_name. Different callers name the same customer's udhari
  // ledger differently ("Udhari - <name>" vs "Customer Udhari <id>"), and keying on the name too
  // would create a second ledger for the same customer. Non-entity ledgers still match by name.
  const existingLedger = entityId === null
    ? tx.select().from(ledgers).where(and(eq(ledgers.account_name, accountName), eq(ledgers.account_type, accountType as never))).get()
    : tx.select().from(ledgers).where(and(eq(ledgers.account_type, accountType as never), eq(ledgers.entity_id, entityId))).get();

  if (existingLedger) {
    return existingLedger;
  }

  return tx
    .insert(ledgers)
    .values({
      account_name: accountName,
      account_type: accountType as never,
      entity_id: entityId,
      balance_paise: 0
    })
    .returning()
    .get();
}

function getBalanceDeltaPaise(transactionType: JournalTransactionType, amountPaise: number, accountType: LedgerAccountType) {
  if (NORMAL_DEBIT_ACCOUNT_TYPES.has(accountType)) {
    return transactionType === "DEBIT" ? amountPaise : -amountPaise;
  } else {
    return transactionType === "CREDIT" ? amountPaise : -amountPaise;
  }
}

function generateVoucherNumber(voucherType: string) {
  const normalizedType = voucherType.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "VOUCHER";
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  const timePart = `${now.getTime()}`.slice(-8);
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, "0");

  return `${normalizedType}-${datePart}-${timePart}${randomPart}`;
}

export class VoucherPostingError extends Error {}
