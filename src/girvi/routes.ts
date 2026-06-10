import { desc, eq, sql } from "drizzle-orm";
import { addMonths, differenceInCalendarDays, format, parseISO } from "date-fns";
import { Router } from "express";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import {
  customers,
  girviCollateral,
  girviLoans,
  girviRepayments,
  journalEntries,
  ledgers,
  organizationSettings,
  items,
  type GirviInterestType,
  type GirviRatePeriod
} from "../db/schema.js";
import { paiseToRupees } from "../utils/decimal.js";
import { triggerMessage } from "../utils/messageService.js";

const HIGH_VALUE_CASH_KYC_LIMIT_PAISE = 20000000;
const MAX_LTV_PERCENTAGE = 75;

export const girviRouter = Router();
girviRouter.use(requireAuth);

girviRouter.get("/loans", (request, response) => {
  const status = typeof request.query.status === "string" && isGirviStatus(request.query.status)
    ? request.query.status
    : undefined;
  const whereClause = status ? eq(girviLoans.status, status) : undefined;

  const loans = db
    .select({
      id: girviLoans.id,
      loan_number: girviLoans.loan_number,
      customer_id: girviLoans.customer_id,
      customer_name: customers.name,
      principal_amount_paise: girviLoans.principal_amount_paise,
      interest_rate_percentage: girviLoans.interest_rate_percentage,
      interest_type: girviLoans.interest_type,
      rate_period: girviLoans.rate_period,
      issue_date: girviLoans.issue_date,
      next_due_date: girviLoans.next_due_date,
      status: girviLoans.status,
      total_repaid_paise: girviLoans.total_repaid_paise,
      collateral_summary: sql<string | null>`group_concat(${girviCollateral.item_description}, ', ')`
    })
    .from(girviLoans)
    .innerJoin(customers, eq(girviLoans.customer_id, customers.id))
    .leftJoin(girviCollateral, eq(girviCollateral.loan_id, girviLoans.id))
    .where(whereClause)
    .groupBy(girviLoans.id)
    .all();

  return response.json({ loans });
});

// Suggest the next sequential loan/Pavati number (GRV-####).
girviRouter.get("/next-loan-number", (_request, response) => {
  return response.json({ loan_number: nextLoanNumber() });
});

// Loans past their statutory redemption period — the worklist for issuing auction
// notices before liquidating unredeemed pledges. Drives the "Auction Due" panel and
// the batch auction-notice PDF.
girviRouter.get("/auction-due", (request, response) => {
  const asOf = typeof request.query.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(request.query.as_of)
    ? request.query.as_of
    : new Date().toISOString().slice(0, 10);

  const settings = db.query.organizationSettings.findFirst().sync();
  const redemptionMonths = settings?.girvi_redemption_months ?? 12;

  const rows = db
    .select({ loan: girviLoans, customer_name: customers.name, phone: customers.phone })
    .from(girviLoans)
    .leftJoin(customers, eq(girviLoans.customer_id, customers.id))
    .where(eq(girviLoans.status, "ACTIVE"))
    .all();

  const due = rows
    .map((row) => {
      const deadline =
        row.loan.redemption_deadline ??
        format(addMonths(parseISO(row.loan.issue_date), redemptionMonths), "yyyy-MM-dd");
      if (deadline >= asOf) return null;

      const breakdown = calculateRepaymentBreakdown(row.loan, asOf);
      return {
        loan_id: row.loan.id,
        loan_number: row.loan.loan_number,
        customer_id: row.loan.customer_id,
        customer_name: row.customer_name ?? "Customer",
        phone: row.phone,
        issue_date: row.loan.issue_date,
        redemption_deadline: deadline,
        days_overdue: Math.max(differenceInCalendarDays(parseISO(asOf), parseISO(deadline)), 0),
        outstanding_principal_paise: breakdown.outstanding_principal_paise,
        accrued_interest_paise: breakdown.accrued_interest_paise,
        total_due_paise: breakdown.total_due_paise,
        total_due_rupees: paiseToRupees(breakdown.total_due_paise)
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((left, right) => right.days_overdue - left.days_overdue);

  return response.json({ as_of: asOf, count: due.length, loans: due });
});

girviRouter.post("/issue", requireAdmin, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const validation = validateIssuePayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const customer = db.query.customers.findFirst({
    where: eq(customers.id, validation.issue.customerId)
  }).sync();

  if (!customer) {
    return response.status(404).json({ errors: ["Customer not found."] });
  }

  if (customer.is_blacklisted) {
    return response.status(422).json({
      errors: [`Customer is blacklisted${customer.blacklist_reason ? `: ${customer.blacklist_reason}` : ""}. Loans cannot be issued.`]
    });
  }

  const duplicateLoan = db.query.girviLoans.findFirst({
    where: eq(girviLoans.loan_number, validation.issue.loanNumber)
  }).sync();

  if (duplicateLoan) {
    return response.status(409).json({ errors: ["A loan with this number already exists."] });
  }

  if (validation.issue.principalAmountPaise >= HIGH_VALUE_CASH_KYC_LIMIT_PAISE) {
    const hasKyc = Boolean(customer.pan_number?.trim() && customer.aadhaar_number?.trim() && customer.kyc_photo_path?.trim());

    if (!hasKyc) {
      return response.status(422).json({
        errors: ["PAN, Aadhaar, and KYC photo are required before issuing Girvi loans of Rs 2,00,000 or more."]
      });
    }
  }

  const disbursementLedger = db.query.ledgers.findFirst({
    where: eq(ledgers.id, validation.issue.disbursementLedgerId)
  }).sync();

  if (!disbursementLedger || (disbursementLedger.account_type !== "CASH" && disbursementLedger.account_type !== "BANK")) {
    return response.status(400).json({ errors: ["disbursement_ledger_id must be a CASH or BANK ledger."] });
  }

  const settings = db.query.organizationSettings.findFirst().sync();

  if (!settings) {
    return response.status(404).json({ errors: ["Organization settings not found."] });
  }

  const maxLoanPaise = calculateMaxLoanPaise(validation.issue.collateral, settings);

  if (validation.issue.principalAmountPaise > maxLoanPaise) {
    return response.status(422).json({
      errors: [`Principal exceeds 75% LTV. Maximum allowed is Rs ${paiseToRupees(maxLoanPaise)}.`]
    });
  }

  const result = db.transaction((tx) => {
    const loan = tx
      .insert(girviLoans)
      .values({
        customer_id: validation.issue.customerId,
        loan_number: validation.issue.loanNumber,
        principal_amount_paise: validation.issue.principalAmountPaise,
        interest_rate_percentage: validation.issue.interestRatePercentage,
        interest_type: validation.issue.interestType,
        rate_period: validation.issue.ratePeriod,
        interest_period_type: validation.issue.interestPeriodType,
        loan_letter_fee_paise: validation.issue.loanLetterFeePaise,
        notice_fee_paise: validation.issue.noticeFeePaise,
        customer_photo_path: validation.issue.customerPhotoPath,
        thumbprint_path: validation.issue.thumbprintPath,
        issue_date: validation.issue.issueDate,
        next_due_date: validation.issue.nextDueDate,
        // Default the auction-eligible date to issue date + the shop's statutory
        // redemption period when the caller doesn't supply one explicitly.
        redemption_deadline:
          validation.issue.redemptionDeadline ??
          format(addMonths(parseISO(validation.issue.issueDate), settings.girvi_redemption_months ?? 12), "yyyy-MM-dd"),
        created_by: authUser.id,
        status: "ACTIVE",
        total_repaid_paise: 0
      })
      .returning()
      .get();

    for (const collateral of validation.issue.collateral) {
      const { ratePaisePerGram, overridden } = resolveCollateralRatePaisePerGram(collateral, settings);
      tx.insert(girviCollateral)
        .values({
          loan_id: loan.id,
          item_description: collateral.itemDescription,
          metal_type: collateral.metalType,
          purity_karat: collateral.purityKarat,
          gross_weight_mg: collateral.grossWeightMg,
          stone_deduction_mg: collateral.stoneDeductionMg,
          weight_mg: collateral.weightMg,
          valuation_rate_paise_per_gram: ratePaisePerGram,
          rate_overridden: overridden,
          image_path: collateral.imagePath
        })
        .run();
    }

    const journalEntry = tx
      .insert(journalEntries)
      .values({
        ledger_id: validation.issue.disbursementLedgerId,
        transaction_type: "CREDIT",
        amount_paise: validation.issue.principalAmountPaise,
        reference_type: "GIRVI_ISSUE",
        reference_id: loan.id,
        description: `Girvi loan issued ${loan.loan_number}`
      })
      .returning()
      .get();

    tx.update(ledgers)
      .set({ balance_paise: disbursementLedger.balance_paise - validation.issue.principalAmountPaise })
      .where(eq(ledgers.id, validation.issue.disbursementLedgerId))
      .run();

    return { loan, journalEntry };
  });

  if (customer && customer.phone) {
    try {
      triggerMessage("GIRVI_LOAN_ISSUED", customer.id, customer.phone, {
        customer_name: customer.name,
        loan_number: result.loan.loan_number,
        amount: paiseToRupees(result.loan.principal_amount_paise),
        date: result.loan.issue_date,
        interest_rate: String(result.loan.interest_rate_percentage)
      });
    } catch (triggerErr) {
      console.error("Failed to trigger message for Girvi loan issue:", triggerErr);
    }
  }

  return response.status(201).json({
    loan: result.loan,
    journal_entry: result.journalEntry
  });
});

girviRouter.post("/repay/calculate", requireAdmin, (request, response) => {
  const validation = validateRepayCalculationPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const loan = db.query.girviLoans.findFirst({
    where: eq(girviLoans.id, validation.loanId)
  }).sync();

  if (!loan) {
    return response.status(404).json({ errors: ["Girvi loan not found."] });
  }

  const breakdown = calculateRepaymentBreakdown(loan, validation.intendedRepaymentDate);

  return response.json({ breakdown });
});

girviRouter.post("/repay", requireAdmin, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const validation = validateRepayPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const loan = db.query.girviLoans.findFirst({
    where: eq(girviLoans.id, validation.repayment.loanId)
  }).sync();

  if (!loan) {
    return response.status(404).json({ errors: ["Girvi loan not found."] });
  }

  if (loan.status !== "ACTIVE") {
    return response.status(409).json({ errors: ["Only active Girvi loans can be repaid."] });
  }

  const receiptLedger = db.query.ledgers.findFirst({
    where: eq(ledgers.id, validation.repayment.receiptLedgerId)
  }).sync();

  if (!receiptLedger || (receiptLedger.account_type !== "CASH" && receiptLedger.account_type !== "BANK")) {
    return response.status(400).json({ errors: ["receipt_ledger_id must be a CASH or BANK ledger."] });
  }

  const breakdown = calculateRepaymentBreakdown(loan, validation.repayment.paymentDate);

  const noticeFeePaidPaise = Math.min(validation.repayment.noticeFeePaidPaise, breakdown.notice_fee_due_paise);
  const loanLetterFeePaidPaise = Math.min(validation.repayment.loanLetterFeePaidPaise, breakdown.loan_letter_fee_due_paise);
  const discountPaise = validation.repayment.discountPaise;

  const maxInterestToPay = Math.max(0, breakdown.accrued_interest_paise - discountPaise);
  const interestAllocatedPaise = Math.min(
    Math.max(0, validation.repayment.amountPaise - noticeFeePaidPaise - loanLetterFeePaidPaise),
    maxInterestToPay
  );

  const principalAllocatedPaise = Math.min(
    Math.max(0, validation.repayment.amountPaise - noticeFeePaidPaise - loanLetterFeePaidPaise - interestAllocatedPaise),
    breakdown.outstanding_principal_paise
  );

  const nextTotalRepaidPaise = loan.total_repaid_paise + principalAllocatedPaise;
  const nextStatus = nextTotalRepaidPaise >= loan.principal_amount_paise ? "SETTLED" : "ACTIVE";

  const result = db.transaction((tx) => {
    const repayment = tx
      .insert(girviRepayments)
      .values({
        loan_id: validation.repayment.loanId,
        payment_date: validation.repayment.paymentDate,
        amount_paise: validation.repayment.amountPaise,
        interest_allocated_paise: interestAllocatedPaise,
        principal_allocated_paise: principalAllocatedPaise,
        discount_paise: discountPaise,
        notice_fee_paid_paise: noticeFeePaidPaise,
        loan_letter_fee_paid_paise: loanLetterFeePaidPaise,
        created_by: authUser.id
      })
      .returning()
      .get();

    tx.update(girviLoans)
      .set({
        total_repaid_paise: nextTotalRepaidPaise,
        status: nextStatus
      })
      .where(eq(girviLoans.id, validation.repayment.loanId))
      .run();

    const journalEntry = tx
      .insert(journalEntries)
      .values({
        ledger_id: validation.repayment.receiptLedgerId,
        transaction_type: "DEBIT",
        amount_paise: validation.repayment.amountPaise,
        reference_type: "GIRVI_REPAYMENT",
        reference_id: repayment.id,
        description: `Girvi repayment for ${loan.loan_number}`
      })
      .returning()
      .get();

    tx.update(ledgers)
      .set({ balance_paise: receiptLedger.balance_paise + validation.repayment.amountPaise })
      .where(eq(ledgers.id, validation.repayment.receiptLedgerId))
      .run();

    return { repayment, journalEntry };
  });

  try {
    const customerRow = db.query.customers.findFirst({
      where: eq(customers.id, loan.customer_id)
    }).sync();

    if (customerRow && customerRow.phone) {
      triggerMessage("GIRVI_REPAYMENT_RECEIVED", customerRow.id, customerRow.phone, {
        customer_name: customerRow.name,
        loan_number: loan.loan_number,
        amount: paiseToRupees(validation.repayment.amountPaise),
        date: validation.repayment.paymentDate
      });
    }
  } catch (triggerErr) {
    console.error("Failed to trigger message for Girvi repayment:", triggerErr);
  }

  return response.status(201).json({
    repayment: result.repayment,
    journal_entry: result.journalEntry,
    allocation: {
      interest_allocated_paise: interestAllocatedPaise,
      interest_allocated_rupees: paiseToRupees(interestAllocatedPaise),
      principal_allocated_paise: principalAllocatedPaise,
      principal_allocated_rupees: paiseToRupees(principalAllocatedPaise),
      discount_paise: discountPaise,
      discount_rupees: paiseToRupees(discountPaise),
      notice_fee_paid_paise: noticeFeePaidPaise,
      notice_fee_paid_rupees: paiseToRupees(noticeFeePaidPaise),
      loan_letter_fee_paid_paise: loanLetterFeePaidPaise,
      loan_letter_fee_paid_rupees: paiseToRupees(loanLetterFeePaidPaise)
    },
    status: nextStatus
  });
});

girviRouter.post("/loans/:id/default", requireAdmin, (request, response) => {
  const loanId = Number(request.params.id);
  if (!loanId || !Number.isInteger(loanId)) {
    return response.status(400).json({ errors: ["Loan ID must be a positive integer."] });
  }

  const loan = db.query.girviLoans.findFirst({
    where: eq(girviLoans.id, loanId)
  }).sync();

  if (!loan) {
    return response.status(404).json({ errors: ["Girvi loan not found."] });
  }

  const body = isRecord(request.body) ? request.body : {};
  const noticeFeePaise = typeof body.notice_fee_paise === "number" ? body.notice_fee_paise : 10000; // default Rs 100

  try {
    const updated = db.update(girviLoans)
      .set({
        status: "DEFAULTED",
        notice_fee_paise: loan.notice_fee_paise + noticeFeePaise
      })
      .where(eq(girviLoans.id, loanId))
      .returning()
      .get();

    return response.json({ loan: updated });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to mark loan as defaulted."] });
  }
});

girviRouter.post("/loans/:id/forfeit-transfer", requireAdmin, (request, response) => {
  const loanId = Number(request.params.id);
  if (!loanId || !Number.isInteger(loanId)) {
    return response.status(400).json({ errors: ["Loan ID must be a positive integer."] });
  }

  const loan = db.query.girviLoans.findFirst({
    where: eq(girviLoans.id, loanId)
  }).sync();

  if (!loan) {
    return response.status(404).json({ errors: ["Girvi loan not found."] });
  }

  const collateralList = db.select()
    .from(girviCollateral)
    .where(eq(girviCollateral.loan_id, loanId))
    .all();

  if (collateralList.length === 0) {
    return response.status(400).json({ errors: ["No collateral items found for this loan."] });
  }

  const totalWeight = collateralList.reduce((sum, item) => sum + item.weight_mg, 0);
  const todayStr = new Date().toISOString().slice(0, 10);

  try {
    const result = db.transaction((tx) => {
      // 1. Mark the loan as defaulted (or keep it defaulted but close balance if needed)
      const updatedLoan = tx.update(girviLoans)
        .set({ status: "DEFAULTED" })
        .where(eq(girviLoans.id, loanId))
        .returning()
        .get();

      // 2. Transfer collateral to inventory items
      const createdItems = collateralList.map((item, index) => {
        const purityKarat = item.purity_karat;
        const fineWeightMg = Math.round((item.weight_mg * purityKarat) / 24);
        const purchaseRatePaise = totalWeight > 0 
          ? Math.floor((loan.principal_amount_paise * item.weight_mg) / totalWeight) 
          : 0;

        return tx.insert(items)
          .values({
            barcode: `GRV-FORFEIT-${loan.loan_number}-${index + 1}`,
            huid: null,
            category: "Girvi Forfeited / Auction Stock",
            metal_type: item.metal_type,
            purity_karat: purityKarat,
            gross_weight_mg: item.weight_mg,
            stone_weight_mg: 0,
            black_bead_weight_mg: 0,
            net_weight_mg: item.weight_mg,
            final_weight_mg: item.weight_mg,
            fine_weight_mg: fineWeightMg,
            making_charge_type: "FLAT",
            making_charge_value: 0,
            design_name: item.item_description,
            tag_prefix: "GRV",
            location: "VAULT",
            purchase_rate_paise: purchaseRatePaise,
            purchase_date: todayStr,
            status: "IN_STOCK"
          })
          .returning()
          .get();
      });

      // 3. Post a journal entry for the forfeiture
      const stockLedger = tx.select().from(ledgers).where(eq(ledgers.account_name, "Forfeited Stock")).get()
        || tx.select().from(ledgers).where(eq(ledgers.account_type, "STOCK")).get()
        || tx.select().from(ledgers).where(eq(ledgers.id, 1)).get();

      if (stockLedger) {
        tx.insert(journalEntries)
          .values({
            ledger_id: stockLedger.id,
            transaction_type: "DEBIT",
            amount_paise: loan.principal_amount_paise,
            reference_type: "GIRVI_FORFEIT",
            reference_id: loan.id,
            description: `Seized collateral for loan ${loan.loan_number} transferred to stock`
          })
          .run();

        tx.update(ledgers)
          .set({ balance_paise: stockLedger.balance_paise + loan.principal_amount_paise })
          .where(eq(ledgers.id, stockLedger.id))
          .run();
      }

      return { loan: updatedLoan, items: createdItems };
    });

    return response.json({
      message: "Collateral forfeited and transferred to inventory successfully.",
      loan: result.loan,
      items: result.items
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to forfeit collateral."] });
  }
});

function calculateRepaymentBreakdown(loan: typeof girviLoans.$inferSelect, intendedRepaymentDate: string) {
  const lastRepayment = db.query.girviRepayments.findFirst({
    where: eq(girviRepayments.loan_id, loan.id),
    orderBy: desc(girviRepayments.payment_date)
  }).sync();
  const fromDate = lastRepayment?.payment_date ?? loan.issue_date;
  const outstandingPrincipalPaise = Math.max(loan.principal_amount_paise - loan.total_repaid_paise, 0);
  const elapsedDays = Math.max(daysBetween(fromDate, intendedRepaymentDate), 0);

  const periodType = loan.interest_period_type || loan.rate_period || "MONTHLY";
  const periodDays = periodType === "DAILY" ? 1 : periodType === "WEEKLY" ? 7 : periodType === "ANNUALLY" ? 365 : 30;

  const rateBasisPoints = Math.round(loan.interest_rate_percentage * 100);
  const accruedInterestPaise =
    loan.interest_type === "SIMPLE"
      ? calculateSimpleInterestPaise(outstandingPrincipalPaise, rateBasisPoints, elapsedDays, periodDays)
      : calculateCompoundInterestPaise(outstandingPrincipalPaise, rateBasisPoints, elapsedDays, periodDays);

  const repayments = db.select().from(girviRepayments).where(eq(girviRepayments.loan_id, loan.id)).all();
  const totalLetterFeePaid = repayments.reduce((sum, r) => sum + (r.loan_letter_fee_paid_paise ?? 0), 0);
  const totalNoticeFeePaid = repayments.reduce((sum, r) => sum + (r.notice_fee_paid_paise ?? 0), 0);
  const outstandingLetterFee = Math.max(0, loan.loan_letter_fee_paise - totalLetterFeePaid);
  const outstandingNoticeFee = Math.max(0, loan.notice_fee_paise - totalNoticeFeePaid);
  const outstandingFeesPaise = outstandingLetterFee + outstandingNoticeFee;

  return {
    loan_id: loan.id,
    from_date: fromDate,
    intended_repayment_date: intendedRepaymentDate,
    elapsed_days: elapsedDays,
    outstanding_principal_paise: outstandingPrincipalPaise,
    outstanding_principal_rupees: paiseToRupees(outstandingPrincipalPaise),
    accrued_interest_paise: accruedInterestPaise,
    accrued_interest_rupees: paiseToRupees(accruedInterestPaise),
    outstanding_fees_paise: outstandingFeesPaise,
    outstanding_fees_rupees: paiseToRupees(outstandingFeesPaise),
    loan_letter_fee_due_paise: outstandingLetterFee,
    loan_letter_fee_due_rupees: paiseToRupees(outstandingLetterFee),
    notice_fee_due_paise: outstandingNoticeFee,
    notice_fee_due_rupees: paiseToRupees(outstandingNoticeFee),
    total_due_paise: outstandingPrincipalPaise + accruedInterestPaise + outstandingFeesPaise,
    total_due_rupees: paiseToRupees(outstandingPrincipalPaise + accruedInterestPaise + outstandingFeesPaise)
  };
}

function calculateSimpleInterestPaise(principalPaise: number, rateBasisPoints: number, elapsedDays: number, periodDays: number) {
  return Math.round((principalPaise * rateBasisPoints * elapsedDays) / (10000 * periodDays));
}

function calculateCompoundInterestPaise(principalPaise: number, rateBasisPoints: number, elapsedDays: number, periodDays: number) {
  const dailyRate = rateBasisPoints / (10000 * periodDays);
  const compoundMultiplier = Math.pow(1 + dailyRate, elapsedDays);
  return Math.round(principalPaise * (compoundMultiplier - 1));
}

function calculateMaxLoanPaise(collateral: CollateralPayload[], settings: typeof organizationSettings.$inferSelect) {
  const totalCollateralValuePaise = collateral.reduce(
    (total, item) => total + calculateCollateralValuePaise(item, settings),
    0
  );

  return Math.floor((totalCollateralValuePaise * MAX_LTV_PERCENTAGE) / 100);
}

// Resolve the per-gram rate used to value a collateral item: an authorized admin override when
// supplied, otherwise the organisation's stored rate for that metal/purity. The override is what
// the jeweler observes as today's spot rate when the stored rate has drifted.
function resolveCollateralRatePaisePerGram(item: CollateralPayload, settings: typeof organizationSettings.$inferSelect) {
  if (item.rateOverridePaisePerGram !== null && item.rateOverridePaisePerGram > 0) {
    return { ratePaisePerGram: item.rateOverridePaisePerGram, overridden: true };
  }

  const metalType = item.metalType.toUpperCase();
  const ratePaisePerGram = metalType === "SILVER"
    ? settings.silver_rate_per_gram
    : getGoldRatePaisePerGram(item.purityKarat, settings);

  return { ratePaisePerGram, overridden: false };
}

function calculateCollateralValuePaise(item: CollateralPayload, settings: typeof organizationSettings.$inferSelect) {
  const { ratePaisePerGram } = resolveCollateralRatePaisePerGram(item, settings);

  // Value on NET metal weight (gross minus stone deduction) so stone-set pieces are not overvalued.
  return Math.floor((ratePaisePerGram * item.weightMg) / 1000);
}

function getGoldRatePaisePerGram(purityKarat: number, settings: typeof organizationSettings.$inferSelect) {
  if (purityKarat >= 24) return settings.gold_24k_rate_per_gram;
  if (purityKarat >= 22) return settings.gold_22k_rate_per_gram;
  if (purityKarat >= 18) return settings.gold_18k_rate_per_gram;

  return Math.floor((settings.gold_24k_rate_per_gram * purityKarat) / 24);
}

function nextLoanNumber(): string {
  const rows = db.select({ loanNumber: girviLoans.loan_number }).from(girviLoans).all();
  let max = 0;
  for (const row of rows) {
    const match = /^GRV-(\d+)$/.exec(row.loanNumber ?? "");
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `GRV-${String(max + 1).padStart(4, "0")}`;
}

function validateIssuePayload(body: unknown): IssueValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const customerId = requiredInteger(body.customer_id, "customer_id", errors);
  const principalAmountPaise = requiredPositiveInteger(body.principal_amount_paise, "principal_amount_paise", errors);
  const disbursementLedgerId = requiredInteger(body.disbursement_ledger_id, "disbursement_ledger_id", errors);
  // Loan/Pavati number auto-generates (sequential) when not supplied.
  const loanNumber = typeof body.loan_number === "string" && body.loan_number.trim()
    ? body.loan_number.trim().toUpperCase()
    : nextLoanNumber();
  const interestRatePercentage = requiredPositiveNumber(body.interest_rate_percentage, "interest_rate_percentage", errors);
  const interestType = body.interest_type;
  const ratePeriod = body.rate_period;
  const interestPeriodType = typeof body.interest_period_type === "string" && body.interest_period_type.trim()
    ? body.interest_period_type.trim().toUpperCase()
    : "MONTHLY";
  const loanLetterFeePaise = body.loan_letter_fee_paise !== undefined && body.loan_letter_fee_paise !== null
    ? requiredInteger(body.loan_letter_fee_paise, "loan_letter_fee_paise", errors)
    : 0;
  const noticeFeePaise = body.notice_fee_paise !== undefined && body.notice_fee_paise !== null
    ? requiredInteger(body.notice_fee_paise, "notice_fee_paise", errors)
    : 0;
  const customerPhotoPath = typeof body.customer_photo_path === "string" && body.customer_photo_path.trim()
    ? body.customer_photo_path.trim()
    : null;
  const thumbprintPath = typeof body.thumbprint_path === "string" && body.thumbprint_path.trim()
    ? body.thumbprint_path.trim()
    : null;
  const issueDate = requiredDate(body.issue_date, "issue_date", errors);
  const nextDueDate = optionalDate(body.next_due_date, "next_due_date", errors);
  const redemptionDeadline = optionalDate(body.redemption_deadline, "redemption_deadline", errors);
  const collateral = Array.isArray(body.collateral)
    ? body.collateral.map((item, index) => validateCollateral(item, index, errors))
    : [];

  if (!Array.isArray(body.collateral) || collateral.length === 0) {
    errors.push("collateral must include at least one item.");
  }

  if (!isInterestType(interestType)) {
    errors.push("interest_type must be SIMPLE or COMPOUND.");
  }

  if (!isRatePeriod(ratePeriod)) {
    errors.push("rate_period must be MONTHLY or ANNUALLY.");
  }

  if (interestPeriodType && !["DAILY", "WEEKLY", "MONTHLY", "ANNUALLY"].includes(interestPeriodType)) {
    errors.push("interest_period_type must be DAILY, WEEKLY, MONTHLY, or ANNUALLY.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    issue: {
      customerId,
      principalAmountPaise,
      disbursementLedgerId,
      loanNumber,
      interestRatePercentage,
      interestType: interestType as GirviInterestType,
      ratePeriod: ratePeriod as GirviRatePeriod,
      interestPeriodType,
      loanLetterFeePaise,
      noticeFeePaise,
      customerPhotoPath,
      thumbprintPath,
      issueDate,
      nextDueDate,
      redemptionDeadline,
      collateral
    }
  };
}

function validateRepayCalculationPayload(body: unknown): RepayCalculationValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const loanId = requiredInteger(body.loan_id, "loan_id", errors);
  const intendedRepaymentDate = requiredDate(body.intended_repayment_date, "intended_repayment_date", errors);

  return errors.length > 0 ? { ok: false, errors } : { ok: true, loanId, intendedRepaymentDate };
}

function validateRepayPayload(body: unknown): RepayValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const loanId = requiredInteger(body.loan_id, "loan_id", errors);
  const receiptLedgerId = requiredInteger(body.receipt_ledger_id, "receipt_ledger_id", errors);
  const amountPaise = requiredPositiveInteger(body.amount_paise, "amount_paise", errors);
  const paymentDate = requiredDate(body.payment_date, "payment_date", errors);
  const discountPaise = body.discount_paise !== undefined && body.discount_paise !== null
    ? requiredInteger(body.discount_paise, "discount_paise", errors)
    : 0;
  const noticeFeePaidPaise = body.notice_fee_paid_paise !== undefined && body.notice_fee_paid_paise !== null
    ? requiredInteger(body.notice_fee_paid_paise, "notice_fee_paid_paise", errors)
    : 0;
  const loanLetterFeePaidPaise = body.loan_letter_fee_paid_paise !== undefined && body.loan_letter_fee_paid_paise !== null
    ? requiredInteger(body.loan_letter_fee_paid_paise, "loan_letter_fee_paid_paise", errors)
    : 0;

  return errors.length > 0
    ? { ok: false, errors }
    : {
        ok: true,
        repayment: {
          loanId,
          receiptLedgerId,
          amountPaise,
          paymentDate,
          discountPaise,
          noticeFeePaidPaise,
          loanLetterFeePaidPaise
        }
      };
}

type IssueValidation =
  | {
      ok: true;
      issue: {
        customerId: number;
        principalAmountPaise: number;
        disbursementLedgerId: number;
        loanNumber: string;
        interestRatePercentage: number;
        interestType: GirviInterestType;
        ratePeriod: GirviRatePeriod;
        interestPeriodType: string;
        loanLetterFeePaise: number;
        noticeFeePaise: number;
        customerPhotoPath: string | null;
        thumbprintPath: string | null;
        issueDate: string;
        nextDueDate: string | null;
        redemptionDeadline: string | null;
        collateral: CollateralPayload[];
      };
    }
  | { ok: false; errors: string[] };

type RepayCalculationValidation =
  | { ok: true; loanId: number; intendedRepaymentDate: string }
  | { ok: false; errors: string[] };

type RepayValidation =
  | {
      ok: true;
      repayment: {
        loanId: number;
        receiptLedgerId: number;
        amountPaise: number;
        paymentDate: string;
        discountPaise: number;
        noticeFeePaidPaise: number;
        loanLetterFeePaidPaise: number;
      };
    }
  | { ok: false; errors: string[] };

type CollateralPayload = {
  itemDescription: string;
  metalType: string;
  purityKarat: number;
  grossWeightMg: number;
  stoneDeductionMg: number;
  weightMg: number;
  rateOverridePaisePerGram: number | null;
  imagePath: string | null;
};

function validateCollateral(item: unknown, index: number, errors: string[]): CollateralPayload {
  if (!isRecord(item)) {
    errors.push(`collateral[${index}] must be an object.`);
    return {
      itemDescription: "",
      metalType: "",
      purityKarat: 0,
      grossWeightMg: 0,
      stoneDeductionMg: 0,
      weightMg: 0,
      rateOverridePaisePerGram: null,
      imagePath: null
    };
  }

  // Prefer the explicit gross weight; fall back to the legacy single weight_mg field as the gross.
  const grossWeightMg = item.gross_weight_mg !== undefined && item.gross_weight_mg !== null
    ? requiredPositiveInteger(item.gross_weight_mg, `collateral[${index}].gross_weight_mg`, errors)
    : requiredPositiveInteger(item.weight_mg, `collateral[${index}].weight_mg`, errors);
  const stoneDeductionMg = item.stone_deduction_mg !== undefined && item.stone_deduction_mg !== null
    ? requiredNonNegativeInteger(item.stone_deduction_mg, `collateral[${index}].stone_deduction_mg`, errors)
    : 0;
  const weightMg = grossWeightMg - stoneDeductionMg;

  if (weightMg <= 0) {
    errors.push(`collateral[${index}] net weight (gross minus stone deduction) must be greater than zero.`);
  }

  const rateOverridePaisePerGram = item.rate_override_paise_per_gram !== undefined && item.rate_override_paise_per_gram !== null
    ? requiredPositiveInteger(item.rate_override_paise_per_gram, `collateral[${index}].rate_override_paise_per_gram`, errors)
    : null;

  return {
    itemDescription: requiredText(item.item_description, `collateral[${index}].item_description`, errors),
    metalType: requiredText(item.metal_type, `collateral[${index}].metal_type`, errors),
    purityKarat: requiredInteger(item.purity_karat, `collateral[${index}].purity_karat`, errors),
    grossWeightMg,
    stoneDeductionMg,
    weightMg: weightMg > 0 ? weightMg : 0,
    rateOverridePaisePerGram,
    imagePath: optionalText(item.image_path)
  };
}

function requiredText(value: unknown, field: string, errors: string[]) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${field} is required.`);
    return "";
  }

  return value.trim();
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requiredInteger(value: unknown, field: string, errors: string[]) {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    errors.push(`${field} must be an integer.`);
    return 0;
  }

  return value;
}

function requiredPositiveInteger(value: unknown, field: string, errors: string[]) {
  const parsed = requiredInteger(value, field, errors);

  if (parsed <= 0) {
    errors.push(`${field} must be greater than zero.`);
  }

  return parsed;
}

function requiredNonNegativeInteger(value: unknown, field: string, errors: string[]) {
  const parsed = requiredInteger(value, field, errors);

  if (parsed < 0) {
    errors.push(`${field} must be zero or greater.`);
  }

  return parsed;
}

function requiredPositiveNumber(value: unknown, field: string, errors: string[]) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push(`${field} must be a positive number.`);
    return 0;
  }

  return value;
}

function requiredDate(value: unknown, field: string, errors: string[]) {
  const date = optionalDate(value, field, errors);

  if (!date) {
    errors.push(`${field} is required as YYYY-MM-DD.`);
    return "";
  }

  return date;
}

function optionalDate(value: unknown, field: string, errors: string[]) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    errors.push(`${field} must be YYYY-MM-DD.`);
    return null;
  }

  return value;
}

function isInterestType(value: unknown): value is GirviInterestType {
  return value === "SIMPLE" || value === "COMPOUND";
}

function isRatePeriod(value: unknown): value is GirviRatePeriod {
  return value === "MONTHLY" || value === "ANNUALLY";
}

function isGirviStatus(value: string) {
  return value === "ACTIVE" || value === "SETTLED" || value === "DEFAULTED";
}

function daysBetween(fromDate: string, toDate: string) {
  return differenceInCalendarDays(parseISO(toDate), parseISO(fromDate));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
