import { desc, eq, inArray } from "drizzle-orm";
import { Router } from "express";
import { logAction } from "../audit/logAction.js";
import { requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { metalLoanFixings, metalLoans, suppliers } from "../db/schema.js";
import { postBalancedVoucher } from "../accounts/posting.js";
import { milligramsToGrams, paiseToRupees } from "../utils/decimal.js";

export const metalLoanRouter = Router();
metalLoanRouter.use(requireAuth);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function nextLoanNumber(): string {
  const rows = db.select({ n: metalLoans.loan_number }).from(metalLoans).all();
  let max = 0;
  for (const row of rows) {
    const match = /^ML-(\d+)$/.exec(row.n ?? "");
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `ML-${String(max + 1).padStart(4, "0")}`;
}

function deriveStatus(fineWeightMg: number, outstandingMg: number): "UNFIXED" | "PARTIALLY_FIXED" | "FIXED" {
  if (outstandingMg <= 0) return "FIXED";
  if (outstandingMg >= fineWeightMg) return "UNFIXED";
  return "PARTIALLY_FIXED";
}

function formatLoan(
  loan: typeof metalLoans.$inferSelect,
  supplierName: string | null,
  fixings: (typeof metalLoanFixings.$inferSelect)[]
) {
  return {
    ...loan,
    supplier_name: supplierName,
    gross_weight_g: milligramsToGrams(loan.gross_weight_mg),
    fine_weight_g: milligramsToGrams(loan.fine_weight_mg),
    fine_outstanding_g: milligramsToGrams(loan.fine_outstanding_mg),
    fine_fixed_g: milligramsToGrams(loan.fine_weight_mg - loan.fine_outstanding_mg),
    purity_percent: (loan.purity_basis_points / 100).toFixed(2),
    fixed_amount_rupees: paiseToRupees(loan.fixed_amount_paise),
    fixings: fixings.map((f) => ({
      ...f,
      fine_weight_fixed_g: milligramsToGrams(f.fine_weight_fixed_mg),
      rate_rupees_per_gram: paiseToRupees(f.rate_paise_per_gram),
      amount_rupees: paiseToRupees(f.amount_paise)
    }))
  };
}

metalLoanRouter.get("/next-number", (_req, res) => {
  return res.json({ loan_number: nextLoanNumber() });
});

// Aggregate fine-gram liability across all open loans — the "we owe X grams of fine gold" view.
metalLoanRouter.get("/summary", (_req, res) => {
  const rows = db.select().from(metalLoans).all();
  const outstandingFineMg = rows.reduce((sum, l) => sum + l.fine_outstanding_mg, 0);
  const openLoans = rows.filter((l) => l.status !== "FIXED").length;
  const fixedAmountPaise = rows.reduce((sum, l) => sum + l.fixed_amount_paise, 0);
  return res.json({
    open_loans: openLoans,
    total_loans: rows.length,
    fine_outstanding_mg: outstandingFineMg,
    fine_outstanding_g: milligramsToGrams(outstandingFineMg),
    fixed_amount_paise: fixedAmountPaise,
    fixed_amount_rupees: paiseToRupees(fixedAmountPaise)
  });
});

metalLoanRouter.get("/", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "";
  const valid = new Set(["UNFIXED", "PARTIALLY_FIXED", "FIXED"]);
  const loanRows = db
    .select()
    .from(metalLoans)
    .where(valid.has(status) ? eq(metalLoans.status, status as "UNFIXED") : undefined)
    .orderBy(desc(metalLoans.id))
    .all();

  const supplierIds = Array.from(new Set(loanRows.map((l) => l.supplier_id)));
  const supplierRows = supplierIds.length
    ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supplierIds)).all()
    : [];
  const supplierMap = new Map(supplierRows.map((s) => [s.id, s.name]));

  const loanIds = loanRows.map((l) => l.id);
  const fixingRows = loanIds.length
    ? db.select().from(metalLoanFixings).where(inArray(metalLoanFixings.loan_id, loanIds)).all()
    : [];
  const fixingsByLoan = new Map<number, (typeof metalLoanFixings.$inferSelect)[]>();
  for (const f of fixingRows) {
    const list = fixingsByLoan.get(f.loan_id) ?? [];
    list.push(f);
    fixingsByLoan.set(f.loan_id, list);
  }

  return res.json({
    loans: loanRows.map((l) => formatLoan(l, supplierMap.get(l.supplier_id) ?? null, fixingsByLoan.get(l.id) ?? []))
  });
});

metalLoanRouter.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ errors: ["Loan id must be a positive integer."] });
  }
  const loan = db.query.metalLoans.findFirst({ where: eq(metalLoans.id, id) }).sync();
  if (!loan) {
    return res.status(404).json({ errors: ["Metal loan not found."] });
  }
  const supplier = db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, loan.supplier_id)).get();
  const fixings = db.select().from(metalLoanFixings).where(eq(metalLoanFixings.loan_id, id)).all();
  return res.json({ loan: formatLoan(loan, supplier?.name ?? null, fixings) });
});

// Create a metal loan. Caller supplies gross weight + purity, or fine weight directly.
metalLoanRouter.post("/", (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const errors: string[] = [];

  const supplierId = Number(body.supplier_id);
  const metalType = typeof body.metal_type === "string" && body.metal_type.trim() ? body.metal_type.trim() : "Gold";
  const issueDate = typeof body.issue_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.issue_date) ? body.issue_date : todayIso();
  const grossWeightMg = Number.isInteger(Number(body.gross_weight_mg)) ? Number(body.gross_weight_mg) : 0;
  const purityBasisPoints = Number.isInteger(Number(body.purity_basis_points)) ? Number(body.purity_basis_points) : 9999;
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;

  // Fine weight: explicit, else derived from gross * purity.
  let fineWeightMg = Number.isInteger(Number(body.fine_weight_mg)) ? Number(body.fine_weight_mg) : 0;
  if (fineWeightMg <= 0 && grossWeightMg > 0) {
    fineWeightMg = Math.round((grossWeightMg * purityBasisPoints) / 10000);
  }

  if (!Number.isInteger(supplierId) || supplierId <= 0) errors.push("Select a supplier.");
  if (purityBasisPoints <= 0 || purityBasisPoints > 10000) errors.push("Purity must be between 0.01% and 100%.");
  if (fineWeightMg <= 0) errors.push("Enter a gross weight and purity (or the fine weight) for the loan.");

  if (errors.length === 0) {
    const supplier = db.query.suppliers.findFirst({ where: eq(suppliers.id, supplierId) }).sync();
    if (!supplier) errors.push("Supplier not found.");
  }

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  const userId = (req as unknown as AuthenticatedRequest).user.id;
  const loanNumber = nextLoanNumber();

  try {
    const loan = db.insert(metalLoans).values({
      loan_number: loanNumber,
      supplier_id: supplierId,
      metal_type: metalType,
      issue_date: issueDate,
      gross_weight_mg: grossWeightMg,
      purity_basis_points: purityBasisPoints,
      fine_weight_mg: fineWeightMg,
      fine_outstanding_mg: fineWeightMg,
      fixed_amount_paise: 0,
      status: "UNFIXED",
      notes,
      created_by: userId
    }).returning().get();

    logAction(userId, "CREATE_METAL_LOAN", "metal_loans", loan.id, null, { loan_number: loanNumber, fine_weight_mg: fineWeightMg });
    const supplier = db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, supplierId)).get();
    return res.status(201).json({ loan: formatLoan(loan, supplier?.name ?? null, []) });
  } catch (err: any) {
    return res.status(500).json({ errors: [err.message || "Failed to create metal loan."] });
  }
});

// Fix the rate for some (or all) outstanding fine grams at a given rate. Converts grams into a rupee value.
metalLoanRouter.post("/:id/fix", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ errors: ["Loan id must be a positive integer."] });
  }
  const loan = db.query.metalLoans.findFirst({ where: eq(metalLoans.id, id) }).sync();
  if (!loan) {
    return res.status(404).json({ errors: ["Metal loan not found."] });
  }

  const body = isRecord(req.body) ? req.body : {};
  const errors: string[] = [];
  const fixingDate = typeof body.fixing_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.fixing_date) ? body.fixing_date : todayIso();
  const ratePaisePerGram = Number(body.rate_paise_per_gram);
  const notes = typeof body.notes === "string" ? body.notes.trim() || null : null;
  // Fine weight to fix: explicit, or "fix all remaining" when fix_all is true.
  const fixAll = body.fix_all === true;
  let fineWeightFixedMg = Number.isInteger(Number(body.fine_weight_fixed_mg)) ? Number(body.fine_weight_fixed_mg) : 0;
  if (fixAll) fineWeightFixedMg = loan.fine_outstanding_mg;

  if (!Number.isInteger(ratePaisePerGram) || ratePaisePerGram <= 0) errors.push("Enter the rate per gram (in rupees).");
  if (!Number.isInteger(fineWeightFixedMg) || fineWeightFixedMg <= 0) errors.push("Enter the fine weight to fix (in grams).");
  if (fineWeightFixedMg > loan.fine_outstanding_mg) errors.push(`Cannot fix ${milligramsToGrams(fineWeightFixedMg)} g; only ${milligramsToGrams(loan.fine_outstanding_mg)} g outstanding.`);

  if (errors.length > 0) {
    return res.status(400).json({ errors });
  }

  // Amount = fine grams * rate-per-gram. fine_mg/1000 grams; round to paise.
  const amountPaise = Math.round((fineWeightFixedMg * ratePaisePerGram) / 1000);
  const newOutstanding = loan.fine_outstanding_mg - fineWeightFixedMg;
  const newStatus = deriveStatus(loan.fine_weight_mg, newOutstanding);
  const userId = (req as unknown as AuthenticatedRequest).user.id;
  const supplierRow = db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, loan.supplier_id)).get();
  const supplierName = supplierRow?.name ?? `Supplier ${loan.supplier_id}`;

  try {
    const result = db.transaction((tx) => {
      const fixing = tx.insert(metalLoanFixings).values({
        loan_id: id,
        fixing_date: fixingDate,
        fine_weight_fixed_mg: fineWeightFixedMg,
        rate_paise_per_gram: ratePaisePerGram,
        amount_paise: amountPaise,
        notes,
        created_by: userId
      }).returning().get();

      const updatedLoan = tx.update(metalLoans).set({
        fine_outstanding_mg: newOutstanding,
        fixed_amount_paise: loan.fixed_amount_paise + amountPaise,
        status: newStatus
      }).where(eq(metalLoans.id, id)).returning().get();

      // Fixing a rate crystallises a rupee payable to the supplier. Post it the same
      // way a credit purchase does — DEBIT the metal taken on loan (as stock), CREDIT
      // the shared "Vendor {name}" ledger — so the metal-loan payable shows up in the
      // same supplier-outstanding figure as purchase invoices. Posted in this tx so it
      // is atomic with the loan update. (Nothing posts at loan creation: until a rate is
      // fixed the debt is in grams of gold, not rupees.)
      postBalancedVoucher(tx, {
        voucherType: "METAL_LOAN_FIX",
        referenceType: "METAL_LOAN",
        referenceId: id,
        narration: `Metal loan rate fix ${loan.loan_number}`,
        createdBy: userId,
        lines: [
          {
            ledgerName: "Gold Metal Loan Stock",
            accountType: "STOCK",
            transactionType: "DEBIT",
            amountPaise,
            description: `Fixed ${fineWeightFixedMg} mg fine for ${loan.loan_number}`
          },
          {
            ledgerName: `Vendor ${supplierName}`,
            accountType: "VENDOR",
            transactionType: "CREDIT",
            amountPaise,
            description: `Metal loan payable ${loan.loan_number}`
          }
        ]
      });

      const allFixings = tx.select().from(metalLoanFixings).where(eq(metalLoanFixings.loan_id, id)).all();
      return { fixing, updatedLoan, allFixings };
    });

    logAction(userId, "FIX_METAL_LOAN_RATE", "metal_loans", id, null, { fine_weight_fixed_mg: fineWeightFixedMg, rate_paise_per_gram: ratePaisePerGram, amount_paise: amountPaise });
    return res.status(201).json({ loan: formatLoan(result.updatedLoan, supplierName, result.allFixings) });
  } catch (err: any) {
    return res.status(500).json({ errors: [err.message || "Failed to fix metal loan rate."] });
  }
});
