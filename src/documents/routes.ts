import { and, eq, sql } from "drizzle-orm";
import { Router } from "express";
import { db } from "../db/client.js";
import {
  customers,
  invoiceLines,
  invoices,
  journalEntries,
  ledgers,
  organizationSettings,
  printTemplates,
  items,
  urdPurchases,
  itemStones,
  girviLoans,
  girviCollateral,
  girviRepayments,
  gssAccounts,
  gssReceipts,
  gssTemplates,
  jobOrders,
  jobReceipts,
  karigars,
  materialIssues,
  refineries,
  refineryTransfers,
  stockVerificationScans,
  stockVerificationSessions,
  urdVouchers,
  voucherHeaders,
  voucherLines
} from "../db/schema.js";
import type { InvoiceDocumentData, PaymentDocumentData, PrintTemplateData } from "../utils/pdfGenerator.js";
import { verifyTokenAllowQueryToken } from "../middlewares/authMiddleware.js";

export const documentRouter = Router();

// Every document/PDF route exposes customer PII (invoices, loan deeds, KYC-bearing
// vouchers, HUID cards). Require a valid session token. These are opened via
// browser navigation, so the token may arrive as a `?token=` query param.
documentRouter.use(verifyTokenAllowQueryToken);

documentRouter.get("/invoice/:id/a4", async (request, response) => {
  const invoiceId = parseInvoiceId(request.params.id);

  if (!invoiceId) {
    return response.status(400).json({ errors: ["Invoice id must be a positive integer."] });
  }

  const documentData = loadInvoiceDocumentData(invoiceId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Invoice not found."] });
  }

  const { generateA4Invoice } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateA4Invoice(documentData.invoice, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="${documentData.invoice.invoice_number}-a4.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/invoice/:id/a5", async (request, response) => {
  const invoiceId = parseInvoiceId(request.params.id);

  if (!invoiceId) {
    return response.status(400).json({ errors: ["Invoice id must be a positive integer."] });
  }

  const documentData = loadInvoiceDocumentData(invoiceId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Invoice not found."] });
  }

  const { generateA5Invoice } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateA5Invoice(documentData.invoice, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="${documentData.invoice.invoice_number}-a5.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/invoice/:id/thermal", async (request, response) => {
  const invoiceId = parseInvoiceId(request.params.id);

  if (!invoiceId) {
    return response.status(400).json({ errors: ["Invoice id must be a positive integer."] });
  }

  const documentData = loadInvoiceDocumentData(invoiceId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Invoice not found."] });
  }

  const { generateThermalReceipt } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateThermalReceipt(documentData.invoice, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="${documentData.invoice.invoice_number}-thermal.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/invoice/:id/template/:templateId", async (request, response) => {
  const invoiceId = parseInvoiceId(request.params.id);
  const templateId = parseInvoiceId(request.params.templateId);

  if (!invoiceId || !templateId) {
    return response.status(400).json({ errors: ["Invoice id and template id must be positive integers."] });
  }

  const documentData = loadInvoiceDocumentData(invoiceId);
  const template = loadPrintTemplate(templateId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Invoice not found."] });
  }

  if (!template || template.document_type === "LABEL") {
    return response.status(404).json({ errors: ["Invoice or receipt template not found."] });
  }

  const { generateTemplateInvoice } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateTemplateInvoice(documentData.invoice, documentData.organization, template);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="${documentData.invoice.invoice_number}-${template.name}.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/label/item/:id/:templateId", async (request, response) => {
  const itemId = parseInvoiceId(request.params.id);
  const templateId = parseInvoiceId(request.params.templateId);

  if (!itemId || !templateId) {
    return response.status(400).json({ errors: ["Item id and template id must be positive integers."] });
  }

  const item = db.query.items.findFirst({ where: eq(items.id, itemId) }).sync();
  const organization = db.select().from(organizationSettings).get();
  const template = loadPrintTemplate(templateId);

  if (!item || !organization) {
    return response.status(404).json({ errors: ["Item not found."] });
  }

  if (!template || template.document_type !== "LABEL") {
    return response.status(404).json({ errors: ["Label template not found."] });
  }

  const { generateBarcodeLabel } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateBarcodeLabel(
    {
      barcode: item.barcode,
      huid: item.huid,
      category: item.category,
      metal_type: item.metal_type,
      purity_karat: item.purity_karat,
      gross_weight_mg: item.gross_weight_mg,
      net_weight_mg: item.net_weight_mg,
      fine_weight_mg: item.fine_weight_mg || item.net_weight_mg,
      location: item.location
    },
    {
      shop_name: organization.shop_name,
      address: organization.address,
      gstin: organization.gstin,
      contact_number: organization.contact_number
    },
    template
  );

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="${item.barcode}-label.pdf"`);
  return response.send(pdfBuffer);
});

function loadInvoiceDocumentData(invoiceId: number) {
  const invoiceRow = db
    .select({
      invoice: invoices,
      customer: customers
    })
    .from(invoices)
    .leftJoin(customers, eq(invoices.customer_id, customers.id))
    .where(eq(invoices.id, invoiceId))
    .get();

  if (!invoiceRow) {
    return null;
  }

  const organization = db.select().from(organizationSettings).get();

  if (!organization) {
    return null;
  }

  const lines = db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoice_id, invoiceId))
    .all();

  const linesWithCerts = lines.map((line) => {
    const stones = db
      .select({ certificate_number: itemStones.certificate_number })
      .from(itemStones)
      .where(
        and(
          eq(itemStones.item_id, line.item_id),
          sql`${itemStones.certificate_number} IS NOT NULL AND ${itemStones.certificate_number} != ''`
        )
      )
      .all();
    const certificate_numbers = stones
      .map((s) => s.certificate_number)
      .filter((c): c is string => typeof c === "string" && c.trim() !== "");

    return {
      ...line,
      certificate_numbers
    };
  });
  const oldGoldPurchases = db
    .select()
    .from(urdPurchases)
    .where(eq(urdPurchases.invoice_id, invoiceId))
    .all();
  const paymentRows = db
    .select({
      entry: journalEntries,
      ledger: ledgers
    })
    .from(journalEntries)
    .leftJoin(ledgers, eq(journalEntries.ledger_id, ledgers.id))
    .where(eq(journalEntries.reference_id, invoiceId))
    .all()
    .filter((row) => row.entry.reference_type === "POS_INVOICE");

  const payments = summarizePayments(paymentRows);

  const invoice: InvoiceDocumentData = {
    id: invoiceRow.invoice.id,
    invoice_number: invoiceRow.invoice.invoice_number,
    invoice_type: invoiceRow.invoice.invoice_type,
    created_at: invoiceRow.invoice.created_at,
    customer: invoiceRow.customer
      ? {
          name: invoiceRow.customer.name,
          phone: invoiceRow.customer.phone
        }
      : null,
    hsn_code: invoiceRow.invoice.hsn_code,
    total_amount_paise: invoiceRow.invoice.total_amount_paise,
    gst_percentage: invoiceRow.invoice.gst_percentage,
    gst_amount_paise: invoiceRow.invoice.gst_amount_paise,
    discount_paise: invoiceRow.invoice.discount_paise,
    urd_deduction_paise: invoiceRow.invoice.urd_deduction_paise,
    gss_credit_paise: invoiceRow.invoice.gss_credit_paise,
    bill_prefix: invoiceRow.invoice.bill_prefix,
    manual_number: invoiceRow.invoice.manual_number,
    due_date: invoiceRow.invoice.due_date,
    salesman_name: invoiceRow.invoice.salesman_name,
    gst_not_required: invoiceRow.invoice.gst_not_required,
    payment_mode: invoiceRow.invoice.payment_mode,
    payment_reference_json: invoiceRow.invoice.payment_reference_json,
    lines: linesWithCerts,
    urdPurchases: oldGoldPurchases,
    payments
  };

  return {
    invoice,
    organization: {
      shop_name: organization.shop_name,
      address: organization.address,
      gstin: organization.gstin,
      contact_number: organization.contact_number
    }
  };
}

function summarizePayments(
  rows: Array<{
    entry: typeof journalEntries.$inferSelect;
    ledger: typeof ledgers.$inferSelect | null;
  }>
): PaymentDocumentData {
  const payments: PaymentDocumentData = {
    cash_paise: 0,
    upi_paise: 0,
    card_paise: 0,
    udhari_paise: 0,
    gss_credit_paise: 0
  };

  for (const row of rows) {
    const accountName = row.ledger?.account_name.toLowerCase() ?? "";
    const accountType = row.ledger?.account_type;
    const amountPaise = row.entry.amount_paise;

    if (accountType === "CUSTOMER_UDHARI") {
      payments.udhari_paise += amountPaise;
    } else if (accountType === "GSS_LIABILITY") {
      payments.gss_credit_paise += amountPaise;
    } else if (accountType === "CASH") {
      payments.cash_paise += amountPaise;
    } else if (accountType === "BANK" && accountName.includes("card")) {
      payments.card_paise += amountPaise;
    } else if (accountType === "BANK") {
      payments.upi_paise += amountPaise;
    }
  }

  return payments;
}

function loadPrintTemplate(templateId: number): PrintTemplateData | null {
  const row = db.query.printTemplates.findFirst({ where: eq(printTemplates.id, templateId) }).sync();

  if (!row || !row.is_active) {
    return null;
  }

  try {
    const parsed = JSON.parse(row.content_json) as PrintTemplateData["content"];
    return {
      name: row.name,
      document_type: row.document_type,
      page_size: row.page_size,
      content: {
        showLogo: Boolean(parsed.showLogo),
        showHeader: parsed.showHeader !== false,
        showFooter: parsed.showFooter !== false,
        headerLines: Array.isArray(parsed.headerLines) ? parsed.headerLines.filter((line): line is string => typeof line === "string") : [],
        footerText: typeof parsed.footerText === "string" ? parsed.footerText : "",
        fields: Array.isArray(parsed.fields) ? parsed.fields.filter((field): field is string => typeof field === "string") : [],
        columns: Array.isArray(parsed.columns) ? parsed.columns.filter((column): column is string => typeof column === "string") : []
      }
    };
  } catch {
    return null;
  }
}

function parseInvoiceId(value: string) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

documentRouter.get("/girvi/:id/pavati", async (request, response) => {
  const loanId = Number(request.params.id);
  const lang = typeof request.query.lang === "string" ? request.query.lang : "en";

  if (!Number.isInteger(loanId) || loanId <= 0) {
    return response.status(400).json({ errors: ["Loan id must be a positive integer."] });
  }

  const documentData = loadGirviDocumentData(loanId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Girvi loan not found."] });
  }

  const { generateGirviPavati } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateGirviPavati(documentData.loan, documentData.organization, lang);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="girvi-pavati-${loanId}.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/girvi/:id/release-receipt", async (request, response) => {
  const loanId = Number(request.params.id);

  if (!Number.isInteger(loanId) || loanId <= 0) {
    return response.status(400).json({ errors: ["Loan id must be a positive integer."] });
  }

  const documentData = loadGirviDocumentData(loanId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Girvi loan not found."] });
  }

  const repayments = db.select()
    .from(girviRepayments)
    .where(eq(girviRepayments.loan_id, loanId))
    .all();

  const totalRepaidPaise = repayments.reduce((sum, r) => sum + r.amount_paise, 0);
  const totalInterestAllocated = repayments.reduce((sum, r) => sum + r.interest_allocated_paise, 0);
  const totalPrincipalAllocated = repayments.reduce((sum, r) => sum + r.principal_allocated_paise, 0);
  const totalDiscountAllowed = repayments.reduce((sum, r) => sum + r.discount_paise, 0);
  const totalNoticeFeePaid = repayments.reduce((sum, r) => sum + (r.notice_fee_paid_paise ?? 0), 0);
  const totalLetterFeePaid = repayments.reduce((sum, r) => sum + (r.loan_letter_fee_paid_paise ?? 0), 0);

  const releaseData = {
    ...documentData.loan,
    repayments: {
      total_repaid_paise: totalRepaidPaise,
      total_interest_allocated_paise: totalInterestAllocated,
      total_principal_allocated_paise: totalPrincipalAllocated,
      total_discount_allowed_paise: totalDiscountAllowed,
      total_notice_fee_paid_paise: totalNoticeFeePaid,
      total_letter_fee_paid_paise: totalLetterFeePaid
    }
  };

  const { generateGirviReleaseReceipt } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateGirviReleaseReceipt(releaseData as any, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="girvi-release-${loanId}.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/girvi/:id/legal-notice", async (request, response) => {
  const loanId = Number(request.params.id);
  const lang = typeof request.query.lang === "string" ? request.query.lang : "en";

  if (!Number.isInteger(loanId) || loanId <= 0) {
    return response.status(400).json({ errors: ["Loan id must be a positive integer."] });
  }

  const documentData = loadGirviDocumentData(loanId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Girvi loan not found."] });
  }

  const repayments = db.select()
    .from(girviRepayments)
    .where(eq(girviRepayments.loan_id, loanId))
    .all();

  const totalPrincipalRepaid = repayments.reduce((sum, r) => sum + r.principal_allocated_paise, 0);
  const outstandingPrincipal = Math.max(0, documentData.loan.principal_amount_paise - totalPrincipalRepaid);

  const lastRepayment = repayments.length > 0 ? repayments[repayments.length - 1] : null;
  const fromDate = lastRepayment?.payment_date ?? documentData.loan.issue_date;
  const todayStr = new Date().toISOString().slice(0, 10);
  
  const { differenceInCalendarDays, parseISO } = await import("date-fns");
  const elapsedDays = Math.max(differenceInCalendarDays(parseISO(todayStr), parseISO(fromDate)), 0);
  const periodType = documentData.loan.interest_period_type || documentData.loan.rate_period || "MONTHLY";
  const periodDays = periodType === "DAILY" ? 1 : periodType === "WEEKLY" ? 7 : periodType === "ANNUALLY" ? 365 : 30;
  const rateBasisPoints = Math.round(documentData.loan.interest_rate_percentage * 100);
  const accruedInterestPaise = Math.round((outstandingPrincipal * rateBasisPoints * elapsedDays) / (10000 * periodDays));

  const totalDuePaise = outstandingPrincipal + accruedInterestPaise + documentData.loan.notice_fee_paise + documentData.loan.loan_letter_fee_paise;

  const noticeData = {
    ...documentData.loan,
    outstanding_principal_paise: outstandingPrincipal,
    accrued_interest_paise: accruedInterestPaise,
    total_due_paise: totalDuePaise,
    notice_date: todayStr
  };

  const { generateGirviLegalNotice } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateGirviLegalNotice(noticeData as any, documentData.organization, lang);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="girvi-notice-${loanId}.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/girvi/repayment/:id/receipt", async (request, response) => {
  const repaymentId = Number(request.params.id);

  if (!Number.isInteger(repaymentId) || repaymentId <= 0) {
    return response.status(400).json({ errors: ["Repayment id must be a positive integer."] });
  }

  const documentData = loadGirviRepaymentDocumentData(repaymentId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Repayment not found."] });
  }

  const { generateGirviReceipt } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateGirviReceipt(documentData.repayment, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="girvi-repayment-${repaymentId}.pdf"`);
  return response.send(pdfBuffer);
});

function loadGirviDocumentData(loanId: number) {
  const loanRow = db
    .select({
      loan: girviLoans,
      customer: customers
    })
    .from(girviLoans)
    .innerJoin(customers, eq(girviLoans.customer_id, customers.id))
    .where(eq(girviLoans.id, loanId))
    .get();

  if (!loanRow) return null;

  const organization = db.select().from(organizationSettings).get();
  if (!organization) return null;

  const collateral = db
    .select()
    .from(girviCollateral)
    .where(eq(girviCollateral.loan_id, loanId))
    .all();

  return {
    loan: {
      ...loanRow.loan,
      customer: {
        name: loanRow.customer.name,
        phone: loanRow.customer.phone,
        address: loanRow.customer.address,
        pan_number: loanRow.customer.pan_number,
        aadhaar_number: loanRow.customer.aadhaar_number
      },
      collateral
    },
    organization: {
      shop_name: organization.shop_name,
      address: organization.address,
      gstin: organization.gstin,
      contact_number: organization.contact_number
    }
  };
}

function loadGirviRepaymentDocumentData(repaymentId: number) {
  const repaymentRow = db
    .select({
      repayment: girviRepayments,
      loan: girviLoans,
      customer: customers
    })
    .from(girviRepayments)
    .innerJoin(girviLoans, eq(girviRepayments.loan_id, girviLoans.id))
    .innerJoin(customers, eq(girviLoans.customer_id, customers.id))
    .where(eq(girviRepayments.id, repaymentId))
    .get();

  if (!repaymentRow) return null;

  const organization = db.select().from(organizationSettings).get();
  if (!organization) return null;

  const repayments = db
    .select()
    .from(girviRepayments)
    .where(eq(girviRepayments.loan_id, repaymentRow.loan.id))
    .all();

  const totalRepaidPrincipal = repayments.reduce((sum, r) => sum + r.principal_allocated_paise, 0);
  const outstandingPrincipal = Math.max(0, repaymentRow.loan.principal_amount_paise - totalRepaidPrincipal);

  const totalLetterFeePaid = repayments.reduce((sum, r) => sum + (r.loan_letter_fee_paid_paise ?? 0), 0);
  const totalNoticeFeePaid = repayments.reduce((sum, r) => sum + (r.notice_fee_paid_paise ?? 0), 0);
  const outstandingFees = Math.max(0, repaymentRow.loan.loan_letter_fee_paise - totalLetterFeePaid) +
                         Math.max(0, repaymentRow.loan.notice_fee_paise - totalNoticeFeePaid);

  return {
    repayment: {
      ...repaymentRow.repayment,
      loan_number: repaymentRow.loan.loan_number,
      customer: {
        name: repaymentRow.customer.name,
        phone: repaymentRow.customer.phone
      },
      outstanding_principal_paise: outstandingPrincipal,
      outstanding_fees_paise: outstandingFees
    },
    organization: {
      shop_name: organization.shop_name,
      address: organization.address,
      gstin: organization.gstin,
      contact_number: organization.contact_number
    }
  };
}

documentRouter.get("/urd-voucher/:id", async (request, response) => {
  const voucherId = parseInvoiceId(request.params.id);

  if (!voucherId) {
    return response.status(400).json({ errors: ["URD voucher id must be a positive integer."] });
  }

  const documentData = loadUrdVoucherDocumentData(voucherId);

  if (!documentData) {
    return response.status(404).json({ errors: ["URD voucher not found."] });
  }

  const { generateUrdVoucher } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateUrdVoucher(documentData.voucher, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="${documentData.voucher.voucher_number}.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/gss/receipt/:id", async (request, response) => {
  const receiptId = parseInvoiceId(request.params.id);

  if (!receiptId) {
    return response.status(400).json({ errors: ["GSS receipt id must be a positive integer."] });
  }

  const documentData = loadGssReceiptDocumentData(receiptId);

  if (!documentData) {
    return response.status(404).json({ errors: ["GSS receipt not found."] });
  }

  const { generateGssReceipt } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateGssReceipt(documentData.receipt, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="gss-receipt-${receiptId}.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/voucher/:id", async (request, response) => {
  const voucherId = parseInvoiceId(request.params.id);

  if (!voucherId) {
    return response.status(400).json({ errors: ["Voucher id must be a positive integer."] });
  }

  const documentData = loadVoucherDocumentData(voucherId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Voucher not found."] });
  }

  const { generateVoucherDocument } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateVoucherDocument(documentData.voucher, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="${documentData.voucher.voucher_number}.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/karigar/job/:id/slip", async (request, response) => {
  const jobId = parseInvoiceId(request.params.id);

  if (!jobId) {
    return response.status(400).json({ errors: ["Karigar job id must be a positive integer."] });
  }

  const documentData = loadKarigarSlipDocumentData(jobId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Karigar job not found."] });
  }

  const { generateKarigarSlip } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateKarigarSlip(documentData.slip, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="karigar-slip-${documentData.slip.job.order_number}.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/refinery/transfer/:id/challan", async (request, response) => {
  const transferId = parseInvoiceId(request.params.id);

  if (!transferId) {
    return response.status(400).json({ errors: ["Refinery transfer id must be a positive integer."] });
  }

  const documentData = loadRefineryChallanDocumentData(transferId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Refinery transfer not found."] });
  }

  const { generateRefineryChallan } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateRefineryChallan(documentData.challan, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="refinery-challan-${transferId}.pdf"`);
  return response.send(pdfBuffer);
});

documentRouter.get("/stock-verification/:id/report", async (request, response) => {
  const sessionId = parseInvoiceId(request.params.id);

  if (!sessionId) {
    return response.status(400).json({ errors: ["Stock verification session id must be a positive integer."] });
  }

  const documentData = loadStockVerificationReportDocumentData(sessionId);

  if (!documentData) {
    return response.status(404).json({ errors: ["Stock verification session not found."] });
  }

  const { generateStockVerificationReport } = await import("../utils/pdfGenerator.js");
  const pdfBuffer = await generateStockVerificationReport(documentData.report, documentData.organization);

  response.setHeader("Content-Type", "application/pdf");
  response.setHeader("Content-Disposition", `inline; filename="stock-verification-${sessionId}.pdf"`);
  return response.send(pdfBuffer);
});

function loadUrdVoucherDocumentData(voucherId: number) {
  const voucher = db.select().from(urdVouchers).where(eq(urdVouchers.id, voucherId)).get();
  const organization = loadOrganization();

  if (!voucher || !organization) return null;

  return { voucher, organization };
}

function loadGssReceiptDocumentData(receiptId: number) {
  const row = db
    .select({
      receipt: gssReceipts,
      account: gssAccounts,
      template: gssTemplates,
      customer: customers
    })
    .from(gssReceipts)
    .innerJoin(gssAccounts, eq(gssReceipts.gss_account_id, gssAccounts.id))
    .innerJoin(gssTemplates, eq(gssAccounts.template_id, gssTemplates.id))
    .innerJoin(customers, eq(gssAccounts.customer_id, customers.id))
    .where(eq(gssReceipts.id, receiptId))
    .get();
  const organization = loadOrganization();

  if (!row || !organization) return null;

  return {
    receipt: {
      id: row.receipt.id,
      card_number: row.account.card_number,
      installment_number: row.receipt.installment_number,
      payment_date: row.receipt.payment_date,
      amount_paid_paise: row.receipt.amount_paid_paise,
      payment_mode: row.receipt.payment_mode,
      customer_name: row.customer.name,
      customer_phone: row.customer.phone,
      scheme_name: row.template.scheme_name,
      scheme_code: row.template.scheme_code,
      duration_months: row.template.duration_months,
      monthly_amount_paise: row.template.monthly_amount_paise,
      enrollment_date: row.account.enrollment_date,
      maturity_date: row.account.maturity_date,
      total_paid_paise: row.account.total_paid_paise,
      installments_paid_count: row.account.installments_paid_count,
      status: row.account.status
    },
    organization
  };
}

function loadVoucherDocumentData(voucherId: number) {
  const voucher = db.select().from(voucherHeaders).where(eq(voucherHeaders.id, voucherId)).get();
  const organization = loadOrganization();

  if (!voucher || !organization) return null;

  const lines = db
    .select({
      line: voucherLines,
      ledger: ledgers
    })
    .from(voucherLines)
    .innerJoin(ledgers, eq(voucherLines.ledger_id, ledgers.id))
    .where(eq(voucherLines.voucher_id, voucherId))
    .all();

  return {
    voucher: {
      ...voucher,
      lines: lines.map((row) => ({
        account_name: row.ledger.account_name,
        account_type: row.ledger.account_type,
        transaction_type: row.line.transaction_type,
        amount_paise: row.line.amount_paise,
        description: row.line.description
      }))
    },
    organization
  };
}

function loadKarigarSlipDocumentData(jobId: number) {
  const row = db
    .select({
      job: jobOrders,
      karigar: karigars
    })
    .from(jobOrders)
    .innerJoin(karigars, eq(jobOrders.karigar_id, karigars.id))
    .where(eq(jobOrders.id, jobId))
    .get();
  const organization = loadOrganization();

  if (!row || !organization) return null;

  const issues = db.select().from(materialIssues).where(eq(materialIssues.job_id, jobId)).all();
  const receipts = db.select().from(jobReceipts).where(eq(jobReceipts.job_id, jobId)).all();

  return {
    slip: {
      job: {
        id: row.job.id,
        order_number: row.job.order_number,
        target_purity: row.job.target_purity,
        target_weight_mg: row.job.target_weight_mg,
        status: row.job.status,
        created_at: row.job.created_at
      },
      karigar: {
        name: row.karigar.name,
        phone: row.karigar.phone,
        specialty: row.karigar.specialty
      },
      issues,
      receipts
    },
    organization
  };
}

function loadRefineryChallanDocumentData(transferId: number) {
  const row = db
    .select({
      transfer: refineryTransfers,
      refinery: refineries
    })
    .from(refineryTransfers)
    .innerJoin(refineries, eq(refineryTransfers.refinery_id, refineries.id))
    .where(eq(refineryTransfers.id, transferId))
    .get();
  const organization = loadOrganization();

  if (!row || !organization) return null;

  return {
    challan: {
      ...row.transfer,
      refinery: {
        name: row.refinery.name,
        phone: row.refinery.phone
      }
    },
    organization
  };
}

function loadStockVerificationReportDocumentData(sessionId: number) {
  const session = db.select().from(stockVerificationSessions).where(eq(stockVerificationSessions.id, sessionId)).get();
  const organization = loadOrganization();

  if (!session || !organization) return null;

  const expectedItems = db.select().from(items).where(eq(items.status, session.expected_status)).all();
  const scans = db.select().from(stockVerificationScans).where(eq(stockVerificationScans.session_id, session.id)).all();
  const foundItemIds = new Set(scans.filter((scan) => scan.item_id).map((scan) => scan.item_id as number));
  const missingItems = expectedItems.filter((item) => !foundItemIds.has(item.id));
  const foundItems = expectedItems.filter((item) => foundItemIds.has(item.id));
  const unknownScans = scans.filter((scan) => scan.result === "UNKNOWN");

  return {
    report: {
      session: {
        id: session.id,
        name: session.name,
        location: session.location,
        expected_status: session.expected_status,
        status: session.status,
        created_at: session.created_at,
        completed_at: session.completed_at
      },
      counts: {
        expected: expectedItems.length,
        found: foundItems.length,
        missing: missingItems.length,
        unknown: unknownScans.length,
        scanned: scans.length
      },
      found_items: foundItems.map(formatStockVerificationItem),
      missing_items: missingItems.map(formatStockVerificationItem),
      unknown_scans: unknownScans.map((scan) => ({
        barcode: scan.barcode,
        scanned_at: scan.scanned_at
      }))
    },
    organization
  };
}

function formatStockVerificationItem(item: typeof items.$inferSelect) {
  return {
    barcode: item.barcode,
    huid: item.huid,
    category: item.category,
    metal_type: item.metal_type,
    purity_karat: item.purity_karat,
    gross_weight_mg: item.gross_weight_mg,
    net_weight_mg: item.net_weight_mg,
    location: item.location
  };
}

function loadOrganization() {
  const organization = db.select().from(organizationSettings).get();

  if (!organization) return null;

  return {
    shop_name: organization.shop_name,
    address: organization.address,
    gstin: organization.gstin,
    contact_number: organization.contact_number
  };
}

// Renders a high-quality double-sided PVC card for printing
documentRouter.get("/huid-card/:itemId", async (request, response) => {
  const itemId = Number(request.params.itemId);

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return response.status(400).send("Item ID must be a positive integer.");
  }

  const item = db.query.items.findFirst({ where: eq(items.id, itemId) }).sync();
  const organization = db.select().from(organizationSettings).get();

  if (!item) {
    return response.status(404).send("Item not found.");
  }

  if (!item.huid) {
    return response.status(400).send("This item does not have a registered HUID.");
  }

  const shopName = organization?.shop_name ?? "Shree Jewellers";
  const hallmarkCenter = item.hallmark_center_name ?? "BIS Assaying Center";
  const hallmarkDate = item.hallmark_returned_at ?? new Date().toISOString().slice(0, 10);
  const certNo = item.huid_certificate_number ?? `CERT-${item.huid}`;
  const purityLabel = item.purity_karat === 22 ? "22K (916)" : item.purity_karat === 18 ? "18K (750)" : `${item.purity_karat}K`;

  const weightGrams = (item.net_weight_mg / 1000).toFixed(3);
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&margin=0&data=${encodeURIComponent("https://verify.bis.gov.in/verify/huid/" + item.huid)}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>HUID Card - ${item.huid}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&family=Outfit:wght@400;600;700&display=swap');
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: #0f172a;
      color: #f8fafc;
      font-family: 'Outfit', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      gap: 30px;
      padding: 20px;
    }

    .card-container {
      display: flex;
      flex-wrap: wrap;
      gap: 40px;
      justify-content: center;
    }

    .pvc-card {
      width: 85.6mm;
      height: 54mm;
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      border: 1px solid rgba(255, 215, 0, 0.15);
      border-radius: 3.18mm;
      position: relative;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
      font-size: 8.5px;
      line-height: 1.2;
    }

    @media print {
      body {
        background: transparent;
        color: #000;
        padding: 0;
        margin: 0;
        display: block;
      }
      .card-container {
        display: block;
        gap: 0;
      }
      .pvc-card {
        box-shadow: none;
        page-break-after: always;
        border: none;
        margin: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .no-print {
        display: none !important;
      }
    }

    .front {
      background: linear-gradient(135deg, #111827 0%, #1f2937 100%), radial-gradient(circle at 10% 20%, rgba(255, 215, 0, 0.05) 0%, transparent 40%);
      padding: 3mm 4mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .front-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 0.5px solid rgba(255, 215, 0, 0.2);
      padding-bottom: 1.5mm;
    }

    .shop-logo-title {
      font-family: 'Montserrat', sans-serif;
      font-size: 11px;
      font-weight: 800;
      color: #fbbf24;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .cert-badge {
      background: linear-gradient(90deg, #fbbf24, #f59e0b);
      color: #000;
      font-weight: 700;
      font-size: 6px;
      padding: 0.6mm 1.5mm;
      border-radius: 1mm;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .front-body {
      display: flex;
      flex-grow: 1;
      align-items: center;
      justify-content: space-between;
      padding: 2.5mm 0;
    }

    .bis-hallmark-logo {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5mm;
    }

    .bis-symbol {
      width: 14mm;
      height: 14mm;
      fill: #fbbf24;
    }

    .bis-text {
      font-size: 5px;
      font-weight: 700;
      color: #9ca3af;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    .huid-badge-container {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 1mm;
    }

    .huid-label {
      font-size: 6px;
      font-weight: 600;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .huid-val {
      font-family: 'Montserrat', sans-serif;
      font-size: 19px;
      font-weight: 800;
      color: #ffffff;
      letter-spacing: 1px;
      background: rgba(255, 255, 255, 0.05);
      border: 0.5px solid rgba(255, 255, 255, 0.1);
      padding: 1mm 2.5mm;
      border-radius: 1.5mm;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
    }

    .front-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 6px;
      color: #9ca3af;
      border-top: 0.5px solid rgba(255, 255, 255, 0.08);
      padding-top: 1.5mm;
    }

    .front-footer span {
      font-weight: 600;
    }

    .back {
      background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
      padding: 3mm 4mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .back-body {
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 100%;
    }

    .specs-table {
      width: 58%;
      border-collapse: collapse;
    }

    .specs-table td {
      padding: 1.2mm 0;
      border-bottom: 0.5px solid rgba(255, 255, 255, 0.05);
    }

    .specs-table tr:last-child td {
      border-bottom: none;
    }

    .spec-name {
      color: #9ca3af;
      font-weight: 600;
      text-transform: uppercase;
      font-size: 6px;
      letter-spacing: 0.3px;
    }

    .spec-value {
      color: #ffffff;
      font-weight: 700;
      text-align: right;
      font-size: 7.5px;
    }

    .qr-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5mm;
      width: 38%;
      border-left: 0.5px solid rgba(255, 255, 255, 0.1);
      padding-left: 3mm;
    }

    .qr-image {
      width: 14mm;
      height: 14mm;
      border: 1px solid #fbbf24;
      background-color: #fff;
      padding: 0.5mm;
      border-radius: 1mm;
    }

    .qr-caption {
      font-size: 5px;
      font-weight: 700;
      color: #fbbf24;
      text-transform: uppercase;
      letter-spacing: 0.2px;
      text-align: center;
    }

    .action-panel {
      background-color: #1e293b;
      border: 1px solid #334155;
      padding: 15px 30px;
      border-radius: 8px;
      display: flex;
      gap: 15px;
      align-items: center;
      width: 100%;
      max-width: 600px;
      justify-content: space-between;
    }

    .action-info {
      font-size: 12px;
      color: #94a3b8;
    }

    .action-info strong {
      color: #fff;
    }

    .btn {
      background: linear-gradient(90deg, #10b981, #059669);
      color: #000;
      font-family: inherit;
      font-weight: 700;
      border: none;
      padding: 10px 20px;
      font-size: 12px;
      border-radius: 4px;
      cursor: pointer;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      transition: opacity 0.2s;
    }

    .btn:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>

  <div class="action-panel no-print">
    <div class="action-info">
      <p>HUID Certificate PVC Card Print Preview for <strong>${item.barcode}</strong></p>
      <p style="margin-top: 3px; font-size: 11px;">Place CR80 PVC Card media in your card printer before printing.</p>
    </div>
    <button class="btn" onclick="window.print()">Print Card</button>
  </div>

  <div class="card-container">
    <div class="pvc-card front">
      <div class="front-header">
        <div class="shop-logo-title">${shopName}</div>
        <div class="cert-badge">Hallmarked Jewellers</div>
      </div>
      <div class="front-body">
        <div class="bis-hallmark-logo">
          <svg class="bis-symbol" viewBox="0 0 100 100">
            <polygon points="50,10 90,80 10,80" stroke-width="6" stroke="#fbbf24" fill="none" />
            <polygon points="50,22 80,74 20,74" fill="#fbbf24" />
            <circle cx="50" cy="52" r="10" fill="#111827" />
          </svg>
          <div class="bis-text">BIS HALLMARK</div>
        </div>
        <div class="huid-badge-container">
          <div class="huid-label">Gold HUID</div>
          <div class="huid-val">${item.huid}</div>
        </div>
      </div>
      <div class="front-footer">
        <div>Center: <span>${hallmarkCenter}</span></div>
        <div>Date: <span>${hallmarkDate}</span></div>
      </div>
    </div>

    <div class="pvc-card back">
      <div class="back-body">
        <table class="specs-table">
          <tr>
            <td class="spec-name">Item Code</td>
            <td class="spec-value">${item.barcode}</td>
          </tr>
          <tr>
            <td class="spec-name">Metal / Purity</td>
            <td class="spec-value">${item.metal_type} / ${purityLabel}</td>
          </tr>
          <tr>
            <td class="spec-name">Net Weight</td>
            <td class="spec-value">${weightGrams} g</td>
          </tr>
          <tr>
            <td class="spec-name">Cert No.</td>
            <td class="spec-value">${certNo}</td>
          </tr>
        </table>
        <div class="qr-container">
          <img class="qr-image" src="${qrCodeUrl}" alt="Verification QR" />
          <div class="qr-caption">Scan to Verify</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    window.onload = () => {
      fetch('/api/compliance/huid/print-certificate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ item_id: ${item.id} })
      })
      .then(res => res.json())
      .then(data => console.log("Printing logged successfully:", data))
      .catch(err => console.error("Logging print event failed:", err));
      
      setTimeout(() => {
        if (!window.location.search.includes('noprint')) {
          window.print();
        }
      }, 800);
    };
  </script>
</body>
</html>
  `;

  response.setHeader("Content-Type", "text/html");
  return response.send(html);
});
