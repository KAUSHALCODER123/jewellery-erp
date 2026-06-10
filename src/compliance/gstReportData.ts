import { and, eq, gte, lte, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { customers, invoiceLines, invoices, urdPurchases, urdVouchers } from "../db/schema.js";
import { paiseToRupees } from "../utils/decimal.js";

// Single source for GSTR-1 / B2B-B2C / GSTR-3B data assembly, shared by the JSON
// API (compliance/routes.ts) and the xlsx/PDF export endpoints (documents/routes.ts).

export const DEFAULT_HSN_CODE = "7113";

export type DateRange = { ok: true; from: string | null; to: string | null };
export type InvoiceType = "SALE" | "PURCHASE";

export type GstSummary = {
  taxable_value_paise: number;
  gst_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  cess_paise: number;
};

export function validateDateRange(from: unknown, to: unknown) {
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

export function buildHsnRows(invoiceType: InvoiceType, dateRange: DateRange, description: string) {
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

export type HsnRow = ReturnType<typeof buildHsnRows>[number];

export function buildB2bB2cRows(dateRange: DateRange) {
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

export type B2bB2cData = ReturnType<typeof buildB2bB2cRows>;

export function summarizeGst(invoiceType: InvoiceType, dateRange: DateRange): GstSummary {
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

export function buildGstr3bSummary(dateRange: DateRange) {
  const outward = summarizeGst("SALE", dateRange);
  const inward = summarizeGst("PURCHASE", dateRange);
  const netCgstPaise = Math.max(outward.cgst_paise - inward.cgst_paise, 0);
  const netSgstPaise = Math.max(outward.sgst_paise - inward.sgst_paise, 0);
  const netIgstPaise = Math.max(outward.igst_paise - inward.igst_paise, 0);

  return {
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
  };
}

export type Gstr3bSummary = ReturnType<typeof buildGstr3bSummary>;

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

export function withRupees(summary: GstSummary) {
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

function isDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime());
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
