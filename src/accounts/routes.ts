import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { customers, expenses, journalEntries, ledgers, organizationSettings, voucherHeaders, voucherLines, type JournalTransactionType } from "../db/schema.js";
import { paiseToRupees } from "../utils/decimal.js";
import { postBalancedVoucher, NORMAL_DEBIT_ACCOUNT_TYPES } from "./posting.js";
import { triggerMessage, getWhatsAppLink } from "../utils/messageService.js";
import { syncVoucherToTally } from "../utils/tallySync.js";
import { isGstPeriodLocked } from "../compliance/auditLocks.js";
import { logAction } from "../audit/logAction.js";

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

// Record a shop expense: DEBIT an EXPENSE ledger, CREDIT Cash/Bank. Feeds the Day Book.
accountsRouter.post("/expenses", requireAdmin, (request, response) => {
  const body = isRecord(request.body) ? request.body : {};
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  const amountPaise = body.amount_paise;
  const paymentMode = (typeof body.payment_mode === "string" ? body.payment_mode.trim().toUpperCase() : "CASH") === "BANK" ? "BANK" : "CASH";
  const expenseDate = typeof body.expense_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expense_date)
    ? body.expense_date
    : new Date().toISOString().slice(0, 10);

  const errors: string[] = [];
  if (!category) errors.push("category is required.");
  if (!Number.isInteger(amountPaise) || (amountPaise as number) <= 0) errors.push("amount_paise must be a positive integer.");
  if (errors.length > 0) return response.status(400).json({ errors });

  if (isGstPeriodLocked(db, expenseDate)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  const amount = amountPaise as number;
  const userId = (request as AuthenticatedRequest).user.id;

  const result = db.transaction((tx) => {
    const voucher = postBalancedVoucher(tx, {
      voucherType: "EXPENSE",
      referenceType: "EXPENSE",
      referenceId: 0,
      narration: `Expense ${category}`,
      createdBy: userId,
      lines: [
        { ledgerName: `Expense - ${category}`, accountType: "EXPENSE", transactionType: "DEBIT", amountPaise: amount, description: description ?? category },
        { ledgerName: paymentMode === "CASH" ? "Cash" : "Bank", accountType: paymentMode, transactionType: "CREDIT", amountPaise: amount, description: `Expense paid via ${paymentMode}` }
      ]
    });

    const expense = tx.insert(expenses).values({
      expense_date: expenseDate,
      category,
      description,
      amount_paise: amount,
      payment_mode: paymentMode,
      voucher_id: voucher.voucher.id,
      created_by: userId
    }).returning().get();

    return { expense, voucher: voucher.voucher };
  });

  return response.status(201).json(result);
});

accountsRouter.get("/expenses", requireAdmin, (request, response) => {
  const date = typeof request.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(request.query.date)
    ? request.query.date
    : new Date().toISOString().slice(0, 10);
  const rows = db.select().from(expenses).where(eq(expenses.expense_date, date)).all();
  const totalPaise = rows.reduce((sum, row) => sum + row.amount_paise, 0);
  const cashTotalPaise = rows.filter((row) => row.payment_mode === "CASH").reduce((sum, row) => sum + row.amount_paise, 0);

  return response.json({
    date,
    expenses: rows.map((row) => ({ ...row, amount_rupees: paiseToRupees(row.amount_paise) })),
    total_paise: totalPaise,
    cash_total_paise: cashTotalPaise,
    bank_total_paise: totalPaise - cashTotalPaise
  });
});

// Formal accounting: Profit & Loss (date range), Balance Sheet & Trial Balance (as-of end date).
accountsRouter.get("/financials", requireAdmin, (request, response) => {
  const today = new Date().toISOString().slice(0, 10);
  const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const to = isDate(request.query.to) ? request.query.to : today;
  const from = isDate(request.query.from) ? request.query.from : `${to.slice(0, 4)}-04-01`; // FY start default
  const start = `${from} 00:00:00`;
  const end = `${to} 23:59:59`;

  const allLedgers = db.select().from(ledgers).all();

  // Per-ledger debit/credit sums for a date bound.
  const sumsByLedger = (bound: ReturnType<typeof sql>) => {
    const rows = db
      .select({
        ledger_id: journalEntries.ledger_id,
        debit: sql<number>`COALESCE(SUM(CASE WHEN ${journalEntries.transaction_type} = 'DEBIT' THEN ${journalEntries.amount_paise} ELSE 0 END), 0)`,
        credit: sql<number>`COALESCE(SUM(CASE WHEN ${journalEntries.transaction_type} = 'CREDIT' THEN ${journalEntries.amount_paise} ELSE 0 END), 0)`
      })
      .from(journalEntries)
      .where(bound)
      .groupBy(journalEntries.ledger_id)
      .all();
    const map = new Map<number, { debit: number; credit: number }>();
    for (const row of rows) map.set(Number(row.ledger_id), { debit: Number(row.debit), credit: Number(row.credit) });
    return map;
  };

  const rangeMap = sumsByLedger(sql`${journalEntries.created_at} >= ${start} AND ${journalEntries.created_at} <= ${end}`);
  const asOfMap = sumsByLedger(sql`${journalEntries.created_at} <= ${end}`);

  const normalBalance = (type: string, debit: number, credit: number) =>
    NORMAL_DEBIT_ACCOUNT_TYPES.has(type as never) ? debit - credit : credit - debit;

  // ── Profit & Loss (movement within the range) ──
  const incomeLines: { name: string; paise: number }[] = [];
  const expenseLines: { name: string; paise: number }[] = [];
  let incomePaise = 0;
  let expensePaise = 0;
  for (const ledger of allLedgers) {
    const m = rangeMap.get(ledger.id) ?? { debit: 0, credit: 0 };
    const nb = normalBalance(ledger.account_type, m.debit, m.credit);
    if (ledger.account_type === "SALES") {
      if (nb !== 0) incomeLines.push({ name: ledger.account_name, paise: nb });
      incomePaise += nb;
    } else if (ledger.account_type === "EXPENSE") {
      if (nb !== 0) expenseLines.push({ name: ledger.account_name, paise: nb });
      expensePaise += nb;
    }
  }
  const netProfitPaise = incomePaise - expensePaise;

  // ── Balance Sheet (cumulative as of end) + retained earnings ──
  const assets: { name: string; paise: number }[] = [];
  const liabilities: { name: string; paise: number }[] = [];
  let totalAssets = 0;
  let totalLiabilities = 0;
  let cumIncome = 0;
  let cumExpense = 0;
  for (const ledger of allLedgers) {
    const m = asOfMap.get(ledger.id) ?? { debit: 0, credit: 0 };
    const nb = normalBalance(ledger.account_type, m.debit, m.credit);
    switch (ledger.account_type) {
      case "CASH":
      case "BANK":
      case "STOCK":
        if (nb !== 0) { assets.push({ name: ledger.account_name, paise: nb }); totalAssets += nb; }
        break;
      case "CUSTOMER_UDHARI":
      case "VENDOR":
        // Debit-normal: positive = receivable (asset), negative = payable (liability).
        if (nb >= 0) { if (nb !== 0) { assets.push({ name: ledger.account_name, paise: nb }); totalAssets += nb; } }
        else { liabilities.push({ name: ledger.account_name, paise: -nb }); totalLiabilities += -nb; }
        break;
      case "TAX":
      case "GSS_LIABILITY":
        if (nb !== 0) { liabilities.push({ name: ledger.account_name, paise: nb }); totalLiabilities += nb; }
        break;
      case "SALES":
        cumIncome += nb;
        break;
      case "EXPENSE":
        cumExpense += nb;
        break;
    }
  }
  const retainedEarningsPaise = cumIncome - cumExpense; // equity from operations
  // Opening capital is the balancing figure (owner's funds / opening balances not posted via journal),
  // so the statement balances: Assets = Liabilities + Capital + Retained Earnings.
  const openingCapitalPaise = totalAssets - totalLiabilities - retainedEarningsPaise;
  const equityPaise = retainedEarningsPaise + openingCapitalPaise;
  const balancedDifferencePaise = totalAssets - (totalLiabilities + equityPaise); // always 0 by construction

  // ── Trial Balance (raw debit/credit per ledger as of end; columns must match) ──
  const trialRows: { name: string; account_type: string; debit_paise: number; credit_paise: number }[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const ledger of allLedgers) {
    const m = asOfMap.get(ledger.id) ?? { debit: 0, credit: 0 };
    const net = m.debit - m.credit;
    if (net === 0) continue;
    const debitPaise = net > 0 ? net : 0;
    const creditPaise = net < 0 ? -net : 0;
    trialRows.push({ name: ledger.account_name, account_type: ledger.account_type, debit_paise: debitPaise, credit_paise: creditPaise });
    totalDebit += debitPaise;
    totalCredit += creditPaise;
  }

  return response.json({
    from,
    to,
    pnl: {
      income_lines: incomeLines,
      expense_lines: expenseLines,
      income_paise: incomePaise,
      expense_paise: expensePaise,
      net_profit_paise: netProfitPaise
    },
    balance_sheet: {
      assets,
      liabilities,
      total_assets_paise: totalAssets,
      total_liabilities_paise: totalLiabilities,
      retained_earnings_paise: retainedEarningsPaise,
      opening_capital_paise: openingCapitalPaise,
      equity_paise: equityPaise,
      balanced_difference_paise: balancedDifferencePaise
    },
    trial_balance: {
      rows: trialRows,
      total_debit_paise: totalDebit,
      total_credit_paise: totalCredit,
      balanced: totalDebit === totalCredit
    }
  });
});

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
      entity_id: ledgers.entity_id,
      customer_name: customers.name,
      phone: customers.phone,
      balance_paise: ledgers.balance_paise
    })
    .from(ledgers)
    .leftJoin(customers, eq(ledgers.entity_id, customers.id))
    .where(eq(ledgers.account_type, "CUSTOMER_UDHARI"))
    .all();

  // Aggregate every udhari ledger by customer so each customer appears once and any
  // advance (credit balance) nets against their dues. Ledgers with no entity link
  // (legacy) stay as their own row.
  const byCustomer = aggregateUdhariByCustomer(rows);

  const udhari = byCustomer
    .filter((agg) => agg.balance_paise > 0)
    .map((agg) => {
      const lastEntry = db
        .select({ created_at: journalEntries.created_at })
        .from(journalEntries)
        .where(inArray(journalEntries.ledger_id, agg.ledger_ids))
        .orderBy(desc(journalEntries.created_at))
        .get();

      return {
        ledger_id: agg.primary_ledger_id,
        customer_id: agg.customer_id,
        customer_name: agg.customer_name,
        phone: agg.phone,
        balance_paise: agg.balance_paise,
        last_transaction_date: lastEntry?.created_at ?? null,
        outstanding_rupees: paiseToRupees(agg.balance_paise)
      };
    });

  return response.json({ udhari });
});

type UdhariRow = { ledger_id: number; entity_id: number | null; customer_name: string | null; phone: string | null; balance_paise: number };
type UdhariAgg = { ledger_ids: number[]; primary_ledger_id: number; customer_id: number | null; customer_name: string | null; phone: string | null; balance_paise: number };

// Collapse a customer's multiple CUSTOMER_UDHARI ledgers into one aggregate (netting
// dues against advances). Entity-less ledgers are kept separate (keyed by ledger id).
function aggregateUdhariByCustomer(rows: UdhariRow[]): UdhariAgg[] {
  const byKey = new Map<string, UdhariAgg>();
  for (const row of rows) {
    const key = row.entity_id !== null ? `c${row.entity_id}` : `l${row.ledger_id}`;
    const agg = byKey.get(key) ?? {
      ledger_ids: [],
      primary_ledger_id: row.ledger_id,
      customer_id: row.entity_id,
      customer_name: row.customer_name,
      phone: row.phone,
      balance_paise: 0
    };
    agg.ledger_ids.push(row.ledger_id);
    agg.balance_paise += row.balance_paise;
    byKey.set(key, agg);
  }
  return [...byKey.values()];
}

// Aged receivables: bucket each customer's outstanding udhari by the age of the unpaid amount.
// Uses FIFO allocation — payments (CREDIT) clear the oldest debits first, so the leftover debit
// lots carry their original dates and land in 0-30 / 31-60 / 61-90 / 90+ day buckets.
accountsRouter.get("/udhari/ageing", requireAdmin, (_request, response) => {
  const today = new Date();
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  const rows = db
    .select({
      ledger_id: ledgers.id,
      entity_id: ledgers.entity_id,
      customer_name: customers.name,
      phone: customers.phone,
      balance_paise: ledgers.balance_paise
    })
    .from(ledgers)
    .leftJoin(customers, eq(ledgers.entity_id, customers.id))
    .where(eq(ledgers.account_type, "CUSTOMER_UDHARI"))
    .all();

  // One aged row per customer: combine every udhari ledger (netting advances), then
  // run FIFO over the customer's entire entry timeline across those ledgers.
  const aggregates = aggregateUdhariByCustomer(rows).filter((agg) => agg.balance_paise > 0);

  const totals = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0, total: 0 };

  const customersOut = aggregates.map((row) => {
    const creditLimitPaise = row.customer_id !== null
      ? (db.select({ limit: customers.credit_limit_paise }).from(customers).where(eq(customers.id, row.customer_id)).get()?.limit ?? 0)
      : 0;
    const entries = db
      .select()
      .from(journalEntries)
      .where(inArray(journalEntries.ledger_id, row.ledger_ids))
      .orderBy(journalEntries.created_at)
      .all();

    // FIFO: debits create lots, credits consume the oldest open lots first.
    const lots: Array<{ date: string | null; remaining: number }> = [];
    for (const entry of entries) {
      if (entry.transaction_type === "DEBIT") {
        lots.push({ date: entry.created_at, remaining: entry.amount_paise });
      } else {
        let pay = entry.amount_paise;
        for (const lot of lots) {
          if (pay <= 0) break;
          const take = Math.min(lot.remaining, pay);
          lot.remaining -= take;
          pay -= take;
        }
      }
    }

    const buckets = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
    let oldestDays = 0;
    for (const lot of lots) {
      if (lot.remaining <= 0) continue;
      const lotMs = lot.date ? Date.parse(lot.date.slice(0, 10)) : todayMs;
      const ageDays = Math.max(0, Math.floor((todayMs - lotMs) / 86400000));
      oldestDays = Math.max(oldestDays, ageDays);
      if (ageDays <= 30) buckets.current += lot.remaining;
      else if (ageDays <= 60) buckets.days30 += lot.remaining;
      else if (ageDays <= 90) buckets.days60 += lot.remaining;
      else if (ageDays <= 120) buckets.days90 += lot.remaining;
      else buckets.over90 += lot.remaining;
    }

    // When FIFO can't fully explain the running balance (e.g. opening balances with no entries),
    // fall back to placing any unexplained remainder in the current bucket.
    const bucketSum = buckets.current + buckets.days30 + buckets.days60 + buckets.days90 + buckets.over90;
    if (bucketSum < row.balance_paise) {
      buckets.current += row.balance_paise - bucketSum;
    }

    totals.current += buckets.current;
    totals.days30 += buckets.days30;
    totals.days60 += buckets.days60;
    totals.days90 += buckets.days90;
    totals.over90 += buckets.over90;
    totals.total += row.balance_paise;

    const creditLimit = creditLimitPaise;
    return {
      ledger_id: row.primary_ledger_id,
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      phone: row.phone,
      balance_paise: row.balance_paise,
      balance_rupees: paiseToRupees(row.balance_paise),
      oldest_days: oldestDays,
      credit_limit_paise: creditLimit,
      credit_limit_rupees: paiseToRupees(creditLimit),
      over_limit: creditLimit > 0 && row.balance_paise > creditLimit,
      buckets: {
        current_paise: buckets.current,
        days_31_60_paise: buckets.days30,
        days_61_90_paise: buckets.days60,
        days_91_120_paise: buckets.days90,
        over_120_paise: buckets.over90,
        current_rupees: paiseToRupees(buckets.current),
        days_31_60_rupees: paiseToRupees(buckets.days30),
        days_61_90_rupees: paiseToRupees(buckets.days60),
        days_91_120_rupees: paiseToRupees(buckets.days90),
        over_120_rupees: paiseToRupees(buckets.over90)
      }
    };
  });

  // Heaviest / oldest first.
  customersOut.sort((a, b) => b.oldest_days - a.oldest_days || b.balance_paise - a.balance_paise);

  return response.json({
    customers: customersOut,
    totals: {
      current_rupees: paiseToRupees(totals.current),
      days_31_60_rupees: paiseToRupees(totals.days30),
      days_61_90_rupees: paiseToRupees(totals.days60),
      days_91_120_rupees: paiseToRupees(totals.days90),
      over_120_rupees: paiseToRupees(totals.over90),
      total_rupees: paiseToRupees(totals.total),
      over_limit_count: customersOut.filter((c) => c.over_limit).length
    }
  });
});

// Set/clear a customer's udhari credit limit (0 clears it).
accountsRouter.post("/customers/:customerId/credit-limit", requireAdmin, (request, response) => {
  const customerId = Number(request.params.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return response.status(400).json({ errors: ["customerId must be a positive integer."] });
  }
  const raw = (request.body ?? {}).credit_limit_paise;
  const limitPaise = Number(raw);
  if (!Number.isInteger(limitPaise) || limitPaise < 0) {
    return response.status(400).json({ errors: ["credit_limit_paise must be a non-negative integer."] });
  }

  const customer = db.query.customers.findFirst({ where: eq(customers.id, customerId) }).sync();
  if (!customer) {
    return response.status(404).json({ errors: ["Customer not found."] });
  }

  db.update(customers).set({ credit_limit_paise: limitPaise }).where(eq(customers.id, customerId)).run();
  const authUser = (request as AuthenticatedRequest).user;
  logAction(authUser.id, "SET_CREDIT_LIMIT", "customers", customerId, { credit_limit_paise: customer.credit_limit_paise }, { credit_limit_paise: limitPaise });

  return response.json({ customer_id: customerId, credit_limit_paise: limitPaise, credit_limit_rupees: paiseToRupees(limitPaise) });
});

accountsRouter.get("/receipts/customers", (request, response) => {
  const search = typeof request.query.search === "string" ? request.query.search.trim() : "";
  const searchPattern = `%${search}%`;

  const rows = db
    .select({
      customer_id: customers.id,
      customer_name: customers.name,
      phone: customers.phone,
      ledger_id: ledgers.id,
      balance_paise: sql<number>`COALESCE(${ledgers.balance_paise}, 0)`
    })
    .from(customers)
    .leftJoin(ledgers, and(eq(ledgers.entity_id, customers.id), eq(ledgers.account_type, "CUSTOMER_UDHARI")))
    .where(search ? sql`${customers.name} LIKE ${searchPattern} OR ${customers.phone} LIKE ${searchPattern}` : sql`1 = 1`)
    .limit(25)
    .all();

  return response.json({
    customers: rows.map((row) => ({
      ...row,
      balance_paise: Number(row.balance_paise ?? 0),
      balance_rupees: paiseToRupees(Number(row.balance_paise ?? 0))
    }))
  });
});

accountsRouter.get("/receipts/history/:customerId", (request, response) => {
  const customerId = Number(request.params.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return response.status(400).json({ errors: ["customerId must be a positive integer."] });
  }

  const rows = db
    .select({
      voucher_number: voucherHeaders.voucher_number,
      narration: voucherHeaders.narration,
      amount_paise: voucherHeaders.total_debit_paise,
      created_at: voucherHeaders.created_at
    })
    .from(voucherHeaders)
    .where(
      and(
        eq(voucherHeaders.reference_type, "UDHARI_RECEIPT"),
        eq(voucherHeaders.reference_id, customerId),
        eq(voucherHeaders.status, "POSTED")
      )
    )
    .orderBy(desc(voucherHeaders.created_at))
    .limit(10)
    .all();

  return response.json({
    history: rows.map((row) => ({
      ...row,
      amount_rupees: paiseToRupees(row.amount_paise)
    }))
  });
});

accountsRouter.post("/receipts/udhari", (request, response) => {
  const validation = validateUdhariReceiptPayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const effectiveDate = validation.receipt.receiptDate;
  if (isGstPeriodLocked(db, effectiveDate)) {
    return response.status(400).json({ errors: ["This transaction date falls within a locked GST audit period."] });
  }

  const customer = db.query.customers.findFirst({ where: eq(customers.id, validation.receipt.customerId) }).sync();
  if (!customer) {
    return response.status(404).json({ errors: ["Customer not found."] });
  }

  const existingLedger = db.query.ledgers.findFirst({
    where: and(eq(ledgers.entity_id, customer.id), eq(ledgers.account_type, "CUSTOMER_UDHARI"))
  }).sync();
  const currentBalancePaise = existingLedger?.balance_paise ?? 0;

  const userId = (request as AuthenticatedRequest).user.id;
  const cashBankLedgerName = validation.receipt.paymentMode === "CASH" ? "Cash" : "Bank";
  const cashBankAccountType = validation.receipt.paymentMode === "CASH" ? "CASH" : "BANK";
  const createdAt = `${validation.receipt.receiptDate} ${new Date().toTimeString().slice(0, 8)}`;
  const narration = validation.receipt.narration ?? `Udhari receipt from ${customer.name}`;

  const result = db.transaction((tx) => {
    const voucherResult = postBalancedVoucher(tx, {
      voucherType: "RECEIPT",
      referenceType: "UDHARI_RECEIPT",
      referenceId: customer.id,
      narration,
      createdBy: userId,
      createdAt,
      lines: [
        {
          ledgerName: cashBankLedgerName,
          accountType: cashBankAccountType,
          transactionType: "DEBIT",
          amountPaise: validation.receipt.amountPaise,
          description: `${validation.receipt.paymentMode} received from ${customer.name}`
        },
        {
          ledgerName: existingLedger?.account_name ?? `Udhari - ${customer.name}`,
          accountType: "CUSTOMER_UDHARI",
          entityId: customer.id,
          transactionType: "CREDIT",
          amountPaise: validation.receipt.amountPaise,
          description: narration
        }
      ]
    });

    const updatedLedger = tx.query.ledgers.findFirst({
      where: and(eq(ledgers.entity_id, customer.id), eq(ledgers.account_type, "CUSTOMER_UDHARI"))
    }).sync();

    return {
      voucher: voucherResult.voucher,
      customer,
      receipt: {
        receipt_number: voucherResult.voucher.voucher_number,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.phone,
        payment_mode: validation.receipt.paymentMode,
        amount_paise: validation.receipt.amountPaise,
        amount_rupees: paiseToRupees(validation.receipt.amountPaise),
        previous_balance_paise: currentBalancePaise,
        previous_balance_rupees: paiseToRupees(currentBalancePaise),
        balance_after_paise: updatedLedger?.balance_paise ?? currentBalancePaise - validation.receipt.amountPaise,
        balance_after_rupees: paiseToRupees(updatedLedger?.balance_paise ?? currentBalancePaise - validation.receipt.amountPaise),
        receipt_date: validation.receipt.receiptDate,
        narration
      },
      journal_entries: voucherResult.lines.map((line) => ({
        ...line.journalEntry,
        amount_rupees: paiseToRupees(line.journalEntry.amount_paise)
      }))
    };
  });

  void syncVoucherToTally(result.voucher.id);

  let whatsappLink: string | null = null;
  if (customer.phone) {
    const log = triggerMessage("UDHARI_RECEIPT_CONFIRMED", customer.id, customer.phone, {
      customer_name: customer.name,
      amount: paiseToRupees(validation.receipt.amountPaise),
      date: validation.receipt.receiptDate,
      balance_after: paiseToRupees(result.receipt.balance_after_paise)
    });
    if (log?.message_body) {
      whatsappLink = getWhatsAppLink(customer.phone, log.message_body);
    }
  }

  return response.status(201).json({ ...result, whatsapp_link: whatsappLink });
});

// Send a real WhatsApp/SMS dues reminder to a debtor (logged via the messenger service).
accountsRouter.post("/udhari/:ledgerId/remind", requireAdmin, (request, response) => {
  const ledgerId = Number(request.params.ledgerId);
  if (!Number.isInteger(ledgerId) || ledgerId <= 0) {
    return response.status(400).json({ errors: ["ledgerId must be a positive integer."] });
  }

  const ledger = db.query.ledgers.findFirst({
    where: and(eq(ledgers.id, ledgerId), eq(ledgers.account_type, "CUSTOMER_UDHARI"))
  }).sync();
  if (!ledger) {
    return response.status(404).json({ errors: ["Udhari ledger not found."] });
  }

  const customer = ledger.entity_id
    ? db.query.customers.findFirst({ where: eq(customers.id, ledger.entity_id) }).sync()
    : null;
  if (!customer || !customer.phone) {
    return response.status(422).json({ errors: ["Customer phone not available for reminder."] });
  }

  const log = triggerMessage("UDHARI_BALANCE_REMINDER", customer.id, customer.phone, {
    customer_name: customer.name,
    amount: paiseToRupees(ledger.balance_paise)
  });

  const messageBody = log?.message_body ?? `Dear ${customer.name}, outstanding balance Rs ${paiseToRupees(ledger.balance_paise)}.`;

  return response.json({
    status: log?.status ?? "FAILED",
    message_id: log?.id ?? null,
    recipient: customer.phone,
    message_body: messageBody,
    // Deep link the jeweler can open to actually send via WhatsApp (no API keys needed).
    whatsapp_link: getWhatsAppLink(customer.phone, messageBody)
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
  const referenceLabels = buildReferenceLabels(entries);

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
      // Dedupe: entries that share a reference_id (e.g. several udhari receipts keyed
      // by customer id) would otherwise repeat the same counterpart ledger name N times.
      counterparts = [...new Set(mates.map(m => m.ledgerName).filter((name): name is string => name !== null))];
    }

    return {
      ...entry,
      amount_rupees: paiseToRupees(entry.amount_paise),
      running_balance_paise: runningBalance,
      running_balance_rupees: paiseToRupees(runningBalance),
      particulars: counterparts.length > 0 ? counterparts.join(", ") : "-",
      reference_label: referenceLabels.get(entry.id) ?? null
    };
  });

  const closingBalancePaise = openingBalancePaise + totalDebitsPaise - totalCreditsPaise;
  const statementShare = buildLedgerStatementShare(
    ledger,
    dateRange.fromDate,
    dateRange.toDate,
    openingBalancePaise,
    closingBalancePaise,
    entriesWithRunningBalance
  );

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
    entries: entriesWithRunningBalance,
    statement_share: statementShare
  });
});

function buildLedgerStatementShare(
  ledger: typeof ledgers.$inferSelect,
  fromDate: string,
  toDate: string,
  openingBalancePaise: number,
  closingBalancePaise: number,
  entries: Array<typeof journalEntries.$inferSelect & { amount_rupees: string; running_balance_paise: number; running_balance_rupees: string; particulars: string }>
) {
  if (ledger.account_type !== "CUSTOMER_UDHARI" || ledger.entity_id === null) {
    return null;
  }

  const customer = db.query.customers.findFirst({ where: eq(customers.id, ledger.entity_id) }).sync();
  if (!customer?.phone) {
    return null;
  }

  const recentLines = entries.slice(-8).map((entry) => {
    const date = entry.created_at ? entry.created_at.slice(0, 10) : "-";
    const sign = entry.transaction_type === "DEBIT" ? "Dr" : "Cr";
    return `${date}: ${sign} Rs ${entry.amount_rupees} (${entry.particulars}) Bal Rs ${entry.running_balance_rupees}`;
  });

  const messageBody = [
    `Dear ${customer.name}, your Udhari ledger statement for ${fromDate} to ${toDate}:`,
    `Opening Rs ${paiseToRupees(openingBalancePaise)}, Closing Rs ${paiseToRupees(closingBalancePaise)}.`,
    recentLines.length > 0 ? `Recent entries:\n${recentLines.join("\n")}` : "No ledger entries in this period.",
    "Please contact us for any clarification."
  ].join("\n");

  return {
    customer_id: customer.id,
    customer_name: customer.name,
    phone: customer.phone,
    message_body: messageBody,
    whatsapp_link: getWhatsAppLink(customer.phone, messageBody)
  };
}

accountsRouter.get("/ledger-report/pdf", requireAdmin, async (request, response) => {
  const ledgerIdStr = request.query.ledger_id;
  if (typeof ledgerIdStr !== "string") {
    return response.status(400).json({ errors: ["ledger_id query parameter is required."] });
  }
  const ledgerId = parseInt(ledgerIdStr, 10);
  if (isNaN(ledgerId)) {
    return response.status(400).json({ errors: ["ledger_id must be an integer."] });
  }

  const ledger = db.query.ledgers.findFirst({ where: eq(ledgers.id, ledgerId) }).sync();
  if (!ledger) {
    return response.status(404).json({ errors: ["Ledger not found."] });
  }

  const fromVal = typeof request.query.from_date === "string" ? request.query.from_date : undefined;
  const toVal = typeof request.query.to_date === "string" ? request.query.to_date : undefined;
  const dateRange = parseDateRange(fromVal, toVal);

  const priorDebits = db.select({ total: sql`sum(${journalEntries.amount_paise})` }).from(journalEntries)
    .where(and(eq(journalEntries.ledger_id, ledgerId), eq(journalEntries.transaction_type, "DEBIT"), lt(journalEntries.created_at, dateRange.start))).get();
  const priorCredits = db.select({ total: sql`sum(${journalEntries.amount_paise})` }).from(journalEntries)
    .where(and(eq(journalEntries.ledger_id, ledgerId), eq(journalEntries.transaction_type, "CREDIT"), lt(journalEntries.created_at, dateRange.start))).get();

  const openingBalancePaise = Number(priorDebits?.total || 0) - Number(priorCredits?.total || 0);

  const entries = db.select().from(journalEntries)
    .where(and(eq(journalEntries.ledger_id, ledgerId), sql`${journalEntries.created_at} >= ${dateRange.start}`, lt(journalEntries.created_at, dateRange.end)))
    .orderBy(journalEntries.created_at, journalEntries.id)
    .all();

  let running = openingBalancePaise;
  let totalDebits = 0;
  let totalCredits = 0;

  const enriched = entries.map((entry) => {
    if (entry.transaction_type === "DEBIT") { running += entry.amount_paise; totalDebits += entry.amount_paise; }
    else { running -= entry.amount_paise; totalCredits += entry.amount_paise; }

    let counterparts: string[] = [];
    if (entry.reference_id !== null) {
      const mates = db.select({ ledgerName: ledgers.account_name }).from(journalEntries)
        .leftJoin(ledgers, eq(journalEntries.ledger_id, ledgers.id))
        .where(and(eq(journalEntries.reference_type, entry.reference_type), eq(journalEntries.reference_id, entry.reference_id), eq(journalEntries.transaction_type, entry.transaction_type === "DEBIT" ? "CREDIT" : "DEBIT")))
        .all();
      // Dedupe repeated counterpart names from entries sharing a reference_id.
      counterparts = [...new Set(mates.map(m => m.ledgerName).filter((name): name is string => name !== null))];
    }

    return {
      ...entry,
      amount_rupees: paiseToRupees(entry.amount_paise),
      running_balance_paise: running,
      running_balance_rupees: paiseToRupees(running),
      particulars: counterparts.length > 0 ? counterparts.join(", ") : "-"
    };
  });

  const closingBalancePaise = openingBalancePaise + totalDebits - totalCredits;

  const customer = ledger.entity_id !== null && ledger.account_type === "CUSTOMER_UDHARI"
    ? db.query.customers.findFirst({ where: eq(customers.id, ledger.entity_id) }).sync()
    : null;

  const orgSettings = db.select().from(organizationSettings).get();

  const { generateCustomerStatement } = await import("../utils/pdfGenerator.js");

  const pdfBuffer = await generateCustomerStatement(
    {
      customer_name: customer?.name ?? ledger.account_name,
      customer_phone: customer?.phone ?? null,
      ledger_name: ledger.account_name,
      from_date: dateRange.fromDate,
      to_date: dateRange.toDate,
      opening_balance_paise: openingBalancePaise,
      opening_balance_rupees: paiseToRupees(openingBalancePaise),
      closing_balance_paise: closingBalancePaise,
      closing_balance_rupees: paiseToRupees(closingBalancePaise),
      total_debits_paise: totalDebits,
      total_debits_rupees: paiseToRupees(totalDebits),
      total_credits_paise: totalCredits,
      total_credits_rupees: paiseToRupees(totalCredits),
      entries: enriched
    },
    {
      shop_name: orgSettings?.shop_name ?? "Jewellery Shop",
      address: orgSettings?.address ?? "",
      gstin: orgSettings?.gstin ?? null,
      contact_number: orgSettings?.contact_number ?? "",
      print_language: orgSettings?.print_language ?? null
    }
  );

  const safeName = (customer?.name ?? ledger.account_name).replace(/[^a-zA-Z0-9_-]/g, "_");
  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `attachment; filename="${safeName}_statement_${dateRange.fromDate}_${dateRange.toDate}.pdf"`);
  return response.send(pdfBuffer);
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
  const referenceLabels = buildReferenceLabels(dayEntries);

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
      amount_rupees: paiseToRupees(entry.amount_paise),
      reference_label: referenceLabels.get(entry.id) ?? null
    }))
  };
}

// Map journal entries to their voucher number (via voucher lines) so the UI can show a
// unique per-document reference (e.g. RECEIPT-20260607-001) instead of "UDHARI_RECEIPT
// #<customerId>", which repeats for every receipt of the same customer.
function buildReferenceLabels(entries: Array<{ id: number }>): Map<number, string> {
  const ids = entries.map((entry) => entry.id);
  const labels = new Map<number, string>();
  if (ids.length === 0) {
    return labels;
  }
  const rows = db
    .select({ journal_entry_id: voucherLines.journal_entry_id, voucher_number: voucherHeaders.voucher_number })
    .from(voucherLines)
    .innerJoin(voucherHeaders, eq(voucherLines.voucher_id, voucherHeaders.id))
    .where(inArray(voucherLines.journal_entry_id, ids))
    .all();
  for (const row of rows) {
    if (row.journal_entry_id !== null) {
      labels.set(row.journal_entry_id, row.voucher_number);
    }
  }
  return labels;
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

type UdhariReceiptValidation =
  | {
      ok: true;
      receipt: {
        customerId: number;
        amountPaise: number;
        paymentMode: "CASH" | "UPI" | "CARD" | "BANK";
        receiptDate: string;
        narration: string | null;
      };
    }
  | { ok: false; errors: string[] };

function validateUdhariReceiptPayload(body: unknown): UdhariReceiptValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const customerId = Number(body.customer_id ?? body.customerId);
  const amountPaise = Number(body.amount_paise ?? body.amountPaise);
  const rawMode = typeof body.payment_mode === "string"
    ? body.payment_mode.trim().toUpperCase()
    : typeof body.paymentMode === "string"
      ? body.paymentMode.trim().toUpperCase()
      : "CASH";
  const paymentMode = rawMode === "UPI" || rawMode === "CARD" || rawMode === "BANK" ? rawMode : rawMode === "CASH" ? "CASH" : null;
  const receiptDate = typeof body.receipt_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.receipt_date)
    ? body.receipt_date
    : typeof body.receiptDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.receiptDate)
      ? body.receiptDate
      : new Date().toISOString().slice(0, 10);
  const narration = typeof body.narration === "string" && body.narration.trim() ? body.narration.trim() : null;

  if (!Number.isInteger(customerId) || customerId <= 0) {
    errors.push("customer_id must be a positive integer.");
  }

  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    errors.push("amount_paise must be a positive integer.");
  }

  if (!paymentMode) {
    errors.push("payment_mode must be CASH, UPI, CARD, or BANK.");
  }

  if (errors.length > 0 || paymentMode === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    receipt: {
      customerId,
      amountPaise,
      paymentMode,
      receiptDate,
      narration
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
