import ExcelJS from "exceljs";
import type { B2bB2cData, Gstr3bSummary, HsnRow } from "../compliance/gstReportData.js";

// Excel workbooks for the GST returns, downloadable from the GST Reports module
// so the CA gets a ready-to-file spreadsheet instead of CSV.

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

function styleHeaderRow(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.border = { bottom: { style: "thin" } };
  });
}

function periodLabel(from: string | null, to: string | null) {
  return `Period: ${from ?? "beginning"} to ${to ?? "today"}`;
}

async function workbookBuffer(workbook: ExcelJS.Workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function buildGstr1Workbook(rows: HsnRow[], from: string | null, to: string | null) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("GSTR-1 HSN");

  sheet.addRow(["GSTR-1 HSN Summary"]).font = { bold: true, size: 14 };
  sheet.addRow([periodLabel(from, to)]);
  sheet.addRow([]);

  const header = sheet.addRow(["HSN/SC", "Description", "UQC", "Qty", "Supply Type", "Rate %", "Taxable Value", "IGST", "CGST", "SGST", "Cess"]);
  styleHeaderRow(header);

  for (const row of rows) {
    sheet.addRow([
      row.hsn_sc,
      row.desc,
      row.uqc,
      row.qty,
      row.supply_type,
      row.rt,
      Number(row.txval),
      Number(row.iamt),
      Number(row.camt),
      Number(row.samt),
      Number(row.csamt)
    ]);
  }

  const totals = sheet.addRow([
    "TOTAL",
    "",
    "",
    rows.reduce((total, row) => total + row.qty, 0),
    "",
    "",
    rows.reduce((total, row) => total + Number(row.txval), 0),
    rows.reduce((total, row) => total + Number(row.iamt), 0),
    rows.reduce((total, row) => total + Number(row.camt), 0),
    rows.reduce((total, row) => total + Number(row.samt), 0),
    rows.reduce((total, row) => total + Number(row.csamt), 0)
  ]);
  totals.font = { bold: true };

  sheet.columns.forEach((column) => {
    column.width = 14;
  });

  return workbookBuffer(workbook);
}

export async function buildB2bB2cWorkbook(data: B2bB2cData, from: string | null, to: string | null) {
  const workbook = new ExcelJS.Workbook();

  const b2bSheet = workbook.addWorksheet("B2B");
  b2bSheet.addRow(["GSTR-1 B2B (registered customers)"]).font = { bold: true, size: 14 };
  b2bSheet.addRow([periodLabel(from, to)]);
  b2bSheet.addRow([]);
  styleHeaderRow(b2bSheet.addRow(["Invoice No.", "GSTIN", "Customer", "Supply Type", "Rate %", "Taxable Value", "CGST", "SGST", "IGST", "Total"]));
  for (const row of data.b2b) {
    b2bSheet.addRow([
      row.invoice_number ?? "",
      row.gstin ?? "",
      row.customer_name ?? "",
      row.supply_type,
      row.rate,
      Number(row.taxable_value_rupees),
      Number(row.cgst_rupees),
      Number(row.sgst_rupees),
      Number(row.igst_rupees),
      Number(row.total_rupees)
    ]);
  }
  b2bSheet.columns.forEach((column) => {
    column.width = 16;
  });

  const b2cSheet = workbook.addWorksheet("B2C");
  b2cSheet.addRow(["GSTR-1 B2C (rate-wise summary)"]).font = { bold: true, size: 14 };
  b2cSheet.addRow([periodLabel(from, to)]);
  b2cSheet.addRow([]);
  styleHeaderRow(b2cSheet.addRow(["Supply Type", "Rate %", "Taxable Value", "CGST", "SGST", "IGST", "Total"]));
  for (const row of data.b2c) {
    b2cSheet.addRow([
      row.supply_type,
      row.rate,
      Number(row.taxable_value_rupees),
      Number(row.cgst_rupees),
      Number(row.sgst_rupees),
      Number(row.igst_rupees),
      Number(row.total_rupees)
    ]);
  }
  b2cSheet.columns.forEach((column) => {
    column.width = 16;
  });

  const summarySheet = workbook.addWorksheet("Totals");
  styleHeaderRow(summarySheet.addRow(["Metric", "Value"]));
  summarySheet.addRow(["B2B invoice count", data.totals.b2b_invoice_count]);
  summarySheet.addRow(["B2C summary rows", data.totals.b2c_summary_count]);
  summarySheet.addRow(["B2B total (Rs)", Number(data.totals.b2b_total_rupees)]);
  summarySheet.addRow(["B2C total (Rs)", Number(data.totals.b2c_total_rupees)]);
  summarySheet.columns.forEach((column) => {
    column.width = 24;
  });

  return workbookBuffer(workbook);
}

export async function buildGstr3bWorkbook(summary: Gstr3bSummary) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("GSTR-3B");

  sheet.addRow(["GSTR-3B Summary"]).font = { bold: true, size: 14 };
  sheet.addRow([periodLabel(summary.date_range.from, summary.date_range.to)]);
  sheet.addRow([]);

  styleHeaderRow(sheet.addRow(["Section", "Taxable Value", "CGST", "SGST", "IGST", "Cess"]));
  sheet.addRow([
    "Outward supplies",
    Number(summary.outward_supplies.taxable_value_rupees),
    Number(summary.outward_supplies.cgst_rupees),
    Number(summary.outward_supplies.sgst_rupees),
    Number(summary.outward_supplies.igst_rupees),
    Number(summary.outward_supplies.cess_rupees)
  ]);
  sheet.addRow([
    "Inward supplies",
    Number(summary.inward_supplies.taxable_value_rupees),
    Number(summary.inward_supplies.cgst_rupees),
    Number(summary.inward_supplies.sgst_rupees),
    Number(summary.inward_supplies.igst_rupees),
    Number(summary.inward_supplies.cess_rupees)
  ]);
  const net = sheet.addRow([
    "Net payable",
    "",
    Number(summary.net_payable.cgst_rupees),
    Number(summary.net_payable.sgst_rupees),
    Number(summary.net_payable.igst_rupees),
    Number(summary.net_payable.cess_rupees)
  ]);
  net.font = { bold: true };

  sheet.columns.forEach((column) => {
    column.width = 18;
  });

  return workbookBuffer(workbook);
}
