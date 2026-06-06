import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { Router } from "express";
import { logAction } from "../audit/logAction.js";
import { requireAuth, requireAdmin, type AuthenticatedRequest } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { customers, einvoiceDocuments, ewaybills, invoices, organizationSettings } from "../db/schema.js";
import { paiseToRupees } from "../utils/decimal.js";

export const einvoiceRouter = Router();
einvoiceRouter.use(requireAuth);

export const ewaybillRouter = Router();
ewaybillRouter.use(requireAuth);

// E-way bill is mandatory when consignment value exceeds this (Rs 50,000).
const EWAY_THRESHOLD_PAISE = 5000000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Indian financial year label "YYYY-YY" from an ISO date (April–March).
function financialYear(dateIso: string | null): string {
  const d = dateIso ? new Date(dateIso) : new Date();
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 3 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// IRN is the SHA-256 hash of supplier GSTIN + FY + doc type + doc number (the document hash the IRP
// uses for de-duplication). Computing it locally lets us reference/verify the document offline.
function computeIrn(supplierGstin: string, fy: string, docType: string, docNo: string): string {
  return createHash("sha256").update(`${supplierGstin}${fy}${docType}${docNo}`).digest("hex");
}

function ddmmyyyy(dateIso: string | null): string {
  const d = dateIso ? new Date(dateIso) : new Date();
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

type LoadedInvoice = {
  invoice: typeof invoices.$inferSelect;
  org: typeof organizationSettings.$inferSelect;
  customer: typeof customers.$inferSelect | null;
};

function loadInvoiceContext(invoiceId: number): LoadedInvoice | { error: string } {
  const invoice = db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) }).sync();
  if (!invoice) return { error: "Invoice not found." };
  const org = db.select().from(organizationSettings).get();
  if (!org) return { error: "Organization settings not found." };
  const customer = invoice.customer_id
    ? db.query.customers.findFirst({ where: eq(customers.id, invoice.customer_id) }).sync() ?? null
    : null;
  return { invoice, org, customer };
}

function rupeesNum(paise: number | null | undefined): number {
  return Math.round((paise ?? 0)) / 100;
}

// Canonical IRP request payload (subset). Uploadable to the portal / sendable to a GSP.
function buildEinvoicePayload(ctx: LoadedInvoice, supplyCategory: string, docType: string) {
  const { invoice, org, customer } = ctx;
  const supplierGstin = (org.gstin ?? "").toUpperCase();
  const buyerGstin = (customer?.gstin ?? "").toUpperCase();
  const supplyStateCode = invoice.supply_state_code ?? (supplierGstin.slice(0, 2) || "27");
  const posCode = invoice.place_of_supply_state_code ?? (buyerGstin.slice(0, 2) || supplyStateCode);
  const taxable = rupeesNum(invoice.taxable_value_paise ?? (invoice.total_amount_paise - (invoice.gst_amount_paise ?? 0)));
  const cgst = rupeesNum(invoice.cgst_paise);
  const sgst = rupeesNum(invoice.sgst_paise);
  const igst = rupeesNum(invoice.igst_paise);
  const cess = rupeesNum(invoice.cess_paise);
  const total = rupeesNum(invoice.total_amount_paise);

  return {
    Version: "1.1",
    TranDtls: { TaxSch: "GST", SupTyp: supplyCategory === "B2B" ? "B2B" : "B2C", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: docType, No: invoice.invoice_number, Dt: ddmmyyyy(invoice.created_at) },
    SellerDtls: {
      Gstin: supplierGstin,
      LglNm: org.shop_name,
      Addr1: org.address,
      Loc: org.address?.slice(0, 50) ?? "NA",
      Pin: 0,
      Stcd: supplyStateCode
    },
    BuyerDtls: {
      Gstin: buyerGstin || "URP",
      LglNm: customer?.name ?? invoice.walk_in_name ?? "Walk-in Customer",
      Pos: posCode,
      Addr1: customer?.address ?? "NA",
      Stcd: posCode
    },
    ItemList: [
      {
        SlNo: "1",
        PrdDesc: "Jewellery",
        IsServc: "N",
        HsnCd: invoice.hsn_code ?? "7113",
        Qty: 1,
        Unit: "PCS",
        TotAmt: taxable,
        AssAmt: taxable,
        GstRt: invoice.gst_percentage ?? 3,
        IgstAmt: igst,
        CgstAmt: cgst,
        SgstAmt: sgst,
        CesAmt: cess,
        TotItemVal: total
      }
    ],
    ValDtls: {
      AssVal: taxable,
      CgstVal: cgst,
      SgstVal: sgst,
      IgstVal: igst,
      CesVal: cess,
      TotInvVal: total
    }
  };
}

function buildQrContent(ctx: LoadedInvoice, irn: string) {
  const { invoice, org, customer } = ctx;
  return JSON.stringify({
    SellerGstin: (org.gstin ?? "").toUpperCase(),
    BuyerGstin: (customer?.gstin ?? "URP").toUpperCase(),
    DocNo: invoice.invoice_number,
    DocTyp: "INV",
    DocDt: ddmmyyyy(invoice.created_at),
    TotInvVal: rupeesNum(invoice.total_amount_paise),
    ItemCnt: 1,
    MainHsnCode: invoice.hsn_code ?? "7113",
    Irn: irn,
    IrnDt: todayIso()
  });
}

function formatEinvoice(doc: typeof einvoiceDocuments.$inferSelect) {
  return {
    ...doc,
    payload: doc.payload_json ? safeParse(doc.payload_json) : null
  };
}

function safeParse(json: string): unknown {
  try { return JSON.parse(json); } catch { return null; }
}

// ---- E-INVOICE ----

// Recent invoices for the GST e-docs picker, annotated with whether an e-invoice/e-way bill exists.
einvoiceRouter.get("/invoices/search", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
  const rows = db
    .select({
      id: invoices.id,
      invoice_number: invoices.invoice_number,
      created_at: invoices.created_at,
      total_amount_paise: invoices.total_amount_paise,
      customer_id: invoices.customer_id,
      walk_in_name: invoices.walk_in_name,
      gst_not_required: invoices.gst_not_required
    })
    .from(invoices)
    .orderBy(desc(invoices.id))
    .all()
    .filter((r) => !q || r.invoice_number.toLowerCase().includes(q))
    .slice(0, 30);

  const einvoiceRows = db.select({ invoice_id: einvoiceDocuments.invoice_id, status: einvoiceDocuments.status }).from(einvoiceDocuments).all();
  const ewayRows = db.select({ invoice_id: ewaybills.invoice_id, status: ewaybills.status }).from(ewaybills).all();
  const einvoiceMap = new Map(einvoiceRows.map((e) => [e.invoice_id, e.status]));
  const ewayMap = new Map(ewayRows.map((e) => [e.invoice_id, e.status]));

  return res.json({
    invoices: rows.map((r) => {
      const customer = r.customer_id ? db.query.customers.findFirst({ where: eq(customers.id, r.customer_id) }).sync() : null;
      return {
        id: r.id,
        invoice_number: r.invoice_number,
        created_at: r.created_at,
        total_rupees: paiseToRupees(r.total_amount_paise),
        total_amount_paise: r.total_amount_paise,
        customer_name: customer?.name ?? r.walk_in_name ?? "Walk-in Customer",
        customer_gstin: customer?.gstin ?? null,
        gst_not_required: r.gst_not_required,
        einvoice_status: einvoiceMap.get(r.id) ?? null,
        ewaybill_status: ewayMap.get(r.id) ?? null
      };
    })
  });
});

einvoiceRouter.get("/:invoiceId", (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ errors: ["invoiceId must be a positive integer."] });
  }
  const doc = db.query.einvoiceDocuments.findFirst({ where: eq(einvoiceDocuments.invoice_id, invoiceId), orderBy: desc(einvoiceDocuments.id) }).sync();
  if (!doc) return res.status(404).json({ errors: ["No e-invoice prepared for this invoice."] });
  return res.json({ einvoice: formatEinvoice(doc) });
});

// Prepare the e-invoice: build the IRP payload + QR content + IRN hash, store as PREPARED.
// A configured GSP would register it for real; here it is prepared offline (gateway LOCAL).
einvoiceRouter.post("/:invoiceId/generate", requireAdmin, (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ errors: ["invoiceId must be a positive integer."] });
  }
  const ctx = loadInvoiceContext(invoiceId);
  if ("error" in ctx) return res.status(404).json({ errors: [ctx.error] });

  if (!ctx.org.gstin) {
    return res.status(422).json({ errors: ["Shop GSTIN is not configured — e-invoice cannot be prepared."] });
  }
  if (ctx.invoice.gst_not_required) {
    return res.status(422).json({ errors: ["This invoice is marked GST-not-required; no e-invoice applies."] });
  }

  const existing = db.query.einvoiceDocuments.findFirst({ where: eq(einvoiceDocuments.invoice_id, invoiceId) }).sync();
  if (existing && existing.status === "REGISTERED") {
    return res.status(409).json({ errors: ["An e-invoice is already registered for this invoice. Cancel it first to re-prepare."] });
  }

  const supplyCategory = ctx.customer?.gstin ? "B2B" : "B2C";
  const docType = "INV";
  const fy = financialYear(ctx.invoice.created_at);
  const irn = computeIrn((ctx.org.gstin ?? "").toUpperCase(), fy, docType, ctx.invoice.invoice_number);
  const payload = buildEinvoicePayload(ctx, supplyCategory, docType);
  const qrContent = buildQrContent(ctx, irn);
  const userId = (req as unknown as AuthenticatedRequest).user.id;

  try {
    const saved = db.transaction((tx) => {
      if (existing) {
        return tx.update(einvoiceDocuments).set({
          doc_type: docType,
          supply_category: supplyCategory,
          irn,
          qr_content: qrContent,
          payload_json: JSON.stringify(payload),
          gateway: "LOCAL",
          irp_registered: false,
          status: "PREPARED",
          error_message: null,
          cancel_reason: null,
          cancelled_at: null
        }).where(eq(einvoiceDocuments.id, existing.id)).returning().get();
      }
      return tx.insert(einvoiceDocuments).values({
        invoice_id: invoiceId,
        doc_type: docType,
        supply_category: supplyCategory,
        irn,
        qr_content: qrContent,
        payload_json: JSON.stringify(payload),
        gateway: "LOCAL",
        irp_registered: false,
        status: "PREPARED",
        created_by: userId
      }).returning().get();
    });

    logAction(userId, "PREPARE_EINVOICE", "einvoice_documents", saved.id, null, { invoice_id: invoiceId, irn });
    return res.status(201).json({
      einvoice: formatEinvoice(saved),
      note: "Prepared offline. Upload the payload to the GST e-invoice portal (or a configured GSP) to register, then record the official IRN / Ack / signed QR."
    });
  } catch (err: any) {
    return res.status(500).json({ errors: [err.message || "Failed to prepare e-invoice."] });
  }
});

// Record the official IRP response (IRN, Ack No/Date, signed QR) obtained from portal/GSP.
einvoiceRouter.post("/:invoiceId/record", requireAdmin, (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  const doc = db.query.einvoiceDocuments.findFirst({ where: eq(einvoiceDocuments.invoice_id, invoiceId) }).sync();
  if (!doc) return res.status(404).json({ errors: ["Prepare the e-invoice before recording the IRP response."] });

  const body = isRecord(req.body) ? req.body : {};
  const irn = typeof body.irn === "string" && body.irn.trim() ? body.irn.trim() : doc.irn;
  const ackNo = typeof body.ack_no === "string" ? body.ack_no.trim() : null;
  const ackDate = typeof body.ack_date === "string" ? body.ack_date.trim() : todayIso();
  const signedQr = typeof body.signed_qr_code === "string" ? body.signed_qr_code.trim() : null;

  if (!irn) return res.status(400).json({ errors: ["irn is required."] });

  const userId = (req as unknown as AuthenticatedRequest).user.id;
  const updated = db.update(einvoiceDocuments).set({
    irn,
    ack_no: ackNo,
    ack_date: ackDate,
    signed_qr_code: signedQr,
    gateway: "MANUAL",
    irp_registered: true,
    status: "REGISTERED",
    error_message: null
  }).where(eq(einvoiceDocuments.id, doc.id)).returning().get();

  logAction(userId, "RECORD_EINVOICE", "einvoice_documents", doc.id, null, { invoice_id: invoiceId, ack_no: ackNo });
  return res.json({ einvoice: formatEinvoice(updated) });
});

einvoiceRouter.post("/:invoiceId/cancel", requireAdmin, (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  const doc = db.query.einvoiceDocuments.findFirst({ where: eq(einvoiceDocuments.invoice_id, invoiceId) }).sync();
  if (!doc) return res.status(404).json({ errors: ["No e-invoice found for this invoice."] });

  const body = isRecord(req.body) ? req.body : {};
  const reason = typeof body.cancel_reason === "string" && body.cancel_reason.trim() ? body.cancel_reason.trim() : "Cancelled by user";
  const userId = (req as unknown as AuthenticatedRequest).user.id;

  const updated = db.update(einvoiceDocuments).set({
    status: "CANCELLED",
    cancel_reason: reason,
    cancelled_at: new Date().toISOString()
  }).where(eq(einvoiceDocuments.id, doc.id)).returning().get();

  logAction(userId, "CANCEL_EINVOICE", "einvoice_documents", doc.id, null, { invoice_id: invoiceId, reason });
  return res.json({ einvoice: formatEinvoice(updated) });
});

// ---- E-WAY BILL ----

function formatEwaybill(eb: typeof ewaybills.$inferSelect) {
  return { ...eb, payload: eb.payload_json ? safeParse(eb.payload_json) : null };
}

ewaybillRouter.get("/:invoiceId", (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ errors: ["invoiceId must be a positive integer."] });
  }
  const ctx = loadInvoiceContext(invoiceId);
  if ("error" in ctx) return res.status(404).json({ errors: [ctx.error] });
  const eb = db.query.ewaybills.findFirst({ where: eq(ewaybills.invoice_id, invoiceId), orderBy: desc(ewaybills.id) }).sync();
  return res.json({
    required: ctx.invoice.total_amount_paise > EWAY_THRESHOLD_PAISE,
    threshold_rupees: paiseToRupees(EWAY_THRESHOLD_PAISE),
    invoice_value_rupees: paiseToRupees(ctx.invoice.total_amount_paise),
    ewaybill: eb ? formatEwaybill(eb) : null
  });
});

ewaybillRouter.post("/:invoiceId/generate", requireAdmin, (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ errors: ["invoiceId must be a positive integer."] });
  }
  const ctx = loadInvoiceContext(invoiceId);
  if ("error" in ctx) return res.status(404).json({ errors: [ctx.error] });

  const body = isRecord(req.body) ? req.body : {};
  const transportMode = typeof body.transport_mode === "string" && body.transport_mode.trim() ? body.transport_mode.trim().toUpperCase() : "ROAD";
  const vehicleNumber = typeof body.vehicle_number === "string" ? body.vehicle_number.trim().toUpperCase() || null : null;
  const transporterId = typeof body.transporter_id === "string" ? body.transporter_id.trim() || null : null;
  const transporterName = typeof body.transporter_name === "string" ? body.transporter_name.trim() || null : null;
  const distanceKm = Number.isInteger(Number(body.distance_km)) ? Number(body.distance_km) : 0;
  const fromPincode = typeof body.from_pincode === "string" ? body.from_pincode.trim() || null : null;
  const toPincode = typeof body.to_pincode === "string" ? body.to_pincode.trim() || null : null;

  const errors: string[] = [];
  if (transportMode === "ROAD" && !vehicleNumber) errors.push("vehicle_number is required for road transport.");
  if (errors.length > 0) return res.status(400).json({ errors });

  const { invoice, org, customer } = ctx;
  const supplierGstin = (org.gstin ?? "").toUpperCase();
  const payload = {
    supplyType: "O",
    subSupplyType: "1",
    docType: "INV",
    docNo: invoice.invoice_number,
    docDate: ddmmyyyy(invoice.created_at),
    fromGstin: supplierGstin,
    fromTrdName: org.shop_name,
    fromPincode: fromPincode ?? undefined,
    fromStateCode: invoice.supply_state_code ?? supplierGstin.slice(0, 2),
    toGstin: (customer?.gstin ?? "URP").toUpperCase(),
    toTrdName: customer?.name ?? invoice.walk_in_name ?? "Walk-in Customer",
    toPincode: toPincode ?? undefined,
    toStateCode: invoice.place_of_supply_state_code ?? (customer?.gstin ?? supplierGstin).slice(0, 2),
    totInvValue: rupeesNum(invoice.total_amount_paise),
    cgstValue: rupeesNum(invoice.cgst_paise),
    sgstValue: rupeesNum(invoice.sgst_paise),
    igstValue: rupeesNum(invoice.igst_paise),
    hsnCode: invoice.hsn_code ?? "7113",
    transMode: transportMode === "ROAD" ? "1" : transportMode === "RAIL" ? "2" : transportMode === "AIR" ? "3" : "4",
    transDistance: String(distanceKm),
    vehicleNo: vehicleNumber ?? undefined,
    transporterId: transporterId ?? undefined,
    transporterName: transporterName ?? undefined
  };

  const userId = (req as unknown as AuthenticatedRequest).user.id;
  const existing = db.query.ewaybills.findFirst({ where: eq(ewaybills.invoice_id, invoiceId) }).sync();

  try {
    const saved = db.transaction((tx) => {
      const values = {
        invoice_id: invoiceId,
        transport_mode: transportMode,
        vehicle_number: vehicleNumber,
        transporter_id: transporterId,
        transporter_name: transporterName,
        distance_km: distanceKm,
        from_pincode: fromPincode,
        to_pincode: toPincode,
        payload_json: JSON.stringify(payload),
        gateway: "LOCAL",
        status: "PREPARED" as const,
        eway_date: todayIso()
      };
      if (existing) {
        return tx.update(ewaybills).set(values).where(eq(ewaybills.id, existing.id)).returning().get();
      }
      return tx.insert(ewaybills).values({ ...values, created_by: userId }).returning().get();
    });

    logAction(userId, "PREPARE_EWAYBILL", "ewaybills", saved.id, null, { invoice_id: invoiceId });
    return res.status(201).json({
      ewaybill: formatEwaybill(saved),
      note: "Prepared offline. Upload the payload to the e-way bill portal / GSP to obtain the EWB number, then record it."
    });
  } catch (err: any) {
    return res.status(500).json({ errors: [err.message || "Failed to prepare e-way bill."] });
  }
});

// Record the official EWB number + validity obtained from the portal/GSP.
ewaybillRouter.post("/:invoiceId/record", requireAdmin, (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  const eb = db.query.ewaybills.findFirst({ where: eq(ewaybills.invoice_id, invoiceId) }).sync();
  if (!eb) return res.status(404).json({ errors: ["Prepare the e-way bill before recording its number."] });

  const body = isRecord(req.body) ? req.body : {};
  const number = typeof body.eway_bill_number === "string" ? body.eway_bill_number.trim() : "";
  const validUntil = typeof body.valid_until === "string" ? body.valid_until.trim() || null : null;
  if (!number) return res.status(400).json({ errors: ["eway_bill_number is required."] });

  const userId = (req as unknown as AuthenticatedRequest).user.id;
  const updated = db.update(ewaybills).set({
    eway_bill_number: number,
    valid_until: validUntil,
    gateway: "MANUAL",
    status: "GENERATED"
  }).where(eq(ewaybills.id, eb.id)).returning().get();

  logAction(userId, "RECORD_EWAYBILL", "ewaybills", eb.id, null, { invoice_id: invoiceId, eway_bill_number: number });
  return res.json({ ewaybill: formatEwaybill(updated) });
});

ewaybillRouter.post("/:invoiceId/cancel", requireAdmin, (req, res) => {
  const invoiceId = Number(req.params.invoiceId);
  const eb = db.query.ewaybills.findFirst({ where: eq(ewaybills.invoice_id, invoiceId) }).sync();
  if (!eb) return res.status(404).json({ errors: ["No e-way bill found for this invoice."] });

  const body = isRecord(req.body) ? req.body : {};
  const reason = typeof body.cancel_reason === "string" && body.cancel_reason.trim() ? body.cancel_reason.trim() : "Cancelled by user";
  const userId = (req as unknown as AuthenticatedRequest).user.id;
  const updated = db.update(ewaybills).set({
    status: "CANCELLED",
    cancel_reason: reason,
    cancelled_at: new Date().toISOString()
  }).where(eq(ewaybills.id, eb.id)).returning().get();

  logAction(userId, "CANCEL_EWAYBILL", "ewaybills", eb.id, null, { invoice_id: invoiceId, reason });
  return res.json({ ewaybill: formatEwaybill(updated) });
});
