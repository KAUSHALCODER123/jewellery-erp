import { addMonths, format, parseISO } from "date-fns";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin, requireAuth, requireRoles, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import {
  customers,
  gssAccounts,
  gssReceipts,
  gssTemplates,
  journalEntries,
  ledgers,
  organizationSettings,
  type GssAccountStatus,
  type GssPaymentMode
} from "../db/schema.js";
import { paiseToRupees } from "../utils/decimal.js";
import { triggerMessage } from "../utils/messageService.js";

export const gssRouter = Router();

gssRouter.get("/templates", requireAuth, (request, response) => {
  const activeOnly = request.query.active === "true";
  const whereClause = activeOnly ? eq(gssTemplates.is_active, true) : undefined;
  const templates = db.select().from(gssTemplates).where(whereClause).all();

  return response.json({ templates });
});

// Create a GSS scheme template (self-serve scheme builder).
gssRouter.post("/templates", requireAuth, requireAdmin, (request, response) => {
  const validation = validateTemplatePayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const existing = db.query.gssTemplates.findFirst({ where: eq(gssTemplates.scheme_code, validation.values.scheme_code) }).sync();
  if (existing) {
    return response.status(409).json({ errors: ["A scheme with this scheme_code already exists."] });
  }

  const template = db.insert(gssTemplates).values(validation.values).returning().get();
  return response.status(201).json({ template });
});

// Update an existing GSS scheme template.
gssRouter.put("/templates/:id", requireAuth, requireAdmin, (request, response) => {
  const templateId = Number(request.params.id);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    return response.status(400).json({ errors: ["Template id must be a positive integer."] });
  }

  const validation = validateTemplatePayload(request.body);
  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const codeOwner = db.query.gssTemplates.findFirst({ where: eq(gssTemplates.scheme_code, validation.values.scheme_code) }).sync();
  if (codeOwner && codeOwner.id !== templateId) {
    return response.status(409).json({ errors: ["Another scheme already uses this scheme_code."] });
  }

  const template = db.update(gssTemplates).set(validation.values).where(eq(gssTemplates.id, templateId)).returning().get();
  if (!template) {
    return response.status(404).json({ errors: ["Scheme template not found."] });
  }
  return response.json({ template });
});

// Installment schedule (due dates + amounts) for an enrolled account — the
// "receipts structure" grid shown at enrollment.
gssRouter.get("/accounts/:id/schedule", requireAuth, (request, response) => {
  const accountId = Number(request.params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ errors: ["Account id must be a positive integer."] });
  }

  const account = db.query.gssAccounts.findFirst({
    where: eq(gssAccounts.id, accountId),
    with: { template: true }
  }).sync();

  if (!account) {
    return response.status(404).json({ errors: ["GSS account not found."] });
  }

  const template = account.template;
  if (!template) {
    return response.status(404).json({ errors: ["Scheme template not found for this account."] });
  }

  // Customer pays `customer_months` installments (rest funded by shop in 11+1 schemes).
  const totalInstallments = template.customer_months ?? template.duration_months;
  const schedule = [];
  for (let i = 0; i < totalInstallments; i += 1) {
    schedule.push({
      installment_number: i + 1,
      due_date: format(addMonths(parseISO(account.enrollment_date), i), "yyyy-MM-dd"),
      amount_paise: template.monthly_amount_paise,
      paid: i < account.installments_paid_count
    });
  }

  return response.json({
    account_id: accountId,
    total_installments: totalInstallments,
    monthly_amount_paise: template.monthly_amount_paise,
    maturity_date: account.maturity_date,
    schedule
  });
});

type TemplateValidation =
  | { ok: true; values: typeof gssTemplates.$inferInsert }
  | { ok: false; errors: string[] };

function validateTemplatePayload(body: unknown): TemplateValidation {
  const errors: string[] = [];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }
  const b = body as Record<string, unknown>;

  const schemeCode = typeof b.scheme_code === "string" ? b.scheme_code.trim().toUpperCase() : "";
  const schemeName = typeof b.scheme_name === "string" ? b.scheme_name.trim() : "";
  const schemeType = b.scheme_type === "GOLD" ? "GOLD" : "CASH";
  const bonusRuleType = b.bonus_rule_type === "PERCENTAGE_OF_INSTALLMENT" ? "PERCENTAGE_OF_INSTALLMENT" : "FIXED_AMOUNT";

  const posInt = (value: unknown, field: string) => {
    if (!Number.isInteger(value) || (value as number) <= 0) {
      errors.push(`${field} must be a positive integer.`);
      return 0;
    }
    return value as number;
  };
  const nonNegInt = (value: unknown, field: string, dflt = 0) => {
    if (value === undefined || value === null) return dflt;
    if (!Number.isInteger(value) || (value as number) < 0) {
      errors.push(`${field} must be a non-negative integer.`);
      return dflt;
    }
    return value as number;
  };
  const optInt = (value: unknown, field: string): number | null => {
    if (value === undefined || value === null || value === "") return null;
    if (!Number.isInteger(value) || (value as number) < 0) {
      errors.push(`${field} must be a non-negative integer.`);
      return null;
    }
    return value as number;
  };

  if (!schemeCode) errors.push("scheme_code is required.");
  if (!schemeName) errors.push("scheme_name is required.");
  const durationMonths = posInt(b.duration_months, "duration_months");
  const monthlyAmountPaise = nonNegInt(b.monthly_amount_paise, "monthly_amount_paise");
  const bonusValuePaise = nonNegInt(b.bonus_value_paise, "bonus_value_paise");
  const minMonthly = optInt(b.min_monthly_amount_paise, "min_monthly_amount_paise");
  const maxMonthly = optInt(b.max_monthly_amount_paise, "max_monthly_amount_paise");
  const customerMonths = optInt(b.customer_months, "customer_months");
  const maturityMonths = optInt(b.maturity_months, "maturity_months");

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      scheme_code: schemeCode,
      scheme_name: schemeName,
      scheme_type: schemeType,
      duration_months: durationMonths,
      monthly_amount_paise: monthlyAmountPaise,
      bonus_rule_type: bonusRuleType,
      bonus_value_paise: bonusValuePaise,
      is_active: b.is_active === undefined ? true : Boolean(b.is_active),
      is_variable: Boolean(b.is_variable),
      min_monthly_amount_paise: minMonthly,
      max_monthly_amount_paise: maxMonthly,
      customer_months: customerMonths,
      maturity_months: maturityMonths
    }
  };
}

gssRouter.get("/accounts", requireAuth, (request, response) => {
  const requestedStatuses = typeof request.query.status === "string"
    ? request.query.status.split(",").map((status) => status.trim()).filter(isGssAccountStatus)
    : [];
  const whereClause = requestedStatuses.length > 0 ? inArray(gssAccounts.status, requestedStatuses) : undefined;

  const accounts = db
    .select({
      id: gssAccounts.id,
      customer_id: gssAccounts.customer_id,
      template_id: gssAccounts.template_id,
      card_number: gssAccounts.card_number,
      enrollment_date: gssAccounts.enrollment_date,
      maturity_date: gssAccounts.maturity_date,
      status: gssAccounts.status,
      total_paid_paise: gssAccounts.total_paid_paise,
      installments_paid_count: gssAccounts.installments_paid_count,
      customer_name: customers.name,
      phone: customers.phone,
      scheme_code: gssTemplates.scheme_code,
      scheme_name: gssTemplates.scheme_name,
      duration_months: gssTemplates.duration_months,
      monthly_amount_paise: gssTemplates.monthly_amount_paise,
      bonus_rule_type: gssTemplates.bonus_rule_type,
      bonus_value_paise: gssTemplates.bonus_value_paise,
      is_active: gssTemplates.is_active
    })
    .from(gssAccounts)
    .innerJoin(customers, eq(gssAccounts.customer_id, customers.id))
    .innerJoin(gssTemplates, eq(gssAccounts.template_id, gssTemplates.id))
    .where(whereClause)
    .all()
    .map((account) => ({
      id: account.id,
      customer_id: account.customer_id,
      template_id: account.template_id,
      card_number: account.card_number,
      enrollment_date: account.enrollment_date,
      maturity_date: account.maturity_date,
      status: account.status,
      total_paid_paise: account.total_paid_paise,
      installments_paid_count: account.installments_paid_count,
      customer_name: account.customer_name,
      phone: account.phone,
      duration_months: account.duration_months,
      monthly_amount_paise: account.monthly_amount_paise,
      bonus_rule_type: account.bonus_rule_type,
      bonus_value_paise: account.bonus_value_paise,
      template: {
        id: account.template_id,
        scheme_code: account.scheme_code,
        scheme_name: account.scheme_name,
        duration_months: account.duration_months,
        monthly_amount_paise: account.monthly_amount_paise,
        bonus_rule_type: account.bonus_rule_type,
        bonus_value_paise: account.bonus_value_paise,
        is_active: account.is_active
      }
    }));

  return response.json({ accounts });
});

gssRouter.post("/enroll", requireAuth, requireAdmin, (request, response) => {
  const validation = validateEnrollPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const customer = db.query.customers.findFirst({
    where: eq(customers.id, validation.enrollment.customerId)
  }).sync();
  const template = db.query.gssTemplates.findFirst({
    where: and(eq(gssTemplates.id, validation.enrollment.templateId), eq(gssTemplates.is_active, true))
  }).sync();

  if (!customer) {
    return response.status(404).json({ errors: ["Customer not found."] });
  }

  if (!template) {
    return response.status(404).json({ errors: ["Active GSS template not found."] });
  }

  const existingActiveAccount = db.query.gssAccounts.findFirst({
    where: and(
      eq(gssAccounts.customer_id, validation.enrollment.customerId),
      eq(gssAccounts.template_id, validation.enrollment.templateId),
      eq(gssAccounts.card_number, validation.enrollment.cardNumber),
      eq(gssAccounts.status, "ACTIVE")
    )
  }).sync();

  if (existingActiveAccount) {
    return response.status(409).json({
      errors: ["This customer already has an active GSS account for the same template and card number."]
    });
  }

  const account = db
    .insert(gssAccounts)
    .values({
      customer_id: validation.enrollment.customerId,
      template_id: validation.enrollment.templateId,
      card_number: validation.enrollment.cardNumber,
      enrollment_date: validation.enrollment.enrollmentDate,
      maturity_date: calculateMaturityDate(validation.enrollment.enrollmentDate, template.duration_months),
      status: "ACTIVE",
      total_paid_paise: 0,
      installments_paid_count: 0
    })
    .returning()
    .get();

  return response.status(201).json({
    account: {
      ...account,
      total_paid_rupees: paiseToRupees(account.total_paid_paise)
    }
  });
});

gssRouter.post("/collect-payment", requireAuth, requireRoles("ADMIN", "COUNTER_STAFF"), (request, response) => {
  const validation = validateCollectPaymentPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const accountRow = db
    .select({
      account: gssAccounts,
      template: gssTemplates
    })
    .from(gssAccounts)
    .innerJoin(gssTemplates, eq(gssAccounts.template_id, gssTemplates.id))
    .where(eq(gssAccounts.id, validation.payment.gssAccountId))
    .get();

  if (!accountRow) {
    return response.status(404).json({ errors: ["GSS account not found."] });
  }

  if (accountRow.account.status !== "ACTIVE") {
    return response.status(409).json({ errors: ["Payments can only be collected for active GSS accounts."] });
  }

  // Variable amount check
  if (accountRow.template.is_variable) {
    const amountPaid = validation.payment.amountPaidPaise;
    const minAmt = accountRow.template.min_monthly_amount_paise;
    const maxAmt = accountRow.template.max_monthly_amount_paise;
    if (minAmt !== null && amountPaid < minAmt) {
      return response.status(400).json({ errors: [`Amount is below the minimum allowed limit of Rs ${minAmt / 100}.`] });
    }
    if (maxAmt !== null && amountPaid > maxAmt) {
      return response.status(400).json({ errors: [`Amount exceeds the maximum allowed limit of Rs ${maxAmt / 100}.`] });
    }
  }

  const receiptLedger = findReceiptLedger(validation.payment.paymentMode);

  if (!receiptLedger) {
    return response.status(409).json({ errors: [`${validation.payment.paymentMode} ledger not found.`] });
  }

  const userId = (request as AuthenticatedRequest).user.id;

  const result = db.transaction((tx) => {
    const liabilityLedger = getOrCreateGssLiabilityLedger(tx);
    const nextInstallmentCount = accountRow.account.installments_paid_count + 1;
    const nextTotalPaidPaise = accountRow.account.total_paid_paise + validation.payment.amountPaidPaise;
    const nextStatus: GssAccountStatus =
      nextInstallmentCount >= accountRow.template.duration_months ? "MATURED" : "ACTIVE";

    // Calculate gold weight credits if applicable
    const isGoldScheme = accountRow.template.scheme_type === "GOLD";
    let goldRatePaise = null;
    let goldWeightCreditedMg = 0;
    if (isGoldScheme) {
      const settings = tx.select().from(organizationSettings).get();
      goldRatePaise = settings?.gold_22k_rate_per_gram ?? 600000;
      goldWeightCreditedMg = Math.round((validation.payment.amountPaidPaise / goldRatePaise) * 1000);
    }

    const debitEntry = tx
      .insert(journalEntries)
      .values({
        ledger_id: receiptLedger.id,
        transaction_type: "DEBIT",
        amount_paise: validation.payment.amountPaidPaise,
        reference_type: "GSS_RECEIPT",
        reference_id: accountRow.account.id,
        description: `GSS installment ${nextInstallmentCount} for ${accountRow.account.card_number}`
      })
      .returning()
      .get();

    const creditEntry = tx
      .insert(journalEntries)
      .values({
        ledger_id: liabilityLedger.id,
        transaction_type: "CREDIT",
        amount_paise: validation.payment.amountPaidPaise,
        reference_type: "GSS_RECEIPT",
        reference_id: accountRow.account.id,
        description: `GSS liability for ${accountRow.account.card_number}`
      })
      .returning()
      .get();

    const receipt = tx
      .insert(gssReceipts)
      .values({
        gss_account_id: accountRow.account.id,
        installment_number: nextInstallmentCount,
        payment_date: validation.payment.paymentDate,
        amount_paid_paise: validation.payment.amountPaidPaise,
        payment_mode: validation.payment.paymentMode,
        journal_entry_id: debitEntry.id,
        created_by: userId,
        gold_rate_per_gram_paise: goldRatePaise,
        gold_weight_credited_mg: goldWeightCreditedMg
      })
      .returning()
      .get();

    tx.update(gssAccounts)
      .set({
        total_paid_paise: nextTotalPaidPaise,
        installments_paid_count: nextInstallmentCount,
        status: nextStatus,
        gold_weight_accumulated_mg: accountRow.account.gold_weight_accumulated_mg + goldWeightCreditedMg
      })
      .where(eq(gssAccounts.id, accountRow.account.id))
      .run();

    tx.update(ledgers)
      .set({ balance_paise: receiptLedger.balance_paise + validation.payment.amountPaidPaise })
      .where(eq(ledgers.id, receiptLedger.id))
      .run();

    tx.update(ledgers)
      .set({ balance_paise: liabilityLedger.balance_paise + validation.payment.amountPaidPaise })
      .where(eq(ledgers.id, liabilityLedger.id))
      .run();

    return {
      receipt,
      debitEntry,
      creditEntry,
      account: {
        ...accountRow.account,
        total_paid_paise: nextTotalPaidPaise,
        installments_paid_count: nextInstallmentCount,
        status: nextStatus,
        gold_weight_accumulated_mg: accountRow.account.gold_weight_accumulated_mg + goldWeightCreditedMg
      }
    };
  });

  try {
    const customerRow = db.query.customers.findFirst({
      where: eq(customers.id, accountRow.account.customer_id)
    }).sync();

    if (customerRow && customerRow.phone) {
      triggerMessage("GSS_INSTALLMENT_RECEIVED", customerRow.id, customerRow.phone, {
        customer_name: customerRow.name,
        card_number: accountRow.account.card_number,
        amount: paiseToRupees(validation.payment.amountPaidPaise),
        date: validation.payment.paymentDate,
        total_paid: paiseToRupees(result.account.total_paid_paise)
      });
    }
  } catch (triggerErr) {
    console.error("Failed to trigger message for GSS payment:", triggerErr);
  }

  return response.status(201).json({
    receipt: {
      ...result.receipt,
      amount_paid_rupees: paiseToRupees(result.receipt.amount_paid_paise)
    },
    account: {
      ...result.account,
      total_paid_rupees: paiseToRupees(result.account.total_paid_paise)
    },
    journal_entries: [
      {
        ...result.debitEntry,
        amount_rupees: paiseToRupees(result.debitEntry.amount_paise)
      },
      {
        ...result.creditEntry,
        amount_rupees: paiseToRupees(result.creditEntry.amount_paise)
      }
    ]
  });
});

gssRouter.post("/merge", requireAuth, requireAdmin, (request, response) => {
  const validation = validateMergePayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const source = db.query.gssAccounts.findFirst({
    where: eq(gssAccounts.id, validation.merge.sourceAccountId)
  }).sync();
  const target = db.query.gssAccounts.findFirst({
    where: eq(gssAccounts.id, validation.merge.targetAccountId)
  }).sync();

  if (!source || !target) {
    return response.status(404).json({ errors: ["Source or target GSS account not found."] });
  }

  if (source.customer_id !== target.customer_id) {
    return response.status(409).json({ errors: ["GSS accounts can only be merged for the same customer."] });
  }

  if (source.status === "MERGED") {
    return response.status(409).json({ errors: ["Source GSS account is already merged."] });
  }

  const targetTemplate = db.query.gssTemplates.findFirst({
    where: eq(gssTemplates.id, target.template_id)
  }).sync();

  if (!targetTemplate) {
    return response.status(404).json({ errors: ["Target GSS template not found."] });
  }

  const mergedAccount = db.transaction((tx) => {
    const nextTotalPaidPaise = target.total_paid_paise + source.total_paid_paise;
    const nextInstallmentsPaidCount = target.installments_paid_count + source.installments_paid_count;
    const nextStatus: GssAccountStatus =
      nextInstallmentsPaidCount >= targetTemplate.duration_months ? "MATURED" : target.status;

    tx.update(gssReceipts)
      .set({ gss_account_id: target.id })
      .where(eq(gssReceipts.gss_account_id, source.id))
      .run();

    tx.update(gssAccounts)
      .set({ status: "MERGED" })
      .where(eq(gssAccounts.id, source.id))
      .run();

    return tx.update(gssAccounts)
      .set({
        total_paid_paise: nextTotalPaidPaise,
        installments_paid_count: nextInstallmentsPaidCount,
        status: nextStatus
      })
      .where(eq(gssAccounts.id, target.id))
      .returning()
      .get();
  });

  return response.json({
    account: {
      ...mergedAccount,
      total_paid_rupees: paiseToRupees(mergedAccount.total_paid_paise)
    }
  });
});

gssRouter.get("/reports/statements", requireAuth, (request, response) => {
  const accountIdStr = request.query.account_id;
  const accountId = Number(accountIdStr);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return response.status(400).json({ errors: ["account_id must be a positive integer."] });
  }

  const account = db
    .select({
      id: gssAccounts.id,
      customer_id: gssAccounts.customer_id,
      template_id: gssAccounts.template_id,
      card_number: gssAccounts.card_number,
      enrollment_date: gssAccounts.enrollment_date,
      maturity_date: gssAccounts.maturity_date,
      status: gssAccounts.status,
      total_paid_paise: gssAccounts.total_paid_paise,
      installments_paid_count: gssAccounts.installments_paid_count,
      gold_weight_accumulated_mg: gssAccounts.gold_weight_accumulated_mg,
      customer_name: customers.name,
      phone: customers.phone,
      scheme_code: gssTemplates.scheme_code,
      scheme_name: gssTemplates.scheme_name,
      scheme_type: gssTemplates.scheme_type,
      is_variable: gssTemplates.is_variable,
      duration_months: gssTemplates.duration_months,
      monthly_amount_paise: gssTemplates.monthly_amount_paise,
      bonus_rule_type: gssTemplates.bonus_rule_type,
      bonus_value_paise: gssTemplates.bonus_value_paise
    })
    .from(gssAccounts)
    .innerJoin(customers, eq(gssAccounts.customer_id, customers.id))
    .innerJoin(gssTemplates, eq(gssAccounts.template_id, gssTemplates.id))
    .where(eq(gssAccounts.id, accountId))
    .get();

  if (!account) {
    return response.status(404).json({ errors: ["GSS account not found."] });
  }

  const receipts = db
    .select()
    .from(gssReceipts)
    .where(eq(gssReceipts.gss_account_id, accountId))
    .orderBy(gssReceipts.installment_number)
    .all();

  // Calculate current expected due amount and bonus
  let calculatedBonusPaise = 0;
  if (account.bonus_rule_type === "PERCENTAGE_OF_INSTALLMENT") {
    calculatedBonusPaise = Math.round((account.total_paid_paise * account.bonus_value_paise) / 10000);
  } else {
    calculatedBonusPaise = account.bonus_value_paise;
  }

  // If it is a Gold scheme, calculate current cash value of accumulated gold (for information)
  const settings = db.select().from(organizationSettings).get();
  const currentGoldRate22k = settings?.gold_22k_rate_per_gram ?? 600000;
  const currentGoldValuePaise = Math.round((account.gold_weight_accumulated_mg / 1000) * currentGoldRate22k);

  return response.json({
    account,
    receipts,
    summary: {
      calculated_bonus_paise: calculatedBonusPaise,
      expected_maturity_value_paise: account.total_paid_paise + calculatedBonusPaise,
      current_gold_value_paise: currentGoldValuePaise,
      current_gold_rate_paise: currentGoldRate22k
    }
  });
});

gssRouter.get("/reports/pending", requireAuth, (request, response) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const accounts = db
    .select({
      id: gssAccounts.id,
      customer_id: gssAccounts.customer_id,
      template_id: gssAccounts.template_id,
      card_number: gssAccounts.card_number,
      enrollment_date: gssAccounts.enrollment_date,
      maturity_date: gssAccounts.maturity_date,
      status: gssAccounts.status,
      total_paid_paise: gssAccounts.total_paid_paise,
      installments_paid_count: gssAccounts.installments_paid_count,
      customer_name: customers.name,
      phone: customers.phone,
      monthly_amount_paise: gssTemplates.monthly_amount_paise,
      duration_months: gssTemplates.duration_months
    })
    .from(gssAccounts)
    .innerJoin(customers, eq(gssAccounts.customer_id, customers.id))
    .innerJoin(gssTemplates, eq(gssAccounts.template_id, gssTemplates.id))
    .where(eq(gssAccounts.status, "ACTIVE"))
    .all();

  const pendingReports = accounts.map((acc) => {
    const expected = calculateElapsedMonths(acc.enrollment_date, todayStr);
    const finalExpected = Math.min(expected, acc.duration_months);
    const pendingCount = Math.max(finalExpected - acc.installments_paid_count, 0);
    const pendingAmountPaise = pendingCount * acc.monthly_amount_paise;

    return {
      ...acc,
      expected_installments: finalExpected,
      pending_installments_count: pendingCount,
      pending_amount_paise: pendingAmountPaise
    };
  }).filter((report) => report.pending_installments_count > 0);

  return response.json({ reports: pendingReports });
});

gssRouter.get("/reports/received", requireAuth, (request, response) => {
  const startDate = typeof request.query.start_date === "string" ? request.query.start_date : "";
  const endDate = typeof request.query.end_date === "string" ? request.query.end_date : "";

  if (!startDate || !endDate) {
    return response.status(400).json({ errors: ["start_date and end_date queries are required."] });
  }

  const receipts = db
    .select({
      id: gssReceipts.id,
      gss_account_id: gssReceipts.gss_account_id,
      installment_number: gssReceipts.installment_number,
      payment_date: gssReceipts.payment_date,
      amount_paid_paise: gssReceipts.amount_paid_paise,
      payment_mode: gssReceipts.payment_mode,
      card_number: gssAccounts.card_number,
      customer_name: customers.name,
      phone: customers.phone
    })
    .from(gssReceipts)
    .innerJoin(gssAccounts, eq(gssReceipts.gss_account_id, gssAccounts.id))
    .innerJoin(customers, eq(gssAccounts.customer_id, customers.id))
    .where(sql`${gssReceipts.payment_date} >= ${startDate} AND ${gssReceipts.payment_date} <= ${endDate}`)
    .orderBy(gssReceipts.payment_date)
    .all();

  // Summarize by payment mode
  let totalCashPaise = 0;
  let totalUpiPaise = 0;
  let totalCardPaise = 0;
  for (const r of receipts) {
    if (r.payment_mode === "CASH") totalCashPaise += r.amount_paid_paise;
    else if (r.payment_mode === "UPI") totalUpiPaise += r.amount_paid_paise;
    else if (r.payment_mode === "CARD") totalCardPaise += r.amount_paid_paise;
  }

  return response.json({
    receipts,
    summary: {
      total_collected_paise: totalCashPaise + totalUpiPaise + totalCardPaise,
      cash_paise: totalCashPaise,
      upi_paise: totalUpiPaise,
      card_paise: totalCardPaise
    }
  });
});

gssRouter.get("/reports/maturity", requireAuth, (request, response) => {
  const daysLimit = typeof request.query.days === "string" ? Number(request.query.days) : 30;
  const today = new Date();
  const futureLimit = new Date();
  futureLimit.setDate(today.getDate() + daysLimit);

  const todayStr = today.toISOString().slice(0, 10);
  const futureLimitStr = futureLimit.toISOString().slice(0, 10);

  const accounts = db
    .select({
      id: gssAccounts.id,
      customer_id: gssAccounts.customer_id,
      template_id: gssAccounts.template_id,
      card_number: gssAccounts.card_number,
      enrollment_date: gssAccounts.enrollment_date,
      maturity_date: gssAccounts.maturity_date,
      status: gssAccounts.status,
      total_paid_paise: gssAccounts.total_paid_paise,
      installments_paid_count: gssAccounts.installments_paid_count,
      gold_weight_accumulated_mg: gssAccounts.gold_weight_accumulated_mg,
      customer_name: customers.name,
      phone: customers.phone,
      scheme_code: gssTemplates.scheme_code,
      scheme_name: gssTemplates.scheme_name,
      scheme_type: gssTemplates.scheme_type,
      duration_months: gssTemplates.duration_months,
      monthly_amount_paise: gssTemplates.monthly_amount_paise,
      bonus_rule_type: gssTemplates.bonus_rule_type,
      bonus_value_paise: gssTemplates.bonus_value_paise
    })
    .from(gssAccounts)
    .innerJoin(customers, eq(gssAccounts.customer_id, customers.id))
    .innerJoin(gssTemplates, eq(gssAccounts.template_id, gssTemplates.id))
    .where(or(
      eq(gssAccounts.status, "MATURED"),
      and(
        eq(gssAccounts.status, "ACTIVE"),
        sql`${gssAccounts.maturity_date} <= ${futureLimitStr}`
      )
    ))
    .all()
    .map((acc) => {
      let bonusPaise = 0;
      if (acc.bonus_rule_type === "PERCENTAGE_OF_INSTALLMENT") {
        bonusPaise = Math.round((acc.total_paid_paise * acc.bonus_value_paise) / 10000);
      } else {
        bonusPaise = acc.bonus_value_paise;
      }

      const isMatured = acc.status === "MATURED" || acc.maturity_date <= todayStr;

      return {
        ...acc,
        bonus_paise: bonusPaise,
        maturity_value_paise: acc.total_paid_paise + bonusPaise,
        is_matured: isMatured
      };
    });

  return response.json({ accounts });
});

gssRouter.post("/defaulter/run", requireAuth, requireAdmin, (request, response) => {
  const todayStr = new Date().toISOString().slice(0, 10);
  const accounts = db
    .select({
      id: gssAccounts.id,
      enrollment_date: gssAccounts.enrollment_date,
      installments_paid_count: gssAccounts.installments_paid_count,
      duration_months: gssTemplates.duration_months
    })
    .from(gssAccounts)
    .innerJoin(gssTemplates, eq(gssAccounts.template_id, gssTemplates.id))
    .where(eq(gssAccounts.status, "ACTIVE"))
    .all();

  let updatedCount = 0;
  const updatedAccounts: number[] = [];

  db.transaction((tx) => {
    for (const acc of accounts) {
      const expected = calculateElapsedMonths(acc.enrollment_date, todayStr);
      const finalExpected = Math.min(expected, acc.duration_months);
      if (finalExpected - acc.installments_paid_count >= 2) {
        tx.update(gssAccounts)
          .set({ status: "DEFAULTER" })
          .where(eq(gssAccounts.id, acc.id))
          .run();
        updatedCount++;
        updatedAccounts.push(acc.id);
      }
    }
  });

  return response.json({
    message: "Defaulter audit run completed.",
    updated_count: updatedCount,
    defaulter_account_ids: updatedAccounts
  });
});

gssRouter.get("/defaulters", requireAuth, (request, response) => {
  const accounts = db
    .select({
      id: gssAccounts.id,
      customer_id: gssAccounts.customer_id,
      template_id: gssAccounts.template_id,
      card_number: gssAccounts.card_number,
      enrollment_date: gssAccounts.enrollment_date,
      maturity_date: gssAccounts.maturity_date,
      status: gssAccounts.status,
      total_paid_paise: gssAccounts.total_paid_paise,
      installments_paid_count: gssAccounts.installments_paid_count,
      customer_name: customers.name,
      phone: customers.phone,
      scheme_code: gssTemplates.scheme_code,
      scheme_name: gssTemplates.scheme_name,
      monthly_amount_paise: gssTemplates.monthly_amount_paise
    })
    .from(gssAccounts)
    .innerJoin(customers, eq(gssAccounts.customer_id, customers.id))
    .innerJoin(gssTemplates, eq(gssAccounts.template_id, gssTemplates.id))
    .where(eq(gssAccounts.status, "DEFAULTER"))
    .all();

  return response.json({ accounts });
});

type EnrollValidation =
  | {
      ok: true;
      enrollment: {
        customerId: number;
        templateId: number;
        cardNumber: string;
        enrollmentDate: string;
      };
    }
  | { ok: false; errors: string[] };

type CollectPaymentValidation =
  | {
      ok: true;
      payment: {
        gssAccountId: number;
        amountPaidPaise: number;
        paymentMode: GssPaymentMode;
        paymentDate: string;
      };
    }
  | { ok: false; errors: string[] };

type MergeValidation =
  | {
      ok: true;
      merge: {
        sourceAccountId: number;
        targetAccountId: number;
      };
    }
  | { ok: false; errors: string[] };

function validateEnrollPayload(body: unknown): EnrollValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const customerId = body.customer_id;
  const templateId = body.template_id;
  const cardNumber = typeof body.card_number === "string" ? body.card_number.trim().toUpperCase() : "";
  const enrollmentDate = typeof body.enrollment_date === "string" && isDate(body.enrollment_date)
    ? body.enrollment_date
    : getToday();

  if (!Number.isInteger(customerId)) {
    errors.push("customer_id must be an integer.");
  }

  if (!Number.isInteger(templateId)) {
    errors.push("template_id must be an integer.");
  }

  if (!/^[A-Z0-9]{4,32}$/.test(cardNumber)) {
    errors.push("card_number must be 4 to 32 alphanumeric characters.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    enrollment: {
      customerId: customerId as number,
      templateId: templateId as number,
      cardNumber,
      enrollmentDate
    }
  };
}

function validateCollectPaymentPayload(body: unknown): CollectPaymentValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const gssAccountId = body.gss_account_id;
  const amountPaidPaise = body.amount_paid_paise;
  const paymentMode = body.payment_mode;
  const paymentDate = typeof body.payment_date === "string" && isDate(body.payment_date) ? body.payment_date : getToday();

  if (!Number.isInteger(gssAccountId)) {
    errors.push("gss_account_id must be an integer.");
  }

  if (!Number.isInteger(amountPaidPaise) || (amountPaidPaise as number) <= 0) {
    errors.push("amount_paid_paise must be a positive integer.");
  }

  if (!isPaymentMode(paymentMode)) {
    errors.push("payment_mode must be CASH, UPI, or CARD.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    payment: {
      gssAccountId: gssAccountId as number,
      amountPaidPaise: amountPaidPaise as number,
      paymentMode: paymentMode as GssPaymentMode,
      paymentDate
    }
  };
}

function validateMergePayload(body: unknown): MergeValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const sourceAccountId = body.source_account_id;
  const targetAccountId = body.target_account_id;

  if (!Number.isInteger(sourceAccountId)) {
    errors.push("source_account_id must be an integer.");
  }

  if (!Number.isInteger(targetAccountId)) {
    errors.push("target_account_id must be an integer.");
  }

  if (sourceAccountId === targetAccountId) {
    errors.push("source_account_id and target_account_id must be different.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    merge: {
      sourceAccountId: sourceAccountId as number,
      targetAccountId: targetAccountId as number
    }
  };
}

function findReceiptLedger(paymentMode: GssPaymentMode) {
  const accountType = paymentMode === "CASH" ? "CASH" : "BANK";

  return db.query.ledgers.findFirst({
    where: eq(ledgers.account_type, accountType)
  }).sync();
}

function getOrCreateGssLiabilityLedger(tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const existingLedger = tx
    .select()
    .from(ledgers)
    .where(eq(ledgers.account_type, "GSS_LIABILITY"))
    .get();

  if (existingLedger) {
    return existingLedger;
  }

  return tx
    .insert(ledgers)
    .values({
      account_name: "GSS Liability",
      account_type: "GSS_LIABILITY",
      entity_id: null,
      balance_paise: 0
    })
    .returning()
    .get();
}

function calculateMaturityDate(enrollmentDate: string, durationMonths: number) {
  return format(addMonths(parseISO(enrollmentDate), durationMonths), "yyyy-MM-dd");
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parseISO(value).getTime());
}

function isPaymentMode(value: unknown): value is GssPaymentMode {
  return value === "CASH" || value === "UPI" || value === "CARD";
}

function isGssAccountStatus(value: string): value is GssAccountStatus {
  return value === "ACTIVE" ||
    value === "MATURED" ||
    value === "CONVERTED_TO_SALE" ||
    value === "DEFAULTER" ||
    value === "MERGED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function calculateElapsedMonths(enrollmentDateStr: string, todayStr: string): number {
  const enroll = parseISO(enrollmentDateStr);
  const today = parseISO(todayStr);
  let months = (today.getFullYear() - enroll.getFullYear()) * 12 + (today.getMonth() - enroll.getMonth());
  if (today.getDate() < enroll.getDate()) {
    months--;
  }
  return Math.max(months + 1, 1);
}
