import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { customers, journalEntries, ledgers, type JournalTransactionType } from "../db/schema.js";
import { paiseToRupees } from "../utils/decimal.js";
import { postBalancedVoucher } from "./posting.js";
import { syncVoucherToTally } from "../utils/tallySync.js";
import { isGstPeriodLocked } from "../compliance/auditLocks.js";

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

accountsRouter.get("/ledgers", requireAdmin, (_request, response) => {
  const rows = db.select().from(ledgers).all();

  return response.json({
    ledgers: rows.map((ledger) => ({
      ...ledger,
      balance_rupees: paiseToRupees(ledger.balance_paise)
    }))
  });
});

accountsRouter.get("/daybook", requireAdmin, (request, response) => {
  const dateRange = getDateRange(typeof request.query.date === "string" ? request.query.date : undefined);
  const cashBankLedgers = db
    .select()
    .from(ledgers)
    .where(inArray(ledgers.account_type, ["CASH", "BANK"]))
    .all();
  const ledgerIds = cashBankLedgers.map((ledger) => ledger.id);

  if (ledgerIds.length === 0) {
    return response.json(createDaybookResponse(dateRange.date, 0, [], []));
  }

  const priorEntries = db
    .select()
    .from(journalEntries)
    .where(and(inArray(journalEntries.ledger_id, ledgerIds), lt(journalEntries.created_at, dateRange.start)))
    .all();
  const dayEntries = db
    .select()
    .from(journalEntries)
    .where(
      and(
        inArray(journalEntries.ledger_id, ledgerIds),
        sql`${journalEntries.created_at} >= ${dateRange.start}`,
        lt(journalEntries.created_at, dateRange.end)
      )
    )
    .all();

  return response.json(createDaybookResponse(dateRange.date, calculateEntryNetPaise(priorEntries), dayEntries, cashBankLedgers));
});

accountsRouter.get("/udhari", requireAdmin, (_request, response) => {
  const rows = db
    .select({
      ledger_id: ledgers.id,
      customer_id: customers.id,
      customer_name: customers.name,
      phone: customers.phone,
      balance_paise: ledgers.balance_paise
    })
    .from(ledgers)
    .leftJoin(customers, eq(ledgers.entity_id, customers.id))
    .where(and(eq(ledgers.account_type, "CUSTOMER_UDHARI"), gt(ledgers.balance_paise, 0)))
    .all();

  return response.json({
    udhari: rows.map((row) => {
      const lastEntry = db.query.journalEntries.findFirst({
        where: eq(journalEntries.ledger_id, row.ledger_id),
        orderBy: desc(journalEntries.created_at)
      }).sync();

      return {
        ...row,
        last_transaction_date: lastEntry?.created_at ?? null,
        outstanding_rupees: paiseToRupees(row.balance_paise)
      };
    })
  });
});

accountsRouter.post("/vouchers", requireAdmin, (request, response) => {
  const validation = validateVoucherPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  // Enforce GST audit locks against the voucher's EFFECTIVE date (createdAt may be
  // back-dated), not today — otherwise a back-dated entry could post into a frozen period.
  const effectiveDate = (validation.voucher.createdAt ?? new Date().toISOString()).slice(0, 10);
  if (isGstPeriodLocked(db, effectiveDate)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  const debitLedger = db.query.ledgers.findFirst({
    where: eq(ledgers.id, validation.voucher.debitLedgerId)
  }).sync();
  const creditLedger = db.query.ledgers.findFirst({
    where: eq(ledgers.id, validation.voucher.creditLedgerId)
  }).sync();

  if (!debitLedger || !creditLedger) {
    return response.status(404).json({ errors: ["Debit or credit ledger not found."] });
  }

  const createdVoucher = db.transaction((tx) => {
    let refId = validation.voucher.referenceId;
    if (validation.voucher.referenceType === "MANUAL" && refId === null) {
      const maxEntry = tx
        .select({ maxId: sql`max(${journalEntries.reference_id})` })
        .from(journalEntries)
        .where(eq(journalEntries.reference_type, "MANUAL"))
        .get();
      refId = (maxEntry?.maxId ? Number(maxEntry.maxId) : 0) + 1;
    }

    return postBalancedVoucher(tx, {
      voucherType: "MANUAL",
      referenceType: validation.voucher.referenceType,
      referenceId: refId,
      narration: validation.voucher.description,
      createdAt: validation.voucher.createdAt,
      lines: [
        {
          ledgerName: debitLedger.account_name,
          accountType: debitLedger.account_type,
          entityId: debitLedger.entity_id,
          transactionType: "DEBIT",
          amountPaise: validation.voucher.amountPaise,
          description: validation.voucher.description
        },
        {
          ledgerName: creditLedger.account_name,
          accountType: creditLedger.account_type,
          entityId: creditLedger.entity_id,
          transactionType: "CREDIT",
          amountPaise: validation.voucher.amountPaise,
          description: validation.voucher.description
        }
      ]
    });
  });

  // Asynchronously synchronize manual voucher with Tally Gateway
  void syncVoucherToTally(createdVoucher.voucher.id);

  return response.status(201).json({
    voucher: createdVoucher.voucher,
    journal_entries: createdVoucher.lines.map((line) => ({
      ...line.journalEntry,
      amount_rupees: paiseToRupees(line.journalEntry.amount_paise)
    }))
  });
});

accountsRouter.get("/ledger-report", requireAdmin, (request, response) => {
  const ledgerIdStr = request.query.ledger_id;
  if (typeof ledgerIdStr !== "string") {
    return response.status(400).json({ errors: ["ledger_id query parameter is required."] });
  }
  const ledgerId = parseInt(ledgerIdStr, 10);
  if (isNaN(ledgerId)) {
    return response.status(400).json({ errors: ["ledger_id must be an integer."] });
  }

  const ledger = db.query.ledgers.findFirst({
    where: eq(ledgers.id, ledgerId)
  }).sync();

  if (!ledger) {
    return response.status(404).json({ errors: ["Ledger not found."] });
  }

  const fromVal = typeof request.query.from_date === "string" ? request.query.from_date : undefined;
  const toVal = typeof request.query.to_date === "string" ? request.query.to_date : undefined;
  const dateRange = parseDateRange(fromVal, toVal);

  const priorDebits = db
    .select({ total: sql`sum(${journalEntries.amount_paise})` })
    .from(journalEntries)
    .where(and(
      eq(journalEntries.ledger_id, ledgerId),
      eq(journalEntries.transaction_type, "DEBIT"),
      lt(journalEntries.created_at, dateRange.start)
    ))
    .get();
  const priorCredits = db
    .select({ total: sql`sum(${journalEntries.amount_paise})` })
    .from(journalEntries)
    .where(and(
      eq(journalEntries.ledger_id, ledgerId),
      eq(journalEntries.transaction_type, "CREDIT"),
      lt(journalEntries.created_at, dateRange.start)
    ))
    .get();

  const totalPriorDebits = Number(priorDebits?.total || 0);
  const totalPriorCredits = Number(priorCredits?.total || 0);
  const openingBalancePaise = totalPriorDebits - totalPriorCredits;

  const entries = db
    .select()
    .from(journalEntries)
    .where(and(
      eq(journalEntries.ledger_id, ledgerId),
      sql`${journalEntries.created_at} >= ${dateRange.start}`,
      lt(journalEntries.created_at, dateRange.end)
    ))
    .orderBy(journalEntries.created_at, journalEntries.id)
    .all();

  let runningBalance = openingBalancePaise;
  let totalDebitsPaise = 0;
  let totalCreditsPaise = 0;

  const entriesWithRunningBalance = entries.map((entry) => {
    if (entry.transaction_type === "DEBIT") {
      runningBalance += entry.amount_paise;
      totalDebitsPaise += entry.amount_paise;
    } else {
      runningBalance -= entry.amount_paise;
      totalCreditsPaise += entry.amount_paise;
    }

    let counterparts: string[] = [];
    if (entry.reference_id !== null) {
      const mates = db
        .select({ ledgerName: ledgers.account_name })
        .from(journalEntries)
        .leftJoin(ledgers, eq(journalEntries.ledger_id, ledgers.id))
        .where(
          and(
            eq(journalEntries.reference_type, entry.reference_type),
            eq(journalEntries.reference_id, entry.reference_id),
            eq(journalEntries.transaction_type, entry.transaction_type === "DEBIT" ? "CREDIT" : "DEBIT")
          )
        )
        .all();
      counterparts = mates.map(m => m.ledgerName).filter((name): name is string => name !== null);
    }

    return {
      ...entry,
      amount_rupees: paiseToRupees(entry.amount_paise),
      running_balance_paise: runningBalance,
      running_balance_rupees: paiseToRupees(runningBalance),
      particulars: counterparts.length > 0 ? counterparts.join(", ") : "-"
    };
  });

  const closingBalancePaise = openingBalancePaise + totalDebitsPaise - totalCreditsPaise;

  return response.json({
    ledger: {
      ...ledger,
      balance_rupees: paiseToRupees(ledger.balance_paise)
    },
    date_range: {
      from: dateRange.fromDate,
      to: dateRange.toDate
    },
    opening_balance_paise: openingBalancePaise,
    opening_balance_rupees: paiseToRupees(openingBalancePaise),
    total_debits_paise: totalDebitsPaise,
    total_debits_rupees: paiseToRupees(totalDebitsPaise),
    total_credits_paise: totalCreditsPaise,
    total_credits_rupees: paiseToRupees(totalCreditsPaise),
    closing_balance_paise: closingBalancePaise,
    closing_balance_rupees: paiseToRupees(closingBalancePaise),
    entries: entriesWithRunningBalance
  });
});

accountsRouter.get("/export/tally", requireAdmin, (request, response) => {
  const from = typeof request.query.from === "string" ? request.query.from : undefined;
  const to = typeof request.query.to === "string" ? request.query.to : undefined;
  const dateRange = getDateRange(from);
  const end = to ? getDateRange(to).end : dateRange.end;
  const rows = db
    .select({
      id: journalEntries.id,
      ledger_id: journalEntries.ledger_id,
      ledger_name: ledgers.account_name,
      ledger_type: ledgers.account_type,
      transaction_type: journalEntries.transaction_type,
      amount_paise: journalEntries.amount_paise,
      reference_type: journalEntries.reference_type,
      reference_id: journalEntries.reference_id,
      description: journalEntries.description,
      created_at: journalEntries.created_at
    })
    .from(journalEntries)
    .leftJoin(ledgers, eq(journalEntries.ledger_id, ledgers.id))
    .where(and(sql`${journalEntries.created_at} >= ${dateRange.start}`, lt(journalEntries.created_at, end)))
    .all();

  return response.json({
    export_type: "TALLY_VOUCHER_JSON_STUB",
    date_range: {
      from: dateRange.start,
      to: end
    },
    vouchers: rows.map((row) => ({
      voucher_id: row.id,
      voucher_date: row.created_at,
      reference: {
        type: row.reference_type,
        id: row.reference_id
      },
      ledger: {
        id: row.ledger_id,
        name: row.ledger_name,
        type: row.ledger_type
      },
      entry_type: row.transaction_type,
      amount_paise: row.amount_paise,
      amount_rupees: paiseToRupees(row.amount_paise),
      narration: row.description
    }))
  });
});

function createDaybookResponse(
  date: string,
  openingBalancePaise: number,
  dayEntries: Array<typeof journalEntries.$inferSelect>,
  cashBankLedgers: Array<typeof ledgers.$inferSelect>
) {
  const totalReceiptsPaise = dayEntries
    .filter((entry) => entry.transaction_type === "DEBIT")
    .reduce((total, entry) => total + entry.amount_paise, 0);
  const totalPaymentsPaise = dayEntries
    .filter((entry) => entry.transaction_type === "CREDIT")
    .reduce((total, entry) => total + entry.amount_paise, 0);
  const closingBalancePaise = openingBalancePaise + totalReceiptsPaise - totalPaymentsPaise;
  const ledgerById = new Map(cashBankLedgers.map((ledger) => [ledger.id, ledger]));

  return {
    date,
    opening_balance_paise: openingBalancePaise,
    opening_balance_rupees: paiseToRupees(openingBalancePaise),
    total_receipts_paise: totalReceiptsPaise,
    total_receipts_rupees: paiseToRupees(totalReceiptsPaise),
    total_payments_paise: totalPaymentsPaise,
    total_payments_rupees: paiseToRupees(totalPaymentsPaise),
    closing_balance_paise: closingBalancePaise,
    closing_balance_rupees: paiseToRupees(closingBalancePaise),
    entries: dayEntries.map((entry) => ({
      ...entry,
      ledger_name: ledgerById.get(entry.ledger_id)?.account_name ?? null,
      amount_rupees: paiseToRupees(entry.amount_paise)
    }))
  };
}

function calculateEntryNetPaise(entries: Array<typeof journalEntries.$inferSelect>) {
  return entries.reduce((total, entry) => total + getBalanceDeltaPaise(entry.transaction_type, entry.amount_paise), 0);
}

function getBalanceDeltaPaise(transactionType: JournalTransactionType, amountPaise: number) {
  return transactionType === "DEBIT" ? amountPaise : -amountPaise;
}

type VoucherValidation =
  | {
      ok: true;
      voucher: {
        debitLedgerId: number;
        creditLedgerId: number;
        amountPaise: number;
        referenceType: string;
        referenceId: number | null;
        description: string | null;
        createdAt: string | null;
      };
    }
  | { ok: false; errors: string[] };

function validateVoucherPayload(body: unknown): VoucherValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const debitLedgerId = body.debit_ledger_id;
  const creditLedgerId = body.credit_ledger_id;
  const amountPaise = body.amount_paise;
  const referenceType = typeof body.reference_type === "string" && body.reference_type.trim()
    ? body.reference_type.trim()
    : "MANUAL";
  const referenceId = body.reference_id === undefined || body.reference_id === null ? null : body.reference_id;
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;

  const rawCreatedAt = body.created_at;
  let createdAt: string | null = null;
  if (typeof rawCreatedAt === "string" && rawCreatedAt.trim()) {
    const trimmed = rawCreatedAt.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const nowTime = new Date().toTimeString().slice(0, 8);
      createdAt = `${trimmed} ${nowTime}`;
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      createdAt = trimmed;
    } else {
      errors.push("created_at must be in YYYY-MM-DD or YYYY-MM-DD HH:mm:ss format.");
    }
  }

  if (!Number.isInteger(debitLedgerId)) {
    errors.push("debit_ledger_id must be an integer.");
  }

  if (!Number.isInteger(creditLedgerId)) {
    errors.push("credit_ledger_id must be an integer.");
  }

  if (debitLedgerId === creditLedgerId) {
    errors.push("debit_ledger_id and credit_ledger_id must be different.");
  }

  if (typeof amountPaise !== "number" || !Number.isInteger(amountPaise) || amountPaise <= 0) {
    errors.push("amount_paise must be a positive integer.");
  }

  if (referenceId !== null && !Number.isInteger(referenceId)) {
    errors.push("reference_id must be an integer when provided.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    voucher: {
      debitLedgerId: debitLedgerId as number,
      creditLedgerId: creditLedgerId as number,
      amountPaise: amountPaise as number,
      referenceType,
      referenceId: referenceId as number | null,
      description,
      createdAt
    }
  };
}

function getDateRange(dateValue: string | undefined) {
  const date = dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : new Date().toISOString().slice(0, 10);
  const start = `${date} 00:00:00`;
  const nextDate = new Date(`${date}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const end = `${nextDate.toISOString().slice(0, 10)} 00:00:00`;

  return { date, start, end };
}

function parseDateRange(fromVal?: string, toVal?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = fromVal && /^\d{4}-\d{2}-\d{2}$/.test(fromVal) ? fromVal : today;
  const toDate = toVal && /^\d{4}-\d{2}-\d{2}$/.test(toVal) ? toVal : today;

  const start = `${fromDate} 00:00:00`;
  const nextDate = new Date(`${toDate}T00:00:00.000Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const end = `${nextDate.toISOString().slice(0, 10)} 00:00:00`;

  return { fromDate, toDate, start, end };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
