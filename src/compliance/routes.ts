import { and, eq, gte, lte, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { bisSubmissionItems, bisSubmissions, gstAuditPeriodLocks, huidLifecycleEvents, items } from "../db/schema.js";
import { findActiveGstLockForDate } from "./auditLocks.js";
import { buildB2bB2cRows, buildGstr3bSummary, buildHsnRows, validateDateRange } from "./gstReportData.js";

export const complianceRouter = Router();

complianceRouter.get("/gst-export/gstr1", requireAuth, requireAdmin, (request, response) => {
  const dateRange = validateDateRange(request.query.from, request.query.to);

  if (!dateRange.ok) {
    return response.status(400).json({ errors: dateRange.errors });
  }

  return response.json(buildHsnRows("SALE", dateRange, "Jewellery"));
});

// GSTR-1 split into B2B (registered customers with GSTIN, invoice-level) and B2C (retail, rate-wise summary).
complianceRouter.get("/gst-export/gstr1-b2b-b2c", requireAuth, requireAdmin, (request, response) => {
  const dateRange = validateDateRange(request.query.from, request.query.to);

  if (!dateRange.ok) {
    return response.status(400).json({ errors: dateRange.errors });
  }

  return response.json({
    date_range: { from: dateRange.from, to: dateRange.to },
    ...buildB2bB2cRows(dateRange)
  });
});

complianceRouter.get("/gst-export/gstr2", requireAuth, requireAdmin, (request, response) => {
  const dateRange = validateDateRange(request.query.from, request.query.to);

  if (!dateRange.ok) {
    return response.status(400).json({ errors: dateRange.errors });
  }

  return response.json(buildHsnRows("PURCHASE", dateRange, "Jewellery Inward"));
});

complianceRouter.get("/gst-export/gstr3b", requireAuth, requireAdmin, (request, response) => {
  const dateRange = validateDateRange(request.query.from, request.query.to);

  if (!dateRange.ok) {
    return response.status(400).json({ errors: dateRange.errors });
  }

  return response.json(buildGstr3bSummary(dateRange));
});

complianceRouter.get("/gst-export/hsn-summary", requireAuth, requireAdmin, (request, response) => {
  const dateRange = validateDateRange(request.query.from, request.query.to);
  const invoiceType = typeof request.query.invoice_type === "string" ? request.query.invoice_type.trim().toUpperCase() : "SALE";

  if (!dateRange.ok) {
    return response.status(400).json({ errors: dateRange.errors });
  }

  if (invoiceType !== "SALE" && invoiceType !== "PURCHASE") {
    return response.status(400).json({ errors: ["invoice_type must be SALE or PURCHASE."] });
  }

  return response.json({
    date_range: {
      from: dateRange.from,
      to: dateRange.to
    },
    invoice_type: invoiceType,
    rows: buildHsnRows(invoiceType, dateRange, invoiceType === "SALE" ? "Jewellery" : "Jewellery Inward")
  });
});

complianceRouter.get("/audit-locks", requireAuth, requireAdmin, (_request, response) => {
  const locks = db.select().from(gstAuditPeriodLocks).all();
  return response.json({ locks });
});

complianceRouter.post("/audit-locks", requireAuth, requireAdmin, (request, response) => {
  const validation = validateAuditLockPayload(request.body);

  if (!validation.ok) {
    return response.status(400).json({ errors: validation.errors });
  }

  const overlap = db
    .select()
    .from(gstAuditPeriodLocks)
    .where(
      and(
        eq(gstAuditPeriodLocks.status, "LOCKED"),
        lte(gstAuditPeriodLocks.period_from, validation.lock.periodTo),
        gte(gstAuditPeriodLocks.period_to, validation.lock.periodFrom)
      )
    )
    .get();

  if (overlap) {
    return response.status(409).json({ errors: ["An active GST audit lock already overlaps this period."] });
  }

  const authUser = (request as AuthenticatedRequest).user;
  const lock = db
    .insert(gstAuditPeriodLocks)
    .values({
      period_from: validation.lock.periodFrom,
      period_to: validation.lock.periodTo,
      reason: validation.lock.reason,
      locked_by: authUser.id,
      status: "LOCKED"
    })
    .returning()
    .get();

  return response.status(201).json({ lock });
});

complianceRouter.patch("/audit-locks/:id/unlock", requireAuth, requireAdmin, (request, response) => {
  const lockId = Number(request.params.id);

  if (!Number.isInteger(lockId) || lockId <= 0) {
    return response.status(400).json({ errors: ["Lock id must be a positive integer."] });
  }

  const existing = db.select().from(gstAuditPeriodLocks).where(eq(gstAuditPeriodLocks.id, lockId)).get();

  if (!existing) {
    return response.status(404).json({ errors: ["GST audit lock not found."] });
  }

  if (existing.status === "UNLOCKED") {
    return response.status(409).json({ errors: ["GST audit lock is already unlocked."] });
  }

  const authUser = (request as AuthenticatedRequest).user;
  const lock = db
    .update(gstAuditPeriodLocks)
    .set({
      status: "UNLOCKED",
      unlocked_by: authUser.id,
      unlocked_at: sql`CURRENT_TIMESTAMP`
    })
    .where(eq(gstAuditPeriodLocks.id, lockId))
    .returning()
    .get();

  return response.json({ lock });
});

complianceRouter.get("/audit-locks/check", requireAuth, requireAdmin, (request, response) => {
  const date = typeof request.query.date === "string" ? request.query.date.trim() : "";

  if (!isDate(date)) {
    return response.status(400).json({ errors: ["date must be YYYY-MM-DD."] });
  }

  const lock = findActiveGstLockForDate(db, date);
  return response.json({ locked: Boolean(lock), lock: lock ?? null });
});


function validateAuditLockPayload(body: unknown) {
  const errors: string[] = [];

  if (!isRecord(body)) {
    return { ok: false as const, errors: ["Request body must be a JSON object."] };
  }

  const periodFrom = typeof body.period_from === "string" ? body.period_from.trim() : "";
  const periodTo = typeof body.period_to === "string" ? body.period_to.trim() : "";
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  if (!isDate(periodFrom)) {
    errors.push("period_from must be YYYY-MM-DD.");
  }

  if (!isDate(periodTo)) {
    errors.push("period_to must be YYYY-MM-DD.");
  }

  if (isDate(periodFrom) && isDate(periodTo) && periodFrom > periodTo) {
    errors.push("period_from must be earlier than or equal to period_to.");
  }

  return errors.length > 0
    ? { ok: false as const, errors }
    : { ok: true as const, lock: { periodFrom, periodTo, reason } };
}

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ==========================================
// BIS & HUID Compliance Workflows Endpoints
// ==========================================

// 1. Retrieve all BIS Submissions
complianceRouter.get("/bis-submissions", requireAuth, requireAdmin, (_request, response) => {
  try {
    const submissions = db.select().from(bisSubmissions).all();
    const result = submissions.map(sub => {
      const subItems = db.select({
        id: bisSubmissionItems.id,
        item_id: bisSubmissionItems.item_id,
        submitted_gross_weight_mg: bisSubmissionItems.submitted_gross_weight_mg,
        submitted_net_weight_mg: bisSubmissionItems.submitted_net_weight_mg,
        returned_at: bisSubmissionItems.returned_at,
        huid: bisSubmissionItems.huid,
        certificate_number: bisSubmissionItems.certificate_number,
        certificate_url: bisSubmissionItems.certificate_url,
        status: bisSubmissionItems.status,
        remarks: bisSubmissionItems.remarks,
        barcode: items.barcode,
        category: items.category,
        metal_type: items.metal_type,
        purity_karat: items.purity_karat
      })
      .from(bisSubmissionItems)
      .innerJoin(items, eq(bisSubmissionItems.item_id, items.id))
      .where(eq(bisSubmissionItems.submission_id, sub.id))
      .all();
      
      return {
        ...sub,
        items: subItems
      };
    });
    return response.json({ submissions: result });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to list BIS submissions."] });
  }
});

// 2. Retrieve details of a specific BIS Submission
complianceRouter.get("/bis-submissions/:id", requireAuth, requireAdmin, (request, response) => {
  const submissionId = Number(request.params.id);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return response.status(400).json({ errors: ["Submission ID must be a positive integer."] });
  }
  try {
    const submission = db.select().from(bisSubmissions).where(eq(bisSubmissions.id, submissionId)).get();
    if (!submission) {
      return response.status(404).json({ errors: ["BIS submission not found."] });
    }
    const subItems = db.select({
      id: bisSubmissionItems.id,
      item_id: bisSubmissionItems.item_id,
      submitted_gross_weight_mg: bisSubmissionItems.submitted_gross_weight_mg,
      submitted_net_weight_mg: bisSubmissionItems.submitted_net_weight_mg,
      returned_at: bisSubmissionItems.returned_at,
      huid: bisSubmissionItems.huid,
      certificate_number: bisSubmissionItems.certificate_number,
      certificate_url: bisSubmissionItems.certificate_url,
      status: bisSubmissionItems.status,
      remarks: bisSubmissionItems.remarks,
      barcode: items.barcode,
      category: items.category,
      metal_type: items.metal_type,
      purity_karat: items.purity_karat
    })
    .from(bisSubmissionItems)
    .innerJoin(items, eq(bisSubmissionItems.item_id, items.id))
    .where(eq(bisSubmissionItems.submission_id, submission.id))
    .all();

    return response.json({ submission: { ...submission, items: subItems } });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to retrieve BIS submission."] });
  }
});

// 3. Create a new BIS Submission
complianceRouter.post("/bis-submissions", requireAuth, requireAdmin, (request, response) => {
  const body = isRecord(request.body) ? request.body : {};
  const hallmarkCenterName = typeof body.hallmark_center_name === "string" ? body.hallmark_center_name.trim() : "";
  const submittedDate = typeof body.submitted_date === "string" ? body.submitted_date.trim() : "";
  const expectedReturnDate = typeof body.expected_return_date === "string" ? body.expected_return_date.trim() : null;
  const remarks = typeof body.remarks === "string" ? body.remarks.trim() : null;
  const itemIds = Array.isArray(body.item_ids) ? body.item_ids.map(Number) : [];

  if (!hallmarkCenterName) {
    return response.status(400).json({ errors: ["hallmark_center_name is required."] });
  }
  if (!submittedDate || !/^\d{4}-\d{2}-\d{2}$/.test(submittedDate)) {
    return response.status(400).json({ errors: ["submitted_date is required in YYYY-MM-DD format."] });
  }
  if (itemIds.length === 0) {
    return response.status(400).json({ errors: ["At least one item_id must be provided."] });
  }

  const userId = (request as AuthenticatedRequest).user.id;

  try {
    const result = db.transaction((tx) => {
      const submissionNumber = `BIS-${new Date().toISOString().replace(/-/g, "").replace(/:/g, "").replace(/T/g, "").slice(0, 8)}-${Math.floor(1000 + Math.random() * 9000)}`;
      const submission = tx.insert(bisSubmissions)
        .values({
          submission_number: submissionNumber,
          hallmark_center_name: hallmarkCenterName,
          submitted_date: submittedDate,
          expected_return_date: expectedReturnDate,
          remarks,
          status: "SUBMITTED",
          created_by: userId
        })
        .returning()
        .get();

      const createdItems = itemIds.map(itemId => {
        const itemRow = tx.select().from(items).where(eq(items.id, itemId)).get();
        if (!itemRow) {
          throw new Error(`Item ${itemId} not found.`);
        }
        if (itemRow.status !== "IN_STOCK") {
          throw new Error(`Item ${itemRow.barcode} is not in stock (status is ${itemRow.status}).`);
        }

        // Insert submission item
        const subItem = tx.insert(bisSubmissionItems)
          .values({
            submission_id: submission.id,
            item_id: itemId,
            submitted_gross_weight_mg: itemRow.gross_weight_mg,
            submitted_net_weight_mg: itemRow.net_weight_mg,
            status: "SUBMITTED"
          })
          .returning()
          .get();

        // Update item status in inventory
        tx.update(items)
          .set({
            huid_status: "BIS_SUBMITTED",
            bis_job_number: submissionNumber,
            hallmark_center_name: hallmarkCenterName,
            hallmark_submitted_at: submittedDate
          })
          .where(eq(items.id, itemId))
          .run();

        // Log HUID event
        tx.insert(huidLifecycleEvents)
          .values({
            item_id: itemId,
            from_status: itemRow.huid_status,
            to_status: "BIS_SUBMITTED",
            event_type: "BIS_SUBMISSION",
            remarks: `Submitted to ${hallmarkCenterName}`,
            bis_job_number: submissionNumber,
            created_by: userId
          })
          .run();

        return subItem;
      });

      return { submission, items: createdItems };
    });

    return response.status(201).json(result);
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to create BIS submission."] });
  }
});

// 4. Process Hallmark Return/Verification (HUID Received / Rejected)
complianceRouter.post("/bis-submissions/:id/return", requireAuth, requireAdmin, (request, response) => {
  const submissionId = Number(request.params.id);
  if (!Number.isInteger(submissionId) || submissionId <= 0) {
    return response.status(400).json({ errors: ["Submission ID must be a positive integer."] });
  }

  const body = isRecord(request.body) ? request.body : {};
  const returnedItems = Array.isArray(body.items) ? body.items : [];

  if (returnedItems.length === 0) {
    return response.status(400).json({ errors: ["items array is required in response body."] });
  }

  const userId = (request as AuthenticatedRequest).user.id;
  const todayStr = new Date().toISOString().slice(0, 10);

  try {
    const result = db.transaction((tx) => {
      const submission = tx.select().from(bisSubmissions).where(eq(bisSubmissions.id, submissionId)).get();
      if (!submission) {
        throw new Error("Submission not found.");
      }

      for (const entry of returnedItems) {
        if (!isRecord(entry)) continue;
        const itemId = Number(entry.item_id);
        const status = typeof entry.status === "string" ? entry.status.trim().toUpperCase() : ""; // "HUID_RECEIVED" | "REJECTED"
        const huid = typeof entry.huid === "string" ? entry.huid.trim().toUpperCase() : null;
        const certificateNumber = typeof entry.certificate_number === "string" ? entry.certificate_number.trim() : null;
        const certificateUrl = typeof entry.certificate_url === "string" ? entry.certificate_url.trim() : null;
        const remarks = typeof entry.remarks === "string" ? entry.remarks.trim() : null;

        if (status !== "HUID_RECEIVED" && status !== "REJECTED") {
          throw new Error(`Item ${itemId} status must be HUID_RECEIVED or REJECTED.`);
        }
        if (status === "HUID_RECEIVED" && (!huid || !/^[A-Z0-9]{6}$/.test(huid))) {
          throw new Error(`Item ${itemId} requires a valid 6-character HUID.`);
        }

        const subItem = tx.select()
          .from(bisSubmissionItems)
          .where(and(eq(bisSubmissionItems.submission_id, submissionId), eq(bisSubmissionItems.item_id, itemId)))
          .get();

        if (!subItem) {
          throw new Error(`Item ${itemId} is not part of this submission.`);
        }

        const itemRow = tx.select().from(items).where(eq(items.id, itemId)).get();
        if (!itemRow) {
          throw new Error(`Item ${itemId} not found in database.`);
        }

        // Update submission item
        tx.update(bisSubmissionItems)
          .set({
            status: status === "HUID_RECEIVED" ? "HUID_RECEIVED" : "REJECTED",
            huid,
            certificate_number: certificateNumber,
            certificate_url: certificateUrl,
            returned_at: todayStr,
            remarks
          })
          .where(eq(bisSubmissionItems.id, subItem.id))
          .run();

        if (status === "HUID_RECEIVED") {
          // Update item in inventory
          tx.update(items)
            .set({
              huid,
              huid_status: "HUID_RECEIVED",
              huid_certificate_number: certificateNumber,
              huid_certificate_url: certificateUrl,
              hallmark_returned_at: todayStr
            })
            .where(eq(items.id, itemId))
            .run();

          // Log HUID event
          tx.insert(huidLifecycleEvents)
            .values({
              item_id: itemId,
              from_status: "BIS_SUBMITTED",
              to_status: "HUID_RECEIVED",
              event_type: "HUID_RECEIVE",
              remarks: remarks || `HUID Received successfully`,
              huid,
              certificate_number: certificateNumber,
              created_by: userId
            })
            .run();
        } else {
          // Rejected
          tx.update(items)
            .set({
              huid_status: "NOT_APPLIED",
              bis_job_number: null,
              hallmark_submitted_at: null
            })
            .where(eq(items.id, itemId))
            .run();

          // Log event
          tx.insert(huidLifecycleEvents)
            .values({
              item_id: itemId,
              from_status: "BIS_SUBMITTED",
              to_status: "NOT_APPLIED",
              event_type: "BIS_REJECTED",
              remarks: remarks || `Rejected by Hallmarking Center`,
              created_by: userId
            })
            .run();
        }
      }

      // Re-evaluate submission status
      const allSubItems = tx.select().from(bisSubmissionItems).where(eq(bisSubmissionItems.submission_id, submissionId)).all();
      const allReturned = allSubItems.every(si => si.status === "HUID_RECEIVED" || si.status === "REJECTED");
      const someReturned = allSubItems.some(si => si.status === "HUID_RECEIVED" || si.status === "REJECTED");

      let finalStatus: typeof submission.status = "SUBMITTED";
      if (allReturned) {
        finalStatus = "COMPLETED";
      } else if (someReturned) {
        finalStatus = "PARTIAL_RETURN";
      }

      tx.update(bisSubmissions)
        .set({ status: finalStatus })
        .where(eq(bisSubmissions.id, submissionId))
        .run();

      return { status: finalStatus };
    });

    return response.json(result);
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to process BIS return."] });
  }
});

// 5. HUID Print Certificate Event Logging
complianceRouter.post("/huid/print-certificate", requireAuth, requireAdmin, (request, response) => {
  const body = isRecord(request.body) ? request.body : {};
  const itemId = Number(body.item_id);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return response.status(400).json({ errors: ["item_id is required as a positive integer."] });
  }

  const userId = (request as AuthenticatedRequest).user.id;

  try {
    const itemRow = db.select().from(items).where(eq(items.id, itemId)).get();
    if (!itemRow) {
      return response.status(404).json({ errors: ["Item not found."] });
    }

    if (!itemRow.huid) {
      return response.status(400).json({ errors: ["Item has no HUID registered yet."] });
    }

    db.transaction((tx) => {
      tx.update(items)
        .set({ huid_status: "CERT_PRINTED" })
        .where(eq(items.id, itemId))
        .run();

      tx.insert(huidLifecycleEvents)
        .values({
          item_id: itemId,
          from_status: itemRow.huid_status,
          to_status: "CERT_PRINTED",
          event_type: "CERT_PRINT",
          remarks: "PVC Card printed",
          huid: itemRow.huid,
          certificate_number: itemRow.huid_certificate_number,
          created_by: userId
        })
        .run();
    });

    return response.json({ status: "success", new_status: "CERT_PRINTED" });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to record print event."] });
  }
});

// 6. HUID Lifecycle logs history
complianceRouter.get("/huid/history/:itemId", requireAuth, requireAdmin, (request, response) => {
  const itemId = Number(request.params.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return response.status(400).json({ errors: ["Item ID must be a positive integer."] });
  }

  try {
    const history = db.select()
      .from(huidLifecycleEvents)
      .where(eq(huidLifecycleEvents.item_id, itemId))
      .all();
    return response.json({ history });
  } catch (err: any) {
    return response.status(500).json({ errors: [err.message || "Failed to retrieve history logs."] });
  }
});
