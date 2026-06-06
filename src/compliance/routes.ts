import { and, eq, gte, lte, or, sql } from "drizzle-orm";
import { Router } from "express";
import { requireAdmin, requireAuth, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { bisSubmissionItems, bisSubmissions, customers, gstAuditPeriodLocks, huidLifecycleEvents, invoiceLines, invoices, items, urdPurchases, urdVouchers } from "../db/schema.js";
import { paiseToRupees } from "../utils/decimal.js";
import { findActiveGstLockForDate } from "./auditLocks.js";

export const complianceRouter = Router();

const DEFAULT_HSN_CODE = "7113";

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

  const outward = summarizeGst("SALE", dateRange);
  const inward = summarizeGst("PURCHASE", dateRange);
  const netCgstPaise = Math.max(outward.cgst_paise - inward.cgst_paise, 0);
  const netSgstPaise = Math.max(outward.sgst_paise - inward.sgst_paise, 0);
  const netIgstPaise = Math.max(outward.igst_paise - inward.igst_paise, 0);

  return response.json({
    date_range: {
      from: dateRange.from,
      to: dateRange.to
    },
    outward_supplies: withRupees(outward),
    inward_supplies: withRupees(inward),
    net_payable: {
      cgst_paise: netCgstPaise,
      cgst_rupees: paiseToRupees(netCgstPaise),
      sgst_paise: netSgstPaise,
      sgst_rupees: paiseToRupees(netSgstPaise),
      igst_paise: netIgstPaise,
      igst_rupees: paiseToRupees(netIgstPaise),
      cess_paise: 0,
      cess_rupees: "0.00"
    }
  });
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

type DateRange = { ok: true; from: string | null; to: string | null };
type InvoiceType = "SALE" | "PURCHASE";

type GstSummary = {
  taxable_value_paise: number;
  gst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  cess_paise: number;
};

function buildHsnRows(invoiceType: InvoiceType, dateRange: DateRange, description: string) {
  const grouped = new Map<string, {
    hsnCode: string;
    gstPercentage: number;
    supplyType: string;
    quantity: number;
    grossWeightMg: number;
    netWeightMg: number;
  } & GstSummary>();

  for (const row of loadTaxRows(invoiceType, dateRange)) {
    const hsnCode = row.invoice.hsn_code || DEFAULT_HSN_CODE;
    const gstPercentage = Number(row.invoice.gst_percentage ?? 0);
    const supplyType = row.invoice.gst_supply_type || "INTRA_STATE";
    const key = `${hsnCode}|${gstPercentage}|${supplyType}`;
    const current = grouped.get(key) ?? {
      hsnCode,
      gstPercentage,
      supplyType,
      quantity: 0,
      grossWeightMg: 0,
      netWeightMg: 0,
      taxable_value_paise: 0,
      gst_paise: 0,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 0,
      cess_paise: 0
    };
    const taxes = lineTaxes(row.line, row.invoice);

    current.quantity += 1;
    current.grossWeightMg += row.line.gross_weight_mg;
    current.netWeightMg += row.line.net_weight_mg;
    current.taxable_value_paise += taxes.taxable_value_paise;
    current.gst_paise += taxes.gst_paise;
    current.cgst_paise += taxes.cgst_paise;
    current.sgst_paise += taxes.sgst_paise;
    current.igst_paise += taxes.igst_paise;
    current.cess_paise += taxes.cess_paise;
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .sort((left, right) => left.hsnCode.localeCompare(right.hsnCode) || left.gstPercentage - right.gstPercentage)
    .map((entry) => ({
      hsn_sc: entry.hsnCode,
      desc: description,
      uqc: "NOS",
      qty: entry.quantity,
      gross_weight_mg: entry.grossWeightMg,
      net_weight_mg: entry.netWeightMg,
      supply_type: entry.supplyType,
      rt: entry.gstPercentage,
      txval: paiseToRupees(entry.taxable_value_paise),
      iamt: paiseToRupees(entry.igst_paise),
      camt: paiseToRupees(entry.cgst_paise),
      samt: paiseToRupees(entry.sgst_paise),
      csamt: paiseToRupees(entry.cess_paise),
      taxable_value_paise: entry.taxable_value_paise,
      gst_paise: entry.gst_paise,
      igst_paise: entry.igst_paise,
      cgst_paise: entry.cgst_paise,
      sgst_paise: entry.sgst_paise,
      cess_paise: entry.cess_paise
    }));
}

function buildB2bB2cRows(dateRange: DateRange) {
  const filters = [
    or(eq(invoices.invoice_type, "SALE"), sql`${invoices.invoice_type} IS NULL`),
    dateRange.from ? gte(invoices.created_at, `${dateRange.from} 00:00:00`) : undefined,
    dateRange.to ? lte(invoices.created_at, `${dateRange.to} 23:59:59`) : undefined
  ].filter(isDefined);

  const rows = db
    .select({ invoice: invoices, line: invoiceLines, customer_gstin: customers.gstin, customer_name: customers.name })
    .from(invoiceLines)
    .innerJoin(invoices, sql`${invoiceLines.invoice_id} = ${invoices.id}`)
    .leftJoin(customers, sql`${invoices.customer_id} = ${customers.id}`)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .all();

  type Acc = GstSummary & { invoice_number?: string; gstin?: string; customer_name?: string; supply_type: string; rate: number; total_paise: number };
  const newAcc = (supply_type: string, rate: number): Acc => ({
    taxable_value_paise: 0, gst_paise: 0, cgst_paise: 0, sgst_paise: 0, igst_paise: 0, cess_paise: 0, supply_type, rate, total_paise: 0
  });
  const addTaxes = (acc: Acc, taxes: GstSummary) => {
    acc.taxable_value_paise += taxes.taxable_value_paise;
    acc.gst_paise += taxes.gst_paise;
    acc.cgst_paise += taxes.cgst_paise;
    acc.sgst_paise += taxes.sgst_paise;
    acc.igst_paise += taxes.igst_paise;
    acc.cess_paise += taxes.cess_paise;
    acc.total_paise = acc.taxable_value_paise + acc.gst_paise;
  };

  // B2B grouped per invoice (registered customer); B2C summarized per rate+supply type (retail).
  const b2bMap = new Map<number, Acc>();
  const b2cMap = new Map<string, Acc>();
  for (const row of rows) {
    const taxes = lineTaxes(row.line, row.invoice);
    const gstin = row.customer_gstin?.trim();
    const rate = Number(row.invoice.gst_percentage ?? 0);
    const supplyType = row.invoice.gst_supply_type || "INTRA_STATE";

    if (gstin) {
      const acc = b2bMap.get(row.invoice.id) ?? newAcc(supplyType, rate);
      acc.invoice_number = row.invoice.invoice_number;
      acc.gstin = gstin;
      acc.customer_name = row.customer_name ?? undefined;
      addTaxes(acc, taxes);
      b2bMap.set(row.invoice.id, acc);
    } else {
      const key = `${rate}|${supplyType}`;
      const acc = b2cMap.get(key) ?? newAcc(supplyType, rate);
      addTaxes(acc, taxes);
      b2cMap.set(key, acc);
    }
  }

  const present = (acc: Acc) => ({
    invoice_number: acc.invoice_number,
    gstin: acc.gstin,
    customer_name: acc.customer_name,
    supply_type: acc.supply_type,
    rate: acc.rate,
    taxable_value_rupees: paiseToRupees(acc.taxable_value_paise),
    cgst_rupees: paiseToRupees(acc.cgst_paise),
    sgst_rupees: paiseToRupees(acc.sgst_paise),
    igst_rupees: paiseToRupees(acc.igst_paise),
    total_rupees: paiseToRupees(acc.total_paise),
    taxable_value_paise: acc.taxable_value_paise,
    gst_paise: acc.gst_paise,
    total_paise: acc.total_paise
  });

  const b2b = [...b2bMap.values()].map(present);
  const b2c = [...b2cMap.values()].sort((l, r) => l.rate - r.rate).map(present);
  const sumPaise = (list: Acc[]) => list.reduce((t, a) => t + a.total_paise, 0);

  return {
    b2b,
    b2c,
    totals: {
      b2b_invoice_count: b2b.length,
      b2c_summary_count: b2c.length,
      b2b_total_rupees: paiseToRupees(sumPaise([...b2bMap.values()])),
      b2c_total_rupees: paiseToRupees(sumPaise([...b2cMap.values()]))
    }
  };
}

function summarizeGst(invoiceType: InvoiceType, dateRange: DateRange): GstSummary {
  const initial: GstSummary = {
    taxable_value_paise: 0,
    gst_paise: 0,
    cgst_paise: 0,
    sgst_paise: 0,
    igst_paise: 0,
    cess_paise: 0
  };
  return loadTaxRows(invoiceType, dateRange).reduce((summary: GstSummary, row: any) => {
    const taxes = lineTaxes(row.line, row.invoice);

    summary.taxable_value_paise += taxes.taxable_value_paise;
    summary.gst_paise += taxes.gst_paise;
    summary.cgst_paise += taxes.cgst_paise;
    summary.sgst_paise += taxes.sgst_paise;
    summary.igst_paise += taxes.igst_paise;
    summary.cess_paise += taxes.cess_paise;

    return summary;
  }, initial);
}

function loadTaxRows(invoiceType: InvoiceType, dateRange: DateRange) {
  const filters = [
    invoiceType === "SALE"
      ? or(eq(invoices.invoice_type, "SALE"), sql`${invoices.invoice_type} IS NULL`)
      : eq(invoices.invoice_type, "PURCHASE"),
    dateRange.from ? gte(invoices.created_at, `${dateRange.from} 00:00:00`) : undefined,
    dateRange.to ? lte(invoices.created_at, `${dateRange.to} 23:59:59`) : undefined
  ].filter(isDefined);

  const standardRows = db
    .select({
      invoice: invoices,
      line: invoiceLines
    })
    .from(invoiceLines)
    .innerJoin(invoices, sql`${invoiceLines.invoice_id} = ${invoices.id}`)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .all();

  if (invoiceType === "PURCHASE") {
    // Fetch standalone URD vouchers in date range
    const urdVoucherRows = db.select()
      .from(urdVouchers)
      .where(
        and(
          dateRange.from ? gte(urdVouchers.voucher_date, dateRange.from) : undefined,
          dateRange.to ? lte(urdVouchers.voucher_date, dateRange.to) : undefined
        )
      )
      .all();

    // Fetch POS-based URD purchases in date range
    const urdPurchaseRows = db.select({
      purchase: urdPurchases,
      invoice: invoices
    })
    .from(urdPurchases)
    .innerJoin(invoices, eq(urdPurchases.invoice_id, invoices.id))
    .where(
      and(
        dateRange.from ? gte(invoices.created_at, `${dateRange.from} 00:00:00`) : undefined,
        dateRange.to ? lte(invoices.created_at, `${dateRange.to} 23:59:59`) : undefined
      )
    )
    .all();

    // Map URD Vouchers to match the row format
    const mappedVouchers = urdVoucherRows.map((voucher) => ({
      invoice: {
        id: voucher.id,
        invoice_number: voucher.voucher_number,
        customer_id: voucher.customer_id,
        total_amount_paise: voucher.total_value_paise,
        gst_percentage: 0,
        gst_amount_paise: 0,
        hsn_code: "7113",
        discount_paise: 0,
        wastage_total_paise: 0,
        urd_deduction_paise: 0,
        gss_credit_paise: 0,
        cheque_amount_paise: 0,
        neft_amount_paise: 0,
        invoice_type: "PURCHASE" as const,
        bill_prefix: "URD",
        manual_number: null,
        due_date: null,
        salesman_name: null,
        gst_not_required: true,
        payment_mode: voucher.payment_mode,
        payment_reference_json: voucher.payment_reference,
        is_cash_above_limit: false,
        created_at: `${voucher.voucher_date} 00:00:00`,
        gst_supply_type: "INTRA_STATE" as const
      } as any,
      line: {
        id: voucher.id,
        invoice_id: voucher.id,
        item_id: voucher.stock_item_id ?? 0,
        metal_type: voucher.metal_type,
        purity_karat: Math.max(1, Math.min(24, Math.round((Number(voucher.purity_tunch) * 24) / 100))),
        gross_weight_mg: voucher.gross_weight_mg,
        net_weight_mg: voucher.net_weight_mg,
        stone_weight_mg: voucher.stone_weight_mg,
        metal_rate_paise_per_gram: voucher.applied_rate_paise_per_gram,
        making_charge_paise: 0,
        wastage_charge_paise: 0,
        gst_paise: 0,
        taxable_value_paise: voucher.total_value_paise,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        cess_paise: 0,
        line_total_paise: voucher.total_value_paise
      } as any
    }));

    // Map POS URD purchases to match the row format
    const mappedPurchases = urdPurchaseRows.map((row) => ({
      invoice: {
        id: row.invoice.id,
        invoice_number: row.invoice.invoice_number,
        customer_id: row.invoice.customer_id,
        total_amount_paise: row.purchase.deduction_amount_paise,
        gst_percentage: 0,
        gst_amount_paise: 0,
        hsn_code: "7113",
        discount_paise: 0,
        wastage_total_paise: 0,
        urd_deduction_paise: 0,
        gss_credit_paise: 0,
        cheque_amount_paise: 0,
        neft_amount_paise: 0,
        invoice_type: "PURCHASE" as const,
        bill_prefix: "URD",
        manual_number: null,
        due_date: null,
        salesman_name: null,
        gst_not_required: true,
        payment_mode: "CASH",
        payment_reference_json: null,
        is_cash_above_limit: false,
        created_at: row.invoice.created_at,
        gst_supply_type: "INTRA_STATE" as const
      } as any,
      line: {
        id: row.purchase.id,
        invoice_id: row.invoice.id,
        item_id: row.purchase.stock_item_id ?? 0,
        metal_type: row.purchase.metal_type,
        purity_karat: Math.max(1, Math.min(24, Math.round((Number(row.purchase.purity_tunch) * 24) / 100))),
        gross_weight_mg: row.purchase.weight_mg,
        net_weight_mg: row.purchase.weight_mg,
        stone_weight_mg: 0,
        metal_rate_paise_per_gram: row.purchase.applied_rate_paise_per_gram,
        making_charge_paise: 0,
        wastage_charge_paise: 0,
        gst_paise: 0,
        taxable_value_paise: row.purchase.deduction_amount_paise,
        cgst_paise: 0,
        sgst_paise: 0,
        igst_paise: 0,
        cess_paise: 0,
        line_total_paise: row.purchase.deduction_amount_paise
      } as any
    }));

    return [...standardRows, ...mappedVouchers, ...mappedPurchases] as any;
  }

  return standardRows;
}

function lineTaxes(line: typeof invoiceLines.$inferSelect, invoice: typeof invoices.$inferSelect): GstSummary {
  const explicitCgst = line.cgst_paise ?? 0;
  const explicitSgst = line.sgst_paise ?? 0;
  const explicitIgst = line.igst_paise ?? 0;
  const explicitCess = line.cess_paise ?? 0;
  const explicitTotal = explicitCgst + explicitSgst + explicitIgst + explicitCess;
  const gstPaise = line.gst_paise ?? explicitTotal;
  const taxableValuePaise = line.taxable_value_paise && line.taxable_value_paise > 0
    ? line.taxable_value_paise
    : Math.max(line.line_total_paise - gstPaise, 0);

  if (explicitTotal > 0) {
    return {
      taxable_value_paise: taxableValuePaise,
      gst_paise: explicitTotal,
      cgst_paise: explicitCgst,
      sgst_paise: explicitSgst,
      igst_paise: explicitIgst,
      cess_paise: explicitCess
    };
  }

  if (invoice.gst_supply_type === "INTER_STATE" || invoice.gst_supply_type === "EXPORT" || invoice.gst_supply_type === "SEZ") {
    return {
      taxable_value_paise: taxableValuePaise,
      gst_paise: gstPaise,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: gstPaise,
      cess_paise: 0
    };
  }

  const cgstPaise = Math.floor(gstPaise / 2);
  const sgstPaise = gstPaise - cgstPaise;

  return {
    taxable_value_paise: taxableValuePaise,
    gst_paise: gstPaise,
    cgst_paise: cgstPaise,
    sgst_paise: sgstPaise,
    igst_paise: 0,
    cess_paise: 0
  };
}

function withRupees(summary: GstSummary) {
  return {
    ...summary,
    taxable_value_rupees: paiseToRupees(summary.taxable_value_paise),
    gst_rupees: paiseToRupees(summary.gst_paise),
    cgst_rupees: paiseToRupees(summary.cgst_paise),
    sgst_rupees: paiseToRupees(summary.sgst_paise),
    igst_rupees: paiseToRupees(summary.igst_paise),
    cess_rupees: paiseToRupees(summary.cess_paise)
  };
}

function validateDateRange(from: unknown, to: unknown) {
  const errors: string[] = [];
  const normalizedFrom = typeof from === "string" && from.trim() ? from.trim() : null;
  const normalizedTo = typeof to === "string" && to.trim() ? to.trim() : null;

  if (normalizedFrom && !isDate(normalizedFrom)) {
    errors.push("from must be YYYY-MM-DD.");
  }

  if (normalizedTo && !isDate(normalizedTo)) {
    errors.push("to must be YYYY-MM-DD.");
  }

  if (normalizedFrom && normalizedTo && normalizedFrom > normalizedTo) {
    errors.push("from must be earlier than or equal to to.");
  }

  return errors.length > 0
    ? { ok: false as const, errors }
    : { ok: true as const, from: normalizedFrom, to: normalizedTo };
}

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

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
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
