import { desc, eq, inArray, sql, or } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { logAction } from "../audit/logAction.js";
import { getOrCreateLedger } from "../accounts/posting.js";
import { db } from "../db/client.js";
import {
  jobOrders,
  jobReceipts,
  journalEntries,
  karigars,
  materialIssues,
  items,
  repairJobs,
  customers
} from "../db/schema.js";
import { paiseToRupees, milligramsToGrams } from "../utils/decimal.js";

class KarigarBalanceError extends Error {}

const DEFAULT_ACCEPTABLE_WASTAGE_BASIS_POINTS = 200;

export const karigarRouter = Router();

// ── Customer repair / custom-order intake ──────────────────────────────
const REPAIR_STATUSES = new Set(["RECEIVED", "WIP", "READY", "DELIVERED"]);

karigarRouter.post("/repairs", requireAuth, (request, response) => {
  const body = isRecord(request.body) ? request.body : {};
  const customerId = Number(body.customer_id);
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const intakeDate = typeof body.intake_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.intake_date)
    ? body.intake_date
    : new Date().toISOString().slice(0, 10);
  const deliveryDate = typeof body.delivery_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.delivery_date) ? body.delivery_date : null;
  const estimatedChargePaise = Number.isInteger(body.estimated_charge_paise) && (body.estimated_charge_paise as number) >= 0 ? body.estimated_charge_paise as number : 0;
  const karigarId = Number.isInteger(body.karigar_id) ? body.karigar_id as number : null;
  const intakePhotoPaths = typeof body.intake_photo_paths === "string" ? body.intake_photo_paths.trim() || null : null;

  if (!Number.isInteger(customerId) || customerId <= 0) {
    return response.status(400).json({ errors: ["customer_id must be a positive integer."] });
  }
  if (!description) {
    return response.status(400).json({ errors: ["description is required."] });
  }

  const customer = db.query.customers.findFirst({ where: eq(customers.id, customerId) }).sync();
  if (!customer) {
    return response.status(404).json({ errors: ["Customer not found."] });
  }
  if (karigarId !== null) {
    const karigar = db.query.karigars.findFirst({ where: eq(karigars.id, karigarId) }).sync();
    if (!karigar) {
      return response.status(404).json({ errors: ["Karigar not found."] });
    }
  }

  const repair = db.insert(repairJobs).values({
    customer_id: customerId,
    description,
    intake_photo_paths: intakePhotoPaths,
    status: "RECEIVED",
    estimated_charge_paise: estimatedChargePaise,
    karigar_id: karigarId,
    intake_date: intakeDate,
    delivery_date: deliveryDate
  }).returning().get();

  return response.status(201).json({ repair });
});

karigarRouter.get("/repairs", requireAuth, (request, response) => {
  const status = typeof request.query.status === "string" ? request.query.status.trim().toUpperCase() : "";
  const rows = status && REPAIR_STATUSES.has(status)
    ? db.select().from(repairJobs).where(eq(repairJobs.status, status as "RECEIVED" | "WIP" | "READY" | "DELIVERED")).all()
    : db.select().from(repairJobs).all();
  return response.json({ repairs: rows });
});

karigarRouter.patch("/repairs/:id/status", requireAuth, (request, response) => {
  const repairId = Number(request.params.id);
  if (!Number.isInteger(repairId) || repairId <= 0) {
    return response.status(400).json({ errors: ["Repair id must be a positive integer."] });
  }

  const body = isRecord(request.body) ? request.body : {};
  const nextStatus = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  if (!REPAIR_STATUSES.has(nextStatus)) {
    return response.status(400).json({ errors: ["status must be RECEIVED, WIP, READY, or DELIVERED."] });
  }

  const updates: Partial<typeof repairJobs.$inferInsert> = { status: nextStatus as "RECEIVED" | "WIP" | "READY" | "DELIVERED" };
  // Capture the final charge on delivery.
  if (nextStatus === "DELIVERED" && Number.isInteger(body.actual_charge_paise) && (body.actual_charge_paise as number) >= 0) {
    updates.actual_charge_paise = body.actual_charge_paise as number;
  }

  const repair = db.update(repairJobs).set(updates).where(eq(repairJobs.id, repairId)).returning().get();
  if (!repair) {
    return response.status(404).json({ errors: ["Repair job not found."] });
  }
  return response.json({ repair });
});

karigarRouter.get("/karigars", requireAuth, requireAdmin, (_request, response) => {
  const rows = db.select().from(karigars).all();

  return response.json({
    karigars: rows.map((karigar) => ({
      ...karigar,
      fine_gold_balance_grams: milligramsToGrams(karigar.fine_gold_balance_mg),
      cash_balance_rupees: paiseToRupees(karigar.cash_balance_paise)
    }))
  });
});

const KARIGAR_SPECIALTIES = new Set(["CASTING", "HANDMADE", "POLISH", "SETTING"]);

karigarRouter.post("/karigars", requireAuth, requireAdmin, (request, response) => {
  const authUser = (request as AuthenticatedRequest).user;
  const body = (request.body ?? {}) as { name?: unknown; phone?: unknown; specialty?: unknown };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const specialty = typeof body.specialty === "string" ? body.specialty.trim().toUpperCase() : "";

  const errors: string[] = [];
  if (!name) errors.push("name is required.");
  if (!phone) errors.push("phone is required.");
  if (!KARIGAR_SPECIALTIES.has(specialty)) {
    errors.push("specialty must be one of CASTING, HANDMADE, POLISH, SETTING.");
  }
  if (errors.length > 0) {
    return response.status(400).json({ errors });
  }

  const created = db
    .insert(karigars)
    .values({ name, phone, specialty: specialty as "CASTING" | "HANDMADE" | "POLISH" | "SETTING" })
    .returning()
    .get();

  logAction(authUser.id, "CREATE_KARIGAR", "karigars", created.id, null, { name, phone, specialty });

  return response.status(201).json({
    karigar: {
      ...created,
      fine_gold_balance_grams: milligramsToGrams(created.fine_gold_balance_mg),
      cash_balance_rupees: paiseToRupees(created.cash_balance_paise)
    }
  });
});

karigarRouter.get("/jobs", requireAuth, requireAdmin, (request, response) => {
  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  const rows = status && isJobStatus(status)
    ? db.select().from(jobOrders).where(eq(jobOrders.status, status)).all()
    : db.select().from(jobOrders).all();

  // Aggregate issued metal per job so the client can reconcile against the actual
  // issued fine gold (not the target finished weight).
  const jobIds = rows.map((job) => job.id);
  const issues = jobIds.length
    ? db.select().from(materialIssues).where(inArray(materialIssues.job_id, jobIds)).all()
    : [];
  const issuedByJob = new Map<number, { fine: number; gross: number }>();
  for (const issue of issues) {
    const agg = issuedByJob.get(issue.job_id) ?? { fine: 0, gross: 0 };
    agg.fine += issue.fine_gold_mg;
    agg.gross += issue.gross_weight_mg;
    issuedByJob.set(issue.job_id, agg);
  }

  return response.json({
    jobs: rows.map((job) => {
      const issued = issuedByJob.get(job.id) ?? { fine: 0, gross: 0 };
      return {
        ...job,
        target_purity_display: formatBasisPoints(job.target_purity),
        target_weight_grams: milligramsToGrams(job.target_weight_mg),
        issued_fine_mg: issued.fine,
        issued_gross_mg: issued.gross
      };
    })
  });
});

// Suggest the next sequential job/tracking slip number (JOB-####).
karigarRouter.get("/next-job-number", requireAuth, requireAdmin, (_request, response) => {
  return response.json({ order_number: nextJobNumber() });
});

karigarRouter.post("/jobs", requireAuth, requireAdmin, (request, response) => {
  const validation = validateJobPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const karigar = db.query.karigars.findFirst({
    where: eq(karigars.id, validation.job.karigarId)
  }).sync();

  if (!karigar) {
    return response.status(404).json({ errors: ["Karigar not found."] });
  }

  const job = db
    .insert(jobOrders)
    .values({
      order_number: validation.job.orderNumber,
      job_name: validation.job.jobName,
      karigar_id: validation.job.karigarId,
      customer_id: validation.job.customerId,
      design_image_path: validation.job.designImagePath,
      target_purity: validation.job.targetPurity,
      target_weight_mg: validation.job.targetWeightMg,
      status: "PENDING"
    })
    .returning()
    .get();

  return response.status(201).json({
    job: {
      ...job,
      target_purity_display: formatBasisPoints(job.target_purity),
      target_weight_grams: milligramsToGrams(job.target_weight_mg)
    }
  });
});

karigarRouter.post("/issue-metal", requireAuth, requireAdmin, (request, response) => {
  const validation = validateIssueMetalPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const job = db.query.jobOrders.findFirst({
    where: eq(jobOrders.id, validation.issue.jobId)
  }).sync();

  if (!job) {
    return response.status(404).json({ errors: ["Job order not found."] });
  }

  if (job.status === "COMPLETED" || job.status === "CANCELLED") {
    return response.status(409).json({ errors: ["Cannot issue metal to completed or cancelled jobs."] });
  }

  const karigar = db.query.karigars.findFirst({
    where: eq(karigars.id, job.karigar_id)
  }).sync();

  if (!karigar) {
    return response.status(404).json({ errors: ["Karigar not found."] });
  }

  const fineGoldMg = calculateFineGoldMg(validation.issue.grossWeightMg, validation.issue.purityTunch);
  const userId = (request as AuthenticatedRequest).user.id;

  const result = db.transaction((tx) => {
    const issue = tx
      .insert(materialIssues)
      .values({
        job_id: validation.issue.jobId,
        issue_date: validation.issue.issueDate,
        metal_type: validation.issue.metalType,
        purity_tunch: validation.issue.purityTunch,
        gross_weight_mg: validation.issue.grossWeightMg,
        fine_gold_mg: fineGoldMg,
        issued_by: userId
      })
      .returning()
      .get();

    tx.update(karigars)
      .set({ fine_gold_balance_mg: karigar.fine_gold_balance_mg + fineGoldMg })
      .where(eq(karigars.id, karigar.id))
      .run();

    if (job.status === "PENDING") {
      tx.update(jobOrders)
        .set({ status: "WIP" })
        .where(eq(jobOrders.id, job.id))
        .run();
    }

    return issue;
  });

  return response.status(201).json({
    issue: {
      ...result,
      purity_tunch_display: formatBasisPoints(result.purity_tunch),
      gross_weight_grams: milligramsToGrams(result.gross_weight_mg),
      fine_gold_grams: milligramsToGrams(result.fine_gold_mg)
    }
  });
});

karigarRouter.post("/receive-job", requireAuth, requireAdmin, (request, response) => {
  const validation = validateReceiveJobPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const job = db.query.jobOrders.findFirst({
    where: eq(jobOrders.id, validation.receipt.jobId)
  }).sync();

  if (!job) {
    return response.status(404).json({ errors: ["Job order not found."] });
  }

  if (job.status === "COMPLETED" || job.status === "CANCELLED") {
    return response.status(409).json({ errors: ["Cannot receive completed or cancelled jobs."] });
  }

  const karigar = db.query.karigars.findFirst({
    where: eq(karigars.id, job.karigar_id)
  }).sync();

  if (!karigar) {
    return response.status(404).json({ errors: ["Karigar not found."] });
  }

  const issues = db.select().from(materialIssues).where(eq(materialIssues.job_id, job.id)).all();
  const totalIssuedFineMg = issues.reduce((total, issue) => total + issue.fine_gold_mg, 0);
  const totalIssuedGrossMg = issues.reduce((total, issue) => total + issue.gross_weight_mg, 0);

  if (totalIssuedFineMg <= 0) {
    return response.status(409).json({ errors: ["No issued fine-gold balance exists for this job."] });
  }

  const finishedFineGoldMg = calculateFineGoldMg(validation.receipt.finalNetWeightMg, job.target_purity);
  const scrapFineGoldMg = calculateFineGoldMg(validation.receipt.scrapReturnedMg, validation.receipt.scrapPurityTunch);
  const returnedFineGoldMg = finishedFineGoldMg + scrapFineGoldMg;
  const actualLossMg = Math.max(totalIssuedFineMg - returnedFineGoldMg, 0);
  // PER_GRAM allowance: mg of loss per gram of issued gross metal. PERCENTAGE: basis points of issued fine gold.
  const acceptableLossMg = validation.receipt.acceptableLossMg
    ?? (validation.receipt.wastageMode === "PER_GRAM"
      ? Math.floor((validation.receipt.wastageValue * totalIssuedGrossMg) / 1000)
      : calculateAcceptableLossMg(totalIssuedFineMg, validation.receipt.wastageValue));
  const excessLossMg = Math.max(0, actualLossMg - acceptableLossMg);
  const isAnomaly = excessLossMg > 0;
  const fineGoldDebitedMg = Math.min(totalIssuedFineMg, returnedFineGoldMg + acceptableLossMg + excessLossMg);
  const userId = (request as AuthenticatedRequest).user.id;

  const result = db.transaction((tx) => {
    const receipt = tx
      .insert(jobReceipts)
      .values({
        job_id: job.id,
        receive_date: validation.receipt.receiveDate,
        final_gross_weight_mg: validation.receipt.finalGrossWeightMg,
        final_net_weight_mg: validation.receipt.finalNetWeightMg,
        scrap_returned_mg: validation.receipt.scrapReturnedMg,
        scrap_purity_tunch: validation.receipt.scrapPurityTunch,
        wastage_mode: validation.receipt.wastageMode,
        wastage_value: validation.receipt.wastageValue,
        acceptable_loss_mg: acceptableLossMg,
        actual_loss_mg: actualLossMg,
        excess_loss_mg: excessLossMg,
        is_anomaly: isAnomaly,
        fine_gold_debited_mg: fineGoldDebitedMg,
        labor_charge_paise: validation.receipt.laborChargePaise,
        received_by: userId
      })
      .returning()
      .get();

    tx.update(karigars)
      .set({
        fine_gold_balance_mg: karigar.fine_gold_balance_mg - fineGoldDebitedMg,
        cash_balance_paise: karigar.cash_balance_paise + validation.receipt.laborChargePaise
      })
      .where(eq(karigars.id, karigar.id))
      .run();

    if (excessLossMg > 0) {
      tx.update(karigars)
        .set({ fine_gold_balance_mg: sql`fine_gold_balance_mg + ${excessLossMg}` })
        .where(eq(karigars.id, karigar.id))
        .run();
    }

    tx.update(jobOrders)
      .set({ status: "COMPLETED" })
      .where(eq(jobOrders.id, job.id))
      .run();

    return receipt;
  });

  return response.status(201).json({
    receipt: {
      ...result,
      final_gross_weight_grams: milligramsToGrams(result.final_gross_weight_mg),
      final_net_weight_grams: milligramsToGrams(result.final_net_weight_mg),
      scrap_returned_grams: milligramsToGrams(result.scrap_returned_mg),
      scrap_purity_tunch_display: formatBasisPoints(result.scrap_purity_tunch),
      acceptable_loss_grams: milligramsToGrams(result.acceptable_loss_mg),
      actual_loss_grams: milligramsToGrams(result.actual_loss_mg),
      excess_loss_grams: milligramsToGrams(result.excess_loss_mg),
      fine_gold_debited_grams: milligramsToGrams(result.fine_gold_debited_mg),
      labor_charge_rupees: paiseToRupees(result.labor_charge_paise),
      loss_exceeded: result.is_anomaly
    }
  });
});

karigarRouter.patch("/jobs/:id/cancel", requireAuth, requireAdmin, (request, response) => {
  const jobId = Number(request.params.id);

  if (!Number.isInteger(jobId) || jobId <= 0) {
    return response.status(400).json({ errors: ["Job id must be a positive integer."] });
  }

  const body = isRecord(request.body) ? request.body : {};
  const reason = typeof body.cancellation_reason === "string" && body.cancellation_reason.trim()
    ? body.cancellation_reason.trim()
    : typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null;

  const job = db.query.jobOrders.findFirst({
    where: eq(jobOrders.id, jobId)
  }).sync();

  if (!job) {
    return response.status(404).json({ errors: ["Job order not found."] });
  }

  // Only in-flight jobs can be cancelled. Completed/already-cancelled are terminal.
  if (job.status !== "PENDING" && job.status !== "WIP") {
    return response.status(409).json({ errors: ["Only PENDING or WIP job orders can be cancelled."] });
  }

  const karigar = db.query.karigars.findFirst({
    where: eq(karigars.id, job.karigar_id)
  }).sync();

  if (!karigar) {
    return response.status(404).json({ errors: ["Karigar not found."] });
  }

  const issues = db.select().from(materialIssues).where(eq(materialIssues.job_id, job.id)).all();
  const totalIssuedFineGoldMg = issues.reduce((total, issue) => total + issue.fine_gold_mg, 0);
  const userId = (request as AuthenticatedRequest).user.id;
  const previousStatus = job.status;

  let cancelledJob: typeof jobOrders.$inferSelect;
  try {
    cancelledJob = db.transaction((tx) => {
      // Return issued metal: decrement karigar's fine-gold liability back to vault.
      if (totalIssuedFineGoldMg > 0) {
        const newBalanceMg = karigar.fine_gold_balance_mg - totalIssuedFineGoldMg;

        if (newBalanceMg < 0) {
          throw new KarigarBalanceError("Karigar fine-gold balance is insufficient to return the issued metal.");
        }

        tx.update(karigars)
          .set({ fine_gold_balance_mg: newBalanceMg })
          .where(eq(karigars.id, karigar.id))
          .run();

        // Record the metal return in the accounting journal. This subsystem tracks
        // gold by weight (mg), not paise, so the monetary amount is zero and the
        // returned fine-gold weight is captured in the description for audit.
        const stockLedger = getOrCreateLedger(tx, "Karigar Metal In Process", "STOCK", null);
        tx.insert(journalEntries)
          .values({
            ledger_id: stockLedger.id,
            transaction_type: "CREDIT",
            amount_paise: 0,
            reference_type: "JOB_CANCELLATION",
            reference_id: job.id,
            description: `Metal return on cancellation of ${job.order_number}: ${totalIssuedFineGoldMg} mg fine gold returned from karigar #${karigar.id} to vault.`
          })
          .run();
      }

      return tx
        .update(jobOrders)
        .set({ status: "CANCELLED", cancellation_reason: reason })
        .where(eq(jobOrders.id, job.id))
        .returning()
        .get();
    });
  } catch (err) {
    if (err instanceof KarigarBalanceError) {
      return response.status(422).json({
        error: "KARIGAR_BALANCE_INSUFFICIENT",
        message: err.message
      });
    }
    throw err;
  }

  logAction(userId, "CANCEL_JOB_ORDER", "job_orders", job.id,
    { status: previousStatus },
    {
      status: "CANCELLED",
      cancellation_reason: reason,
      returned_fine_gold_mg: totalIssuedFineGoldMg
    }
  );

  return response.json({
    job: {
      ...cancelledJob,
      target_purity_display: formatBasisPoints(cancelledJob.target_purity),
      target_weight_grams: milligramsToGrams(cancelledJob.target_weight_mg)
    },
    returned_fine_gold_mg: totalIssuedFineGoldMg,
    returned_fine_gold_grams: milligramsToGrams(totalIssuedFineGoldMg)
  });
});

karigarRouter.get("/ledger/:id", requireAuth, requireAdmin, (request, response) => {
  const karigarId = Number(request.params.id);

  if (!Number.isInteger(karigarId)) {
    return response.status(400).json({ errors: ["Karigar id must be an integer."] });
  }

  const karigar = db.query.karigars.findFirst({
    where: eq(karigars.id, karigarId)
  }).sync();

  if (!karigar) {
    return response.status(404).json({ errors: ["Karigar not found."] });
  }

  const jobs = db.select().from(jobOrders).where(eq(jobOrders.karigar_id, karigarId)).all();
  const jobIds = jobs.map((job) => job.id);
  const issues = jobs.length === 0
    ? []
    : db
        .select()
        .from(materialIssues)
        .where(inArray(materialIssues.job_id, jobIds))
        .orderBy(desc(materialIssues.issue_date))
        .all();
  const receipts = jobs.length === 0
    ? []
    : db
        .select()
        .from(jobReceipts)
        .where(inArray(jobReceipts.job_id, jobIds))
        .orderBy(desc(jobReceipts.receive_date))
        .all();

  const timeline = [
    ...issues.map((issue) => ({
      type: "MATERIAL_ISSUE" as const,
      date: issue.issue_date,
      job_id: issue.job_id,
      fine_gold_delta_mg: issue.fine_gold_mg,
      cash_delta_paise: 0,
      details: {
        gross_weight_mg: issue.gross_weight_mg,
        gross_weight_grams: milligramsToGrams(issue.gross_weight_mg),
        purity_tunch: formatBasisPoints(issue.purity_tunch),
        fine_gold_mg: issue.fine_gold_mg,
        fine_gold_grams: milligramsToGrams(issue.fine_gold_mg)
      }
    })),
    ...receipts.map((receipt) => ({
      type: "JOB_RECEIPT" as const,
      date: receipt.receive_date,
      job_id: receipt.job_id,
      fine_gold_delta_mg: -receipt.fine_gold_debited_mg,
      cash_delta_paise: receipt.labor_charge_paise,
      details: {
        id: receipt.id,
        final_net_weight_mg: receipt.final_net_weight_mg,
        final_net_weight_grams: milligramsToGrams(receipt.final_net_weight_mg),
        final_gross_weight_mg: receipt.final_gross_weight_mg,
        final_gross_weight_grams: milligramsToGrams(receipt.final_gross_weight_mg),
        actual_loss_mg: receipt.actual_loss_mg,
        actual_loss_grams: milligramsToGrams(receipt.actual_loss_mg),
        excess_loss_mg: receipt.excess_loss_mg,
        excess_loss_grams: milligramsToGrams(receipt.excess_loss_mg),
        is_anomaly: receipt.is_anomaly,
        acceptable_loss_mg: receipt.acceptable_loss_mg,
        acceptable_loss_grams: milligramsToGrams(receipt.acceptable_loss_mg),
        labor_charge_paise: receipt.labor_charge_paise,
        labor_charge_rupees: paiseToRupees(receipt.labor_charge_paise),
        is_transferred: receipt.is_transferred
      }
    }))
  ].sort((left, right) => right.date.localeCompare(left.date));

  return response.json({
    karigar: {
      ...karigar,
      fine_gold_balance_grams: milligramsToGrams(karigar.fine_gold_balance_mg),
      cash_balance_rupees: paiseToRupees(karigar.cash_balance_paise)
    },
    jobs,
    timeline
  });
});

karigarRouter.post("/jobs/:id/transfer-to-barcode", requireAuth, requireAdmin, (request, response) => {
  const jobId = Number(request.params.id);

  if (!Number.isInteger(jobId)) {
    return response.status(400).json({ errors: ["Job id must be an integer."] });
  }

  const job = db.query.jobOrders.findFirst({
    where: eq(jobOrders.id, jobId)
  }).sync();

  if (!job) {
    return response.status(404).json({ errors: ["Job order not found."] });
  }

  if (job.status !== "COMPLETED") {
    return response.status(409).json({ errors: ["Only completed jobs can be transferred to barcode stock."] });
  }

  const receipt = db.query.jobReceipts.findFirst({
    where: eq(jobReceipts.job_id, jobId)
  }).sync();

  if (!receipt) {
    return response.status(404).json({ errors: ["Job receipt not found."] });
  }

  if (receipt.is_transferred) {
    return response.status(409).json({ errors: ["This job receipt has already been transferred to barcode stock."] });
  }

  const body = isRecord(request.body) ? request.body : {};
  const errors: string[] = [];

  const barcode = typeof body.barcode === "string" ? body.barcode.trim().toUpperCase() : "";
  const huid = typeof body.huid === "string" && body.huid.trim() ? body.huid.trim().toUpperCase() : null;
  const category = typeof body.category === "string" ? body.category.trim().toUpperCase() : "";
  const makingChargeType = typeof body.making_charge_type === "string" ? body.making_charge_type.trim().toUpperCase() : "";
  const makingChargeValue = body.making_charge_value;
  const designName = typeof body.design_name === "string" && body.design_name.trim() ? body.design_name.trim() : null;

  if (!barcode) {
    errors.push("barcode is required.");
  }
  if (!category) {
    errors.push("category is required.");
  }
  if (!makingChargeType || (makingChargeType !== "PER_GRAM" && makingChargeType !== "FLAT")) {
    errors.push("making_charge_type must be PER_GRAM or FLAT.");
  }
  if (!Number.isInteger(makingChargeValue) || (makingChargeValue as number) < 0) {
    errors.push("making_charge_value must be a non-negative integer in paise.");
  }
  if (huid && !/^[A-Z0-9]{6}$/.test(huid)) {
    errors.push("huid must be exactly 6 uppercase alphanumeric characters.");
  }

  if (errors.length > 0) {
    return response.status(400).json({ errors });
  }

  const duplicate = db.query.items.findFirst({
    where: huid
      ? or(eq(items.barcode, barcode), eq(items.huid, huid))
      : eq(items.barcode, barcode)
  }).sync();

  if (duplicate) {
    return response.status(409).json({ errors: ["An item already exists with this barcode or HUID."] });
  }

  const materialIssue = db.query.materialIssues.findFirst({
    where: eq(materialIssues.job_id, jobId)
  }).sync();
  const metalType = materialIssue ? materialIssue.metal_type : "GOLD";

  const targetPurity = job.target_purity;
  const purityKarat = Math.round((targetPurity * 24) / 10000);
  const netWeightMg = receipt.final_net_weight_mg;
  const grossWeightMg = receipt.final_gross_weight_mg;
  const stoneWeightMg = Math.max(0, grossWeightMg - netWeightMg);
  const fineWeightMg = Math.round((netWeightMg * targetPurity) / 10000);

  try {
    const newItem = db.transaction((tx) => {
      const inserted = tx.insert(items)
        .values({
          barcode,
          huid,
          category,
          metal_type: metalType,
          purity_karat: purityKarat,
          gross_weight_mg: grossWeightMg,
          stone_weight_mg: stoneWeightMg,
          black_bead_weight_mg: 0,
          net_weight_mg: netWeightMg,
          final_weight_mg: netWeightMg,
          fine_weight_mg: fineWeightMg,
          making_charge_type: makingChargeType,
          making_charge_value: makingChargeValue as number,
          design_name: designName || job.order_number,
          status: "IN_STOCK"
        })
        .returning()
        .get();

      tx.update(jobReceipts)
        .set({ is_transferred: true })
        .where(eq(jobReceipts.id, receipt.id))
        .run();

      return inserted;
    });

    return response.status(201).json({
      message: "Transferred to barcode stock successfully.",
      item: newItem
    });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to transfer job to barcode stock."] });
  }
});

type IssueMetalValidation =
  | {
      ok: true;
      issue: {
        jobId: number;
        issueDate: string;
        metalType: string;
        grossWeightMg: number;
        purityTunch: number;
      };
    }
  | { ok: false; errors: string[] };

type ReceiveJobValidation =
  | {
      ok: true;
      receipt: {
        jobId: number;
        receiveDate: string;
        finalGrossWeightMg: number;
        finalNetWeightMg: number;
        scrapReturnedMg: number;
        scrapPurityTunch: number;
        acceptableLossMg: number | null;
        wastageMode: "PERCENTAGE" | "PER_GRAM";
        wastageValue: number;
        laborChargePaise: number;
      };
    }
  | { ok: false; errors: string[] };

type JobValidation =
  | {
      ok: true;
      job: {
        orderNumber: string;
        jobName: string | null;
        karigarId: number;
        customerId: number | null;
        designImagePath: string | null;
        targetPurity: number;
        targetWeightMg: number;
      };
    }
  | { ok: false; errors: string[] };

function validateJobPayload(body: unknown): JobValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  // Tracking slip auto-generates sequentially (JOB-####) when not supplied.
  const orderNumber = typeof body.order_number === "string" && body.order_number.trim()
    ? body.order_number.trim().toUpperCase()
    : nextJobNumber();
  const jobName = typeof body.job_name === "string" && body.job_name.trim() ? body.job_name.trim() : null;
  const karigarId = body.karigar_id;
  const customerId = body.customer_id === undefined || body.customer_id === null ? null : body.customer_id;
  const designImagePath = typeof body.design_image_path === "string" && body.design_image_path.trim()
    ? body.design_image_path.trim()
    : null;
  const targetPurity = parseTunchBasisPoints(body.target_purity);
  const targetWeightMg = body.target_weight_mg;

  if (!/^[A-Z0-9-]{3,40}$/.test(orderNumber)) {
    errors.push("order_number must be 3 to 40 alphanumeric characters or hyphens.");
  }

  if (!Number.isInteger(karigarId)) {
    errors.push("karigar_id must be an integer.");
  }

  if (customerId !== null && !Number.isInteger(customerId)) {
    errors.push("customer_id must be an integer when provided.");
  }

  if (targetPurity === null || targetPurity <= 0 || targetPurity > 10000) {
    errors.push("target_purity must be a decimal percentage between 0 and 100.");
  }

  if (!Number.isInteger(targetWeightMg) || (targetWeightMg as number) <= 0) {
    errors.push("target_weight_mg must be a positive integer.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    job: {
      orderNumber,
      jobName,
      karigarId: karigarId as number,
      customerId: customerId as number | null,
      designImagePath,
      targetPurity: targetPurity as number,
      targetWeightMg: targetWeightMg as number
    }
  };
}

function nextJobNumber(): string {
  const rows = db.select({ orderNumber: jobOrders.order_number }).from(jobOrders).all();
  let max = 0;
  for (const row of rows) {
    const match = /^JOB-(\d+)$/.exec(row.orderNumber ?? "");
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `JOB-${String(max + 1).padStart(4, "0")}`;
}

function validateIssueMetalPayload(body: unknown): IssueMetalValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const jobId = body.job_id;
  const grossWeightMg = body.gross_weight_mg;
  const purityTunch = parseTunchBasisPoints(body.purity_tunch);
  const issueDate = typeof body.issue_date === "string" && isDate(body.issue_date) ? body.issue_date : getToday();
  const metalType = typeof body.metal_type === "string" && body.metal_type.trim() ? body.metal_type.trim().toUpperCase() : "GOLD";

  if (!Number.isInteger(jobId)) {
    errors.push("job_id must be an integer.");
  }

  if (!Number.isInteger(grossWeightMg) || (grossWeightMg as number) <= 0) {
    errors.push("gross_weight_mg must be a positive integer.");
  }

  if (purityTunch === null || purityTunch <= 0 || purityTunch > 10000) {
    errors.push("purity_tunch must be a decimal percentage between 0 and 100.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    issue: {
      jobId: jobId as number,
      issueDate,
      metalType,
      grossWeightMg: grossWeightMg as number,
      purityTunch: purityTunch as number
    }
  };
}

function validateReceiveJobPayload(body: unknown): ReceiveJobValidation {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }

  const jobId = body.job_id;
  const finalGrossWeightMg = body.final_gross_weight_mg;
  const finalNetWeightMg = body.final_net_weight_mg;
  const scrapReturnedMg = body.scrap_returned_mg;
  const scrapPurityTunch = body.scrap_purity_tunch === undefined || body.scrap_purity_tunch === null
    ? 10000
    : parseTunchBasisPoints(body.scrap_purity_tunch);
  const acceptableLossMg = body.acceptable_loss_mg === undefined || body.acceptable_loss_mg === null ? null : body.acceptable_loss_mg;
  // Wastage allowance: PERCENTAGE (value held as basis points) or PER_GRAM (value held as mg of loss per gram).
  // Falls back to the legacy acceptable_wastage_percentage field when no explicit mode is supplied.
  const wastageModeRaw = typeof body.wastage_mode === "string" ? body.wastage_mode.trim().toUpperCase() : "";
  let wastageMode: "PERCENTAGE" | "PER_GRAM" = "PERCENTAGE";
  let wastageValue: number | null;
  if (wastageModeRaw === "PER_GRAM") {
    wastageMode = "PER_GRAM";
    wastageValue = parseGramsToMg(body.wastage_value);
    if (wastageValue === null || wastageValue < 0) {
      errors.push("wastage_value must be a non-negative gram amount (loss per gram) for PER_GRAM mode.");
    }
  } else if (wastageModeRaw === "PERCENTAGE") {
    wastageValue = parseTunchBasisPoints(body.wastage_value);
    if (wastageValue === null || wastageValue < 0 || wastageValue > 10000) {
      errors.push("wastage_value must be a decimal percentage between 0 and 100 for PERCENTAGE mode.");
    }
  } else {
    wastageValue = body.acceptable_wastage_percentage === undefined || body.acceptable_wastage_percentage === null
      ? DEFAULT_ACCEPTABLE_WASTAGE_BASIS_POINTS
      : parseTunchBasisPoints(body.acceptable_wastage_percentage);
    if (wastageValue === null || wastageValue < 0 || wastageValue > 10000) {
      errors.push("acceptable_wastage_percentage must be a decimal percentage between 0 and 100.");
    }
  }
  const laborChargePaise = body.labor_charge_paise;
  const receiveDate = typeof body.receive_date === "string" && isDate(body.receive_date) ? body.receive_date : getToday();

  if (!Number.isInteger(jobId)) {
    errors.push("job_id must be an integer.");
  }

  if (!Number.isInteger(finalGrossWeightMg) || (finalGrossWeightMg as number) <= 0) {
    errors.push("final_gross_weight_mg must be a positive integer.");
  }

  if (!Number.isInteger(finalNetWeightMg) || (finalNetWeightMg as number) <= 0) {
    errors.push("final_net_weight_mg must be a positive integer.");
  }

  if (Number.isInteger(finalGrossWeightMg) && Number.isInteger(finalNetWeightMg) && (finalNetWeightMg as number) > (finalGrossWeightMg as number)) {
    errors.push("final_net_weight_mg cannot exceed final_gross_weight_mg.");
  }

  if (!Number.isInteger(scrapReturnedMg) || (scrapReturnedMg as number) < 0) {
    errors.push("scrap_returned_mg must be a non-negative integer.");
  }

  if (scrapPurityTunch === null || scrapPurityTunch <= 0 || scrapPurityTunch > 10000) {
    errors.push("scrap_purity_tunch must be a decimal percentage between 0 and 100.");
  }

  if (acceptableLossMg !== null && (!Number.isInteger(acceptableLossMg) || (acceptableLossMg as number) < 0)) {
    errors.push("acceptable_loss_mg must be a non-negative integer when provided.");
  }

  if (!Number.isInteger(laborChargePaise) || (laborChargePaise as number) < 0) {
    errors.push("labor_charge_paise must be a non-negative integer.");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    receipt: {
      jobId: jobId as number,
      receiveDate,
      finalGrossWeightMg: finalGrossWeightMg as number,
      finalNetWeightMg: finalNetWeightMg as number,
      scrapReturnedMg: scrapReturnedMg as number,
      scrapPurityTunch: scrapPurityTunch as number,
      acceptableLossMg: acceptableLossMg as number | null,
      wastageMode,
      wastageValue: (wastageValue ?? 0) as number,
      laborChargePaise: laborChargePaise as number
    }
  };
}

function calculateFineGoldMg(grossWeightMg: number, purityBasisPoints: number) {
  return Math.floor((grossWeightMg * purityBasisPoints) / 10000);
}

function calculateAcceptableLossMg(totalIssuedFineMg: number, acceptableWastageBasisPoints: number) {
  return Math.floor((totalIssuedFineMg * acceptableWastageBasisPoints) / 10000);
}

function parseTunchBasisPoints(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const match = String(value).trim().match(/^(\d{1,3})(?:\.(\d{1,2}))?$/);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
}

// Parse a decimal gram amount (e.g. "0.200") into integer milligrams (200).
function parseGramsToMg(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,3}))?$/);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 1000 + Number((match[2] ?? "").padEnd(3, "0") || "0");
}

function formatBasisPoints(value: number) {
  const whole = Math.trunc(value / 100);
  const decimal = String(value % 100).padStart(2, "0");

  return `${whole}.${decimal}`;
}

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

function isJobStatus(value: string): value is "PENDING" | "WIP" | "COMPLETED" | "CANCELLED" {
  return value === "PENDING" || value === "WIP" || value === "COMPLETED" || value === "CANCELLED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
