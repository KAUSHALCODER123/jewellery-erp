import fs from "node:fs";
import path from "node:path";
import pdfMake from "pdfmake";

export type OrganizationData = {
  shop_name: string;
  address: string;
  gstin: string | null;
  contact_number: string;
  print_language?: string | null;
};

export type PrintLanguage = "english" | "marathi" | "hindi" | "gujarati";

type L10n = {
  taxInvoice: string; receipt: string; serialNo: string; itemDescription: string; hsn: string;
  grossWt: string; stoneWt: string; netWt: string; rate: string; making: string; total: string;
  invoiceNo: string; date: string; customer: string; phone: string; paymentDetails: string;
  cash: string; upi: string; card: string; udhari: string; gssCredit: string;
  grossTotal: string; discount: string; gstAmount: string; netPayable: string;
  oldGoldExchange: string; oldGoldExchanged: string; weight: string; ratePerG: string;
  deduction: string; tunch: string; customerSignature: string; authorizedSignatory: string;
  thankYou: string; certified: string; purity: string; item: string; gst: string; amount: string;
  gross: string; urd: string; payments: string; gWt: string; sWt: string; nWt: string; mc: string;
};

const EN: L10n = {
  taxInvoice: "TAX INVOICE", receipt: "RECEIPT", serialNo: "S.No", itemDescription: "Item Description",
  hsn: "HSN", grossWt: "Gross Wt", stoneWt: "Stone Wt", netWt: "Net Wt", rate: "Rate",
  making: "Making", total: "Total", invoiceNo: "Invoice No.", date: "Date", customer: "Customer",
  phone: "Phone", paymentDetails: "Payment Details", cash: "Cash", upi: "UPI", card: "Card",
  udhari: "Udhari", gssCredit: "GSS Credit", grossTotal: "Gross Total", discount: "Discount",
  gstAmount: "GST Amount", netPayable: "Net Payable",
  oldGoldExchange: "Old Gold Exchange (URD) Details", oldGoldExchanged: "Old Gold Exchanged:",
  weight: "Weight", ratePerG: "Rate/g", deduction: "Deduction", tunch: "Tunch",
  customerSignature: "Customer Signature", authorizedSignatory: "Authorized Signatory",
  thankYou: "Thank you",
  certified: "Certified that the particulars given above are true and correct.",
  purity: "Purity", item: "Item", gst: "GST", amount: "Amount", gross: "Gross", urd: "URD",
  payments: "Payments", gWt: "G.Wt", sWt: "S.Wt", nWt: "N.Wt", mc: "MC"
};

const MR: L10n = {
  taxInvoice: "कर चलान", receipt: "पावती", serialNo: "क्र.नं.", itemDescription: "वस्तू तपशील",
  hsn: "HSN", grossWt: "एकूण वजन", stoneWt: "खडे वजन", netWt: "निव्वळ वजन", rate: "दर",
  making: "घडवण", total: "एकूण", invoiceNo: "चलान क्र.", date: "दिनांक", customer: "ग्राहक",
  phone: "फोन", paymentDetails: "भरणा तपशील", cash: "रोख", upi: "UPI", card: "कार्ड",
  udhari: "उधारी", gssCredit: "GSS जमा", grossTotal: "एकूण रक्कम", discount: "सवलत",
  gstAmount: "GST रक्कम", netPayable: "देय रक्कम",
  oldGoldExchange: "जुने सोने विनिमय (URD) तपशील", oldGoldExchanged: "जुने सोने बदलले:",
  weight: "वजन", ratePerG: "दर/ग्रॅम", deduction: "कपात", tunch: "तोळ",
  customerSignature: "ग्राहकाची सही", authorizedSignatory: "अधिकृत सही",
  thankYou: "धन्यवाद",
  certified: "वरील माहिती खरी व बरोबर असल्याचे प्रमाणित करतो.",
  purity: "शुद्धता", item: "वस्तू", gst: "GST", amount: "रक्कम", gross: "एकूण",
  urd: "जुने सोने", payments: "भरणा", gWt: "ए.व", sWt: "ख.व", nWt: "नि.व", mc: "घड"
};

const HI: L10n = {
  taxInvoice: "कर बीजक", receipt: "रसीद", serialNo: "क्र.सं.", itemDescription: "वस्तु विवरण",
  hsn: "HSN", grossWt: "कुल वजन", stoneWt: "पत्थर वजन", netWt: "शुद्ध वजन", rate: "दर",
  making: "बनाई", total: "कुल", invoiceNo: "चालान नं.", date: "तारीख", customer: "ग्राहक",
  phone: "फ़ोन", paymentDetails: "भुगतान विवरण", cash: "नकद", upi: "UPI", card: "कार्ड",
  udhari: "उधारी", gssCredit: "GSS जमा", grossTotal: "कुल राशि", discount: "छूट",
  gstAmount: "GST राशि", netPayable: "देय राशि",
  oldGoldExchange: "पुराना सोना विनिमय (URD) विवरण", oldGoldExchanged: "पुराना सोना बदला:",
  weight: "वजन", ratePerG: "दर/ग्राम", deduction: "कटौती", tunch: "तुंच",
  customerSignature: "ग्राहक हस्ताक्षर", authorizedSignatory: "अधिकृत हस्ताक्षर",
  thankYou: "धन्यवाद",
  certified: "उपरोक्त विवरण सत्य एवं सही है।",
  purity: "शुद्धता", item: "वस्तु", gst: "GST", amount: "राशि", gross: "कुल",
  urd: "पुराना सोना", payments: "भुगतान", gWt: "क.व", sWt: "प.व", nWt: "श.व", mc: "बना"
};

const GU: L10n = {
  taxInvoice: "કર ચલણ", receipt: "રસીદ", serialNo: "ક્ર.નં.", itemDescription: "વસ્તુ વર્ણન",
  hsn: "HSN", grossWt: "કુલ વજન", stoneWt: "પત્થર વજન", netWt: "ચોખ્ખું વજન", rate: "દર",
  making: "ઘડામણ", total: "કુલ", invoiceNo: "ચલણ ક્ર.", date: "તારીખ", customer: "ગ્રાહક",
  phone: "ફોન", paymentDetails: "ચુકવણી વિગત", cash: "રોકડ", upi: "UPI", card: "કાર્ડ",
  udhari: "ઉધારી", gssCredit: "GSS જમા", grossTotal: "કુલ રકમ", discount: "છૂટ",
  gstAmount: "GST રકમ", netPayable: "ચૂકવવાની રકમ",
  oldGoldExchange: "જૂના સોનાનો વ્યવહાર (URD) વિગત", oldGoldExchanged: "જૂના સોનાનો વ્યવહાર:",
  weight: "વજન", ratePerG: "દર/ગ્રામ", deduction: "કપાત", tunch: "તુંચ",
  customerSignature: "ગ્રાહક સહી", authorizedSignatory: "અધિકૃત સહી",
  thankYou: "આભાર",
  certified: "ઉપરોક્ત માહિતી સત્ય અને સાચી છે.",
  purity: "શુદ્ધતા", item: "વસ્તુ", gst: "GST", amount: "રકમ", gross: "કુલ",
  urd: "જૂના સોના", payments: "ચુકવણી", gWt: "ક.વ", sWt: "પ.વ", nWt: "ચ.વ", mc: "ઘડ"
};

export function getL10n(language?: string | null): L10n {
  if (language === "marathi") return MR;
  if (language === "hindi") return HI;
  if (language === "gujarati") return GU;
  return EN;
}

export type InvoiceDocumentData = {
  id: number;
  invoice_number: string;
  invoice_type?: string | null;
  created_at: string | null;
  customer: {
    name: string;
    phone: string;
  } | null;
  walk_in_name?: string | null;
  hsn_code: string | null;
  total_amount_paise: number;
  gst_percentage?: number | null;
  gst_amount_paise: number | null;
  discount_paise: number | null;
  urd_deduction_paise: number | null;
  gss_credit_paise: number | null;
  bill_prefix?: string | null;
  manual_number?: string | null;
  due_date?: string | null;
  salesman_name?: string | null;
  gst_not_required?: boolean | null;
  payment_mode?: string | null;
  payment_reference_json?: string | null;
  lines: InvoiceLineDocumentData[];
  urdPurchases: UrdPurchaseDocumentData[];
  payments: PaymentDocumentData;
};

export type InvoiceLineDocumentData = {
  metal_type: string;
  purity_karat: number;
  gross_weight_mg: number;
  stone_weight_mg: number | null;
  net_weight_mg: number;
  metal_rate_paise_per_gram: number;
  making_charge_paise: number;
  wastage_charge_paise: number | null;
  gst_paise: number | null;
  line_total_paise: number;
  certificate_numbers?: string[];
};

export type UrdPurchaseDocumentData = {
  description: string;
  metal_type: string;
  purity_tunch: string;
  weight_mg: number;
  applied_rate_paise_per_gram: number;
  deduction_amount_paise: number;
};

export type PaymentDocumentData = {
  cash_paise: number;
  upi_paise: number;
  card_paise: number;
  udhari_paise: number;
  gss_credit_paise: number;
};

export type PrintTemplateContent = {
  showLogo: boolean;
  showHeader: boolean;
  showFooter: boolean;
  headerLines: string[];
  footerText: string;
  fields: string[];
  columns: string[];
  accentColor?: string;
  headerTextColor?: string;
  fontSizeBase?: "small" | "medium" | "large";
};

export type PrintTemplateData = {
  name: string;
  document_type: "INVOICE" | "RECEIPT" | "LABEL";
  page_size: "A4" | "A5" | "THERMAL_80" | "LABEL_50X25" | "LABEL_65X35";
  content: PrintTemplateContent;
};

export type LabelItemDocumentData = {
  barcode: string;
  huid: string | null;
  category: string;
  metal_type: string;
  purity_karat: number;
  gross_weight_mg: number;
  net_weight_mg: number;
  fine_weight_mg: number;
  location: string | null;
};

const robotoBasePath = path.resolve(process.cwd(), "node_modules/pdfmake/fonts/Roboto");
const indicFontsDir = path.resolve(process.cwd(), "fonts");
const indicFontsLoaded: Record<string, boolean> = {};

pdfMake.setUrlAccessPolicy(() => false);
pdfMake.setLocalAccessPolicy((filePath) => {
  const resolved = path.resolve(filePath);
  return resolved.startsWith(robotoBasePath) || resolved.startsWith(indicFontsDir);
});
pdfMake.addFonts({
  Roboto: {
    normal: path.join(robotoBasePath, "Roboto-Regular.ttf"),
    bold: path.join(robotoBasePath, "Roboto-Medium.ttf"),
    italics: path.join(robotoBasePath, "Roboto-Italic.ttf"),
    bolditalics: path.join(robotoBasePath, "Roboto-MediumItalic.ttf")
  }
});

// Optional Indic fonts — place TTF files in <project>/fonts/ to enable regional-language PDFs.
// Download from: https://fonts.google.com/noto
//   fonts/NotoSansDevanagari-Regular.ttf  → for Marathi & Hindi
//   fonts/NotoSansGujarati-Regular.ttf    → for Gujarati
(function loadIndicFonts() {
  const devanagari = path.join(indicFontsDir, "NotoSansDevanagari-Regular.ttf");
  const gujarati = path.join(indicFontsDir, "NotoSansGujarati-Regular.ttf");
  try {
    if (fs.existsSync(devanagari)) {
      pdfMake.addFonts({ NotoDevanagari: { normal: devanagari, bold: devanagari, italics: devanagari, bolditalics: devanagari } });
      indicFontsLoaded["NotoDevanagari"] = true;
    }
    if (fs.existsSync(gujarati)) {
      pdfMake.addFonts({ NotoGujarati: { normal: gujarati, bold: gujarati, italics: gujarati, bolditalics: gujarati } });
      indicFontsLoaded["NotoGujarati"] = true;
    }
  } catch {
    // skip if fonts directory doesn't exist
  }
})();

function fontForLanguage(language?: string | null): string {
  if ((language === "marathi" || language === "hindi") && indicFontsLoaded["NotoDevanagari"]) return "NotoDevanagari";
  if (language === "gujarati" && indicFontsLoaded["NotoGujarati"]) return "NotoGujarati";
  return "Roboto";
}

export async function generateA4Invoice(invoiceData: InvoiceDocumentData, organizationData: OrganizationData) {
  const grossTotalPaise = invoiceData.lines.reduce((total, line) => total + line.line_total_paise, 0);
  const gstAmountPaise = invoiceData.gst_amount_paise ?? 0;
  const urdDeductionPaise = invoiceData.urd_deduction_paise ?? invoiceData.urdPurchases.reduce((total, line) => total + line.deduction_amount_paise, 0);
  const l = getL10n(organizationData.print_language);
  const font = fontForLanguage(organizationData.print_language);

  return createPdfBuffer({
    pageSize: "A4",
    pageMargins: [28, 32, 28, 36],
    defaultStyle: { font, fontSize: 9 },
    styles: {
      title: { fontSize: 15, bold: true, alignment: "center" },
      shopName: { fontSize: 14, bold: true },
      sectionLabel: { fontSize: 9, bold: true, color: "#334155" },
      tableHeader: { bold: true, fillColor: "#e2e8f0", color: "#0f172a" }
    },
    content: [
      { text: l.taxInvoice, style: "title", margin: [0, 0, 0, 8] },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: organizationData.shop_name, style: "shopName" },
              { text: organizationData.address },
              { text: `GSTIN: ${organizationData.gstin || "-"}` },
              { text: `Contact: ${organizationData.contact_number}` }
            ]
          },
          {
            width: 190,
            table: {
              widths: [70, "*"],
              body: [
                metaRow(l.invoiceNo, invoiceData.invoice_number),
                metaRow(l.date, formatDate(invoiceData.created_at)),
                metaRow(l.customer, invoiceData.customer?.name ?? invoiceData.walk_in_name ?? "Walk-in Customer"),
                metaRow(l.phone, invoiceData.customer?.phone ?? "-")
              ]
            },
            layout: "lightHorizontalLines"
          }
        ],
        margin: [0, 0, 0, 12]
      },
      {
        table: {
          headerRows: 1,
          widths: [22, "*", 42, 42, 42, 42, 54, 54, 58],
          body: [
            [l.serialNo, l.itemDescription, l.hsn, l.grossWt, l.stoneWt, l.netWt, l.rate, l.making, l.total].map((text) => ({
              text,
              style: "tableHeader"
            })),
            ...invoiceData.lines.map((line, index) => {
              const descriptionCell = line.certificate_numbers && line.certificate_numbers.length > 0
                ? {
                    stack: [
                      { text: `${line.metal_type} ${line.purity_karat}K` },
                      {
                        text: `Cert: ${line.certificate_numbers.join(", ")}`,
                        fontSize: 7.5,
                        color: "#475569",
                        margin: [0, 2, 0, 0]
                      }
                    ]
                  }
                : `${line.metal_type} ${line.purity_karat}K`;

              return [
                String(index + 1),
                descriptionCell,
                invoiceData.hsn_code || "7113",
                formatMg(line.gross_weight_mg),
                formatMg(line.stone_weight_mg ?? 0),
                formatMg(line.net_weight_mg),
                formatPaise(line.metal_rate_paise_per_gram),
                formatPaise(line.making_charge_paise),
                formatPaise(line.line_total_paise)
              ];
            })
          ]
        },
        layout: {
          hLineColor: () => "#cbd5e1",
          vLineColor: () => "#cbd5e1",
          paddingTop: () => 4,
          paddingBottom: () => 4
        }
      },
      ...(invoiceData.urdPurchases.length > 0 ? [
        { text: l.oldGoldExchange, style: "sectionLabel", margin: [0, 12, 0, 4] },
        {
          table: {
            headerRows: 1,
            widths: [22, "*", 54, 54, 58, 68],
            body: [
              [l.serialNo, l.itemDescription, l.weight, l.ratePerG, l.deduction, l.tunch].map((text) => ({
                text,
                style: "tableHeader"
              })),
              ...invoiceData.urdPurchases.map((urd, index) => [
                String(index + 1),
                `${urd.description} (${urd.metal_type} ${urd.purity_tunch} tunch)`,
                formatMg(urd.weight_mg),
                formatPaise(urd.applied_rate_paise_per_gram),
                formatPaise(urd.deduction_amount_paise),
                String(urd.purity_tunch)
              ])
            ]
          },
          layout: {
            hLineColor: () => "#cbd5e1",
            vLineColor: () => "#cbd5e1",
            paddingTop: () => 3,
            paddingBottom: () => 3
          },
          margin: [0, 0, 0, 8]
        }
      ] : []),
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: l.paymentDetails, style: "sectionLabel", margin: [0, 14, 0, 4] },
              paymentLine(l.cash, invoiceData.payments.cash_paise),
              paymentLine(l.upi, invoiceData.payments.upi_paise),
              paymentLine(l.card, invoiceData.payments.card_paise),
              paymentLine(l.udhari, invoiceData.payments.udhari_paise),
              paymentLine(l.gssCredit, invoiceData.payments.gss_credit_paise)
            ]
          },
          {
            width: 220,
            margin: [0, 14, 0, 0],
            table: {
              widths: ["*", 80],
              body: [
                summaryRow(l.grossTotal, grossTotalPaise),
                summaryRow(`${l.urd} ${l.deduction}`, -urdDeductionPaise),
                summaryRow(l.discount, -(invoiceData.discount_paise ?? 0)),
                summaryRow(l.gstAmount, gstAmountPaise),
                summaryRow(l.netPayable, invoiceData.total_amount_paise, true)
              ]
            },
            layout: "lightHorizontalLines"
          }
        ]
      },
      {
        text: l.certified,
        margin: [0, 24, 0, 0],
        fontSize: 8,
        color: "#475569"
      },
      {
        columns: [
          { text: l.customerSignature, decoration: "overline", margin: [0, 28, 0, 0] },
          { text: l.authorizedSignatory, alignment: "right", decoration: "overline", margin: [0, 28, 0, 0] }
        ]
      }
    ]
  });
}

export async function generateA5Invoice(invoiceData: InvoiceDocumentData, organizationData: OrganizationData) {
  const grossTotalPaise = invoiceData.lines.reduce((total, line) => total + line.line_total_paise, 0);
  const gstAmountPaise = invoiceData.gst_amount_paise ?? 0;
  const urdDeductionPaise = invoiceData.urd_deduction_paise ?? invoiceData.urdPurchases.reduce((total, line) => total + line.deduction_amount_paise, 0);

  const l = getL10n(organizationData.print_language);
  const font = fontForLanguage(organizationData.print_language);

  return createPdfBuffer({
    pageSize: "A5",
    pageOrientation: "landscape",
    pageMargins: [20, 20, 20, 24],
    defaultStyle: { font, fontSize: 7.5 },
    styles: {
      title: { fontSize: 11, bold: true, alignment: "center" },
      shopName: { fontSize: 10, bold: true },
      sectionLabel: { fontSize: 8, bold: true, color: "#334155" },
      tableHeader: { bold: true, fillColor: "#e2e8f0", color: "#0f172a" }
    },
    content: [
      { text: l.taxInvoice, style: "title", margin: [0, 0, 0, 4] },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: organizationData.shop_name, style: "shopName" },
              { text: organizationData.address },
              { text: `GSTIN: ${organizationData.gstin || "-"}` },
              { text: `Contact: ${organizationData.contact_number}` }
            ]
          },
          {
            width: 160,
            table: {
              widths: [60, "*"],
              body: [
                metaRow(l.invoiceNo, invoiceData.invoice_number),
                metaRow(l.date, formatDate(invoiceData.created_at)),
                metaRow(l.customer, invoiceData.customer?.name ?? invoiceData.walk_in_name ?? "Walk-in Customer")
              ]
            },
            layout: "lightHorizontalLines"
          }
        ],
        margin: [0, 0, 0, 8]
      },
      {
        table: {
          headerRows: 1,
          widths: [15, "*", 30, 35, 35, 35, 45, 45, 48],
          body: [
            [l.serialNo, l.itemDescription, l.hsn, l.grossWt, l.stoneWt, l.netWt, l.rate, l.making, l.total].map((text) => ({
              text,
              style: "tableHeader"
            })),
            ...invoiceData.lines.map((line, index) => {
              const descriptionCell = line.certificate_numbers && line.certificate_numbers.length > 0
                ? {
                    stack: [
                      { text: `${line.metal_type} ${line.purity_karat}K` },
                      {
                        text: `Cert: ${line.certificate_numbers.join(", ")}`,
                        fontSize: 6,
                        color: "#475569",
                        margin: [0, 1, 0, 0]
                      }
                    ]
                  }
                : `${line.metal_type} ${line.purity_karat}K`;

              return [
                String(index + 1),
                descriptionCell,
                invoiceData.hsn_code || "7113",
                formatMg(line.gross_weight_mg),
                formatMg(line.stone_weight_mg ?? 0),
                formatMg(line.net_weight_mg),
                formatPaise(line.metal_rate_paise_per_gram),
                formatPaise(line.making_charge_paise),
                formatPaise(line.line_total_paise)
              ];
            })
          ]
        },
        layout: {
          hLineColor: () => "#cbd5e1",
          vLineColor: () => "#cbd5e1",
          paddingTop: () => 2,
          paddingBottom: () => 2
        }
      },
      ...(invoiceData.urdPurchases.length > 0 ? [
        { text: l.oldGoldExchange, style: "sectionLabel", margin: [0, 6, 0, 2] },
        {
          table: {
            headerRows: 1,
            widths: [15, "*", 35, 35, 45, 48],
            body: [
              [l.serialNo, l.itemDescription, l.weight, l.ratePerG, l.deduction, l.tunch].map((text) => ({
                text,
                style: "tableHeader"
              })),
              ...invoiceData.urdPurchases.map((urd, index) => [
                String(index + 1),
                `${urd.description} (${urd.metal_type} ${urd.purity_tunch} tunch)`,
                formatMg(urd.weight_mg),
                formatPaise(urd.applied_rate_paise_per_gram),
                formatPaise(urd.deduction_amount_paise),
                String(urd.purity_tunch)
              ])
            ]
          },
          layout: {
            hLineColor: () => "#cbd5e1",
            vLineColor: () => "#cbd5e1",
            paddingTop: () => 1.5,
            paddingBottom: () => 1.5
          },
          margin: [0, 0, 0, 4]
        }
      ] : []),
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: l.paymentDetails, style: "sectionLabel", margin: [0, 8, 0, 2] },
              paymentLine(l.cash, invoiceData.payments.cash_paise),
              paymentLine(l.upi, invoiceData.payments.upi_paise),
              paymentLine(l.card, invoiceData.payments.card_paise),
              paymentLine(l.udhari, invoiceData.payments.udhari_paise)
            ]
          },
          {
            width: 180,
            margin: [0, 8, 0, 0],
            table: {
              widths: ["*", 60],
              body: [
                summaryRow(l.grossTotal, grossTotalPaise),
                summaryRow(`${l.urd} ${l.deduction}`, -urdDeductionPaise),
                summaryRow(l.discount, -(invoiceData.discount_paise ?? 0)),
                summaryRow(l.gstAmount, gstAmountPaise),
                summaryRow(l.netPayable, invoiceData.total_amount_paise, true)
              ]
            },
            layout: "lightHorizontalLines"
          }
        ]
      },
      {
        text: l.certified,
        margin: [0, 10, 0, 0],
        fontSize: 6.5,
        color: "#475569"
      },
      {
        columns: [
          { text: l.customerSignature, decoration: "overline", margin: [0, 18, 0, 0], fontSize: 7 },
          { text: l.authorizedSignatory, alignment: "right", decoration: "overline", margin: [0, 18, 0, 0], fontSize: 7 }
        ]
      }
    ]
  });
}

export async function generateThermalReceipt(invoiceData: InvoiceDocumentData, organizationData: OrganizationData) {
  const grossTotalPaise = invoiceData.lines.reduce((total, line) => total + line.line_total_paise, 0);
  const urdDeductionPaise = invoiceData.urd_deduction_paise ?? invoiceData.urdPurchases.reduce((total, line) => total + line.deduction_amount_paise, 0);
  const l = getL10n(organizationData.print_language);
  const font = fontForLanguage(organizationData.print_language);

  return createPdfBuffer({
    pageSize: { width: 226.77, height: "auto" },
    pageMargins: [10, 12, 10, 14],
    defaultStyle: { font, fontSize: 8 },
    content: [
      { text: organizationData.shop_name, alignment: "center", bold: true, fontSize: 10 },
      { text: organizationData.address, alignment: "center", fontSize: 7 },
      { text: `GSTIN: ${organizationData.gstin || "-"}`, alignment: "center", fontSize: 7 },
      { text: `Ph: ${organizationData.contact_number}`, alignment: "center", fontSize: 7 },
      dashedLine(),
      { text: `${l.invoiceNo}: ${invoiceData.invoice_number}` },
      { text: `${l.date}: ${formatDate(invoiceData.created_at)}` },
      { text: `${l.customer}: ${invoiceData.customer?.name ?? invoiceData.walk_in_name ?? "Walk-in"}` },
      { text: `${l.phone}: ${invoiceData.customer?.phone ?? "-"}` },
      dashedLine(),
      ...invoiceData.lines.flatMap((line, index) => [
        { text: `${index + 1}. ${line.metal_type} ${line.purity_karat}K HSN:${invoiceData.hsn_code || "7113"}`, bold: true },
        { text: `${l.gWt} ${formatMg(line.gross_weight_mg)}  ${l.sWt} ${formatMg(line.stone_weight_mg ?? 0)}  ${l.nWt} ${formatMg(line.net_weight_mg)}` },
        { text: `${l.rate} ${formatPaise(line.metal_rate_paise_per_gram)}  ${l.mc} ${formatPaise(line.making_charge_paise)}` },
        { text: `${l.total} ${formatPaise(line.line_total_paise)}`, alignment: "right", margin: [0, 0, 0, 3] }
      ]),
      dashedLine(),
      ...(invoiceData.urdPurchases.length > 0 ? [
        { text: l.oldGoldExchanged, bold: true },
        ...invoiceData.urdPurchases.map((urd, index) => ({
          text: `${index + 1}. ${urd.description} (${urd.metal_type} ${urd.purity_tunch} tunch)\n   ${formatMg(urd.weight_mg)} @ ${formatPaise(urd.applied_rate_paise_per_gram)} = ${formatPaise(urd.deduction_amount_paise)}`,
          fontSize: 7.5,
          margin: [0, 0, 0, 3]
        })),
        dashedLine()
      ] : []),
      receiptAmountLine(l.gross, grossTotalPaise),
      receiptAmountLine(l.urd, -urdDeductionPaise),
      receiptAmountLine(l.gst, invoiceData.gst_amount_paise ?? 0),
      receiptAmountLine(l.netPayable, invoiceData.total_amount_paise, true),
      dashedLine(),
      { text: l.payments, bold: true },
      receiptAmountLine(l.cash, invoiceData.payments.cash_paise),
      receiptAmountLine(l.upi, invoiceData.payments.upi_paise),
      receiptAmountLine(l.card, invoiceData.payments.card_paise),
      receiptAmountLine(l.udhari, invoiceData.payments.udhari_paise),
      dashedLine(),
      { text: l.thankYou, alignment: "center", bold: true }
    ]
  });
}

function templatePdfPageSize(pageSize: PrintTemplateData["page_size"]) {
  if (pageSize === "THERMAL_80") return { width: 226.77, height: "auto" };
  if (pageSize === "LABEL_50X25") return { width: 141.73, height: 70.87 };
  if (pageSize === "LABEL_65X35") return { width: 184.25, height: 99.21 };
  return pageSize;
}

function templateText(value: string, tokenMap: Record<string, string>) {
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, token: string) => tokenMap[token] ?? "-");
}

function templateShopTokenMap(organizationData: OrganizationData) {
  return {
    "shop.name": organizationData.shop_name,
    "shop.address": organizationData.address,
    "shop.gstin": organizationData.gstin || "-",
    "shop.phone": organizationData.contact_number
  };
}

function templateHeader(organizationData: OrganizationData, template: PrintTemplateData) {
  if (!template.content.showHeader) return [];
  const tokenMap = templateShopTokenMap(organizationData);
  const lines = template.content.headerLines.length ? template.content.headerLines : ["{{shop.name}}", "{{shop.address}}"];

  return lines.map((line, index) => ({
    text: templateText(line, tokenMap),
    style: index === 0 ? "shop" : undefined,
    alignment: "center",
    margin: [0, 0, 0, index === lines.length - 1 ? 8 : 1]
  }));
}

function templateInvoiceTokenMap(invoiceData: InvoiceDocumentData, organizationData: OrganizationData, grossTotalPaise: number) {
  return {
    ...templateShopTokenMap(organizationData),
    "invoice.number": invoiceData.invoice_number,
    "invoice.date": formatDate(invoiceData.created_at),
    "invoice.hsn": invoiceData.hsn_code || "7113",
    "invoice.gst": formatPaise(invoiceData.gst_amount_paise ?? 0),
    "invoice.discount": formatPaise(invoiceData.discount_paise ?? 0),
    "invoice.urd": formatPaise(invoiceData.urd_deduction_paise ?? 0),
    "invoice.gross": formatPaise(grossTotalPaise),
    "invoice.total": formatPaise(invoiceData.total_amount_paise),
    "customer.name": invoiceData.customer?.name ?? invoiceData.walk_in_name ?? "Walk-in Customer",
    "customer.phone": invoiceData.customer?.phone ?? "-",
    "payment.cash": formatPaise(invoiceData.payments.cash_paise),
    "payment.upi": formatPaise(invoiceData.payments.upi_paise),
    "payment.card": formatPaise(invoiceData.payments.card_paise),
    "payment.udhari": formatPaise(invoiceData.payments.udhari_paise)
  };
}

function templateTokenLabel(token: string) {
  return token.split(".").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function templateTokenLines(fields: string[], tokenMap: Record<string, string>) {
  const selectedFields = fields.length ? fields : ["invoice.number", "invoice.date", "customer.name", "customer.phone"];

  return selectedFields.map((field) => ({
    text: `${templateTokenLabel(field)}: ${tokenMap[field] ?? "-"}`,
    margin: [0, 1, 0, 1]
  }));
}

function templateInvoiceRow(line: InvoiceLineDocumentData, index: number, columns: string[]) {
  const values: Record<string, string> = {
    item: `${index + 1}. ${line.metal_type}`,
    purity: `${line.purity_karat}K`,
    grossWeight: formatMg(line.gross_weight_mg),
    netWeight: formatMg(line.net_weight_mg),
    rate: formatPaise(line.metal_rate_paise_per_gram),
    making: formatPaise(line.making_charge_paise),
    gst: formatPaise(line.gst_paise ?? 0),
    amount: formatPaise(line.line_total_paise)
  };

  return (columns.length ? columns : ["item"]).map((column) => ({ text: values[column] ?? "-" }));
}

function templateColumnHeading(column: string, language?: string | null) {
  const l = getL10n(language);
  const headings: Record<string, string> = {
    item: l.item,
    purity: l.purity,
    grossWeight: l.grossWt,
    netWeight: l.netWt,
    rate: l.ratePerG,
    making: l.making,
    gst: l.gst,
    amount: l.amount
  };

  return headings[column] ?? column;
}

function templateLabelTokenMap(item: LabelItemDocumentData, organizationData: OrganizationData): Record<string, string> {
  return {
    ...templateShopTokenMap(organizationData),
    "item.barcode": item.barcode,
    "item.huid": item.huid ?? "-",
    "item.category": item.category,
    "item.metal": item.metal_type,
    "item.purity": `${item.purity_karat}K`,
    "item.grossWeight": formatMg(item.gross_weight_mg),
    "item.netWeight": formatMg(item.net_weight_mg),
    "item.fineWeight": formatMg(item.fine_weight_mg),
    "item.location": item.location ?? "-"
  };
}

function templateBarcodeCanvas(value: string, height: number) {
  const bits = Array.from(value).flatMap((char) => char.charCodeAt(0).toString(2).padStart(8, "0").split(""));
  const modules = bits.length ? bits : ["1", "0", "1", "0"];
  const barWidth = 1.5;

  return modules
    .map((bit, index) => bit === "1"
      ? { type: "rect", x: index * barWidth, y: 0, w: barWidth, h: height, color: "#0f172a" }
      : null)
    .filter(Boolean);
}

export async function generateTemplateInvoice(invoiceData: InvoiceDocumentData, organizationData: OrganizationData, template: PrintTemplateData) {
  const isThermal = template.page_size === "THERMAL_80";
  const isA5 = template.page_size === "A5";
  const content = template.content;
  const accentColor = content.accentColor ?? "#e2e8f0";
  const headerTextColor = content.headerTextColor ?? "#0f172a";
  const baseFontSize = content.fontSizeBase === "small" ? 8 : content.fontSizeBase === "large" ? 10 : 9;
  const grossTotalPaise = invoiceData.lines.reduce((total, line) => total + line.line_total_paise, 0);
  const rows = invoiceData.lines.map((line, index) => templateInvoiceRow(line, index, content.columns));
  const widths = content.columns.map((column) => column === "item" ? "*" : "auto");
  const l = getL10n(organizationData.print_language);
  const font = fontForLanguage(organizationData.print_language);

  return createPdfBuffer({
    pageSize: templatePdfPageSize(template.page_size),
    pageOrientation: isA5 ? "landscape" : "portrait",
    pageMargins: isThermal ? [8, 10, 8, 10] : [28, 30, 28, 34],
    defaultStyle: { font, fontSize: isThermal ? 7 : baseFontSize },
    styles: {
      shop: { fontSize: isThermal ? 11 : baseFontSize + 6, bold: true, alignment: "center" },
      title: { fontSize: isThermal ? 9 : baseFontSize + 3, bold: true, alignment: "center" },
      header: { bold: true, fillColor: accentColor, color: headerTextColor }
    },
    content: [
      ...templateHeader(organizationData, template),
      { text: template.document_type === "RECEIPT" ? l.receipt : l.taxInvoice, style: "title", margin: [0, 0, 0, 8] },
      {
        columns: [
          { width: "*", stack: templateTokenLines(content.fields, templateInvoiceTokenMap(invoiceData, organizationData, grossTotalPaise)) },
          { width: isThermal ? 0 : 180, text: isThermal ? "" : `Template: ${template.name}`, alignment: "right", color: "#64748b" }
        ],
        columnGap: 12,
        margin: [0, 0, 0, 8]
      },
      {
        table: {
          headerRows: 1,
          widths: widths.length ? widths : ["*"],
          body: [
            content.columns.length ? content.columns.map((column) => ({ text: templateColumnHeading(column, organizationData.print_language), style: "header" })) : [{ text: l.item, style: "header" }],
            ...(rows.length ? rows : [[{ text: "No items", colSpan: Math.max(content.columns.length, 1) }]])
          ]
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 8]
      },
      {
        table: {
          widths: ["*", "auto"],
          body: [
            summaryRow(l.gross, grossTotalPaise),
            summaryRow(l.discount, -(invoiceData.discount_paise ?? 0)),
            summaryRow(`${l.urd} ${l.deduction}`, -(invoiceData.urd_deduction_paise ?? 0)),
            summaryRow(l.gst, invoiceData.gst_amount_paise ?? 0),
            summaryRow(l.netPayable, invoiceData.total_amount_paise, true)
          ]
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 8]
      },
      ...(content.showFooter && content.footerText ? [{ text: templateText(content.footerText, templateInvoiceTokenMap(invoiceData, organizationData, grossTotalPaise)), alignment: "center", margin: [0, 8, 0, 0] }] : [])
    ]
  });
}

export async function generateBarcodeLabel(item: LabelItemDocumentData, organizationData: OrganizationData, template: PrintTemplateData) {
  const tokenMap: Record<string, string> = templateLabelTokenMap(item, organizationData);
  const fields = template.content.fields.length ? template.content.fields : ["item.barcode", "item.category", "item.purity", "item.netWeight"];

  return createPdfBuffer({
    pageSize: templatePdfPageSize(template.page_size),
    pageMargins: [6, 5, 6, 5],
    defaultStyle: { font: "Roboto", fontSize: template.page_size === "LABEL_50X25" ? 6 : 8 },
    content: [
      ...(template.content.showHeader ? template.content.headerLines.map((line) => ({ text: templateText(line, tokenMap), bold: true, alignment: "center", margin: [0, 0, 0, 1] })) : []),
      { canvas: templateBarcodeCanvas(item.barcode, template.page_size === "LABEL_50X25" ? 34 : 46), alignment: "center", margin: [0, 1, 0, 2] },
      { text: item.barcode, alignment: "center", bold: true, fontSize: 8, margin: [0, 0, 0, 1] },
      ...fields.filter((field) => field !== "item.barcode").map((field) => ({ text: tokenMap[field] ?? field, alignment: "center", noWrap: true })),
      ...(template.content.showFooter && template.content.footerText ? [{ text: templateText(template.content.footerText, tokenMap), alignment: "center", margin: [0, 2, 0, 0] }] : [])
    ]
  });
}

async function createPdfBuffer(documentDefinition: unknown) {
  return Buffer.from(await pdfMake.createPdf(documentDefinition).getBuffer());
}

export type CustomerStatementEntry = {
  created_at: string | null;
  transaction_type: "DEBIT" | "CREDIT";
  amount_paise: number;
  amount_rupees: string;
  running_balance_paise: number;
  running_balance_rupees: string;
  particulars: string;
  description: string | null;
  reference_type: string;
  reference_id: number | null;
};

export type CustomerStatementData = {
  customer_name: string;
  customer_phone: string | null;
  ledger_name: string;
  from_date: string;
  to_date: string;
  opening_balance_paise: number;
  opening_balance_rupees: string;
  closing_balance_paise: number;
  closing_balance_rupees: string;
  total_debits_paise: number;
  total_debits_rupees: string;
  total_credits_paise: number;
  total_credits_rupees: string;
  entries: CustomerStatementEntry[];
};

export async function generateCustomerStatement(data: CustomerStatementData, org: OrganizationData) {
  const balanceColor = (paise: number) => (paise >= 0 ? "#dc2626" : "#16a34a");

  const entryRows = data.entries.map((entry) => [
    { text: entry.created_at ? entry.created_at.slice(0, 10) : "-", fontSize: 8 },
    { text: entry.particulars, fontSize: 8 },
    { text: entry.description ?? "-", fontSize: 7.5, color: "#64748b" },
    { text: entry.transaction_type === "DEBIT" ? `Rs ${entry.amount_rupees}` : "-", alignment: "right", fontSize: 8, color: "#16a34a" },
    { text: entry.transaction_type === "CREDIT" ? `Rs ${entry.amount_rupees}` : "-", alignment: "right", fontSize: 8, color: "#dc2626" },
    { text: `Rs ${entry.running_balance_rupees}`, alignment: "right", fontSize: 8, bold: true, color: balanceColor(entry.running_balance_paise) }
  ]);

  return createPdfBuffer({
    pageSize: "A4",
    pageMargins: [28, 32, 28, 36],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    styles: {
      shopName: { fontSize: 14, bold: true },
      title: { fontSize: 13, bold: true, alignment: "center" },
      tableHeader: { bold: true, fillColor: "#e2e8f0", color: "#0f172a", fontSize: 8 },
      meta: { fontSize: 8.5 }
    },
    content: [
      // Shop header
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: org.shop_name, style: "shopName" },
              { text: org.address, style: "meta", margin: [0, 2, 0, 0] },
              { text: `GSTIN: ${org.gstin ?? "-"} | Phone: ${org.contact_number}`, style: "meta" }
            ]
          },
          {
            width: 140,
            stack: [
              { text: "ACCOUNT STATEMENT", style: "title" },
              { text: `Period: ${data.from_date}  to  ${data.to_date}`, fontSize: 8, alignment: "center", color: "#475569", margin: [0, 3, 0, 0] }
            ]
          }
        ],
        margin: [0, 0, 0, 10]
      },
      // Customer info bar
      {
        table: {
          widths: [80, "*", 80, "*"],
          body: [
            [
              { text: "Customer", bold: true, fillColor: "#f8fafc" },
              { text: data.customer_name },
              { text: "Phone", bold: true, fillColor: "#f8fafc" },
              { text: data.customer_phone ?? "-" }
            ]
          ]
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 10]
      },
      // Summary strip
      {
        table: {
          widths: ["*", "*", "*", "*"],
          body: [
            [
              { text: "Opening Balance", alignment: "center", bold: true, fillColor: "#f1f5f9", fontSize: 8 },
              { text: "Total Sales (Dr)", alignment: "center", bold: true, fillColor: "#f0fdf4", fontSize: 8 },
              { text: "Total Payments (Cr)", alignment: "center", bold: true, fillColor: "#fef2f2", fontSize: 8 },
              { text: "Closing Balance", alignment: "center", bold: true, fillColor: "#f1f5f9", fontSize: 8 }
            ],
            [
              { text: `Rs ${data.opening_balance_rupees}`, alignment: "center", fontSize: 9 },
              { text: `Rs ${data.total_debits_rupees}`, alignment: "center", fontSize: 9, color: "#16a34a", bold: true },
              { text: `Rs ${data.total_credits_rupees}`, alignment: "center", fontSize: 9, color: "#dc2626", bold: true },
              { text: `Rs ${data.closing_balance_rupees}`, alignment: "center", fontSize: 9, bold: true, color: balanceColor(data.closing_balance_paise) }
            ]
          ]
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 10]
      },
      // Entries table
      {
        table: {
          headerRows: 1,
          widths: [55, 90, "*", 58, 58, 68],
          body: [
            [
              { text: "Date", style: "tableHeader" },
              { text: "Particulars", style: "tableHeader" },
              { text: "Narration", style: "tableHeader" },
              { text: "Dr (Sales)", style: "tableHeader", alignment: "right" },
              { text: "Cr (Payment)", style: "tableHeader", alignment: "right" },
              { text: "Balance", style: "tableHeader", alignment: "right" }
            ],
            [
              { text: "—", fontSize: 8, color: "#94a3b8" },
              { text: "Opening Balance", bold: true, fontSize: 8 },
              { text: "", fontSize: 8 },
              { text: "-", alignment: "right", fontSize: 8 },
              { text: "-", alignment: "right", fontSize: 8 },
              { text: `Rs ${data.opening_balance_rupees}`, alignment: "right", bold: true, fontSize: 8 }
            ],
            ...entryRows,
            [
              { text: "", fontSize: 8 },
              { text: "Closing Balance", bold: true, fontSize: 8 },
              { text: "", fontSize: 8 },
              { text: `Rs ${data.total_debits_rupees}`, alignment: "right", bold: true, fontSize: 8, color: "#16a34a" },
              { text: `Rs ${data.total_credits_rupees}`, alignment: "right", bold: true, fontSize: 8, color: "#dc2626" },
              { text: `Rs ${data.closing_balance_rupees}`, alignment: "right", bold: true, fontSize: 8, color: balanceColor(data.closing_balance_paise) }
            ]
          ]
        },
        layout: "lightHorizontalLines"
      },
      // Footer note
      {
        text: `This is a computer-generated statement. For queries contact ${org.shop_name} at ${org.contact_number}.`,
        fontSize: 7.5,
        color: "#94a3b8",
        alignment: "center",
        margin: [0, 14, 0, 0]
      }
    ]
  });
}

function metaRow(label: string, value: string) {
  return [
    { text: label, bold: true, fillColor: "#f8fafc" },
    { text: value }
  ];
}

function summaryRow(label: string, amountPaise: number, bold = false) {
  return [
    { text: label, bold },
    { text: formatPaise(amountPaise), alignment: "right", bold }
  ];
}

function valueRow(label: string, value: string, bold = false) {
  return [
    { text: label, bold },
    { text: value, alignment: "right", bold }
  ];
}

function paymentLine(label: string, amountPaise: number) {
  return {
    columns: [
      { text: label, width: 70 },
      { text: formatPaise(amountPaise), width: 80, alignment: "right" }
    ],
    margin: [0, 1, 0, 1]
  };
}

function receiptAmountLine(label: string, amountPaise: number, bold = false) {
  return {
    columns: [
      { text: label, bold },
      { text: formatPaise(amountPaise), alignment: "right", bold }
    ]
  };
}

function dashedLine() {
  return { text: "--------------------------------", alignment: "center", margin: [0, 4, 0, 4] };
}

function getPdfPageSize(pageSize: PrintTemplateData["page_size"]) {
  if (pageSize === "THERMAL_80") return { width: 226.77, height: "auto" };
  if (pageSize === "LABEL_50X25") return { width: 141.73, height: 70.87 };
  if (pageSize === "LABEL_65X35") return { width: 184.25, height: 99.21 };
  return pageSize;
}

function buildTemplateHeader(organizationData: OrganizationData, template: PrintTemplateData) {
  if (!template.content.showHeader) return [];
  const tokenMap = buildShopTokenMap(organizationData);
  const lines = template.content.headerLines.length ? template.content.headerLines : ["{{shop.name}}", "{{shop.address}}"];

  return lines.map((line, index) => ({
    text: renderTemplateText(line, tokenMap),
    style: index === 0 ? "shop" : undefined,
    alignment: "center",
    margin: [0, 0, 0, index === lines.length - 1 ? 8 : 1]
  }));
}

function buildTokenLines(fields: string[], tokenMap: Record<string, string>) {
  const selectedFields = fields.length ? fields : ["invoice.number", "invoice.date", "customer.name", "customer.phone"];

  return selectedFields.map((field) => ({
    text: `${getTokenLabel(field)}: ${tokenMap[field] ?? "-"}`,
    margin: [0, 1, 0, 1]
  }));
}

function buildInvoiceTokenMap(invoiceData: InvoiceDocumentData, organizationData: OrganizationData, grossTotalPaise: number) {
  return {
    ...buildShopTokenMap(organizationData),
    "invoice.number": invoiceData.invoice_number,
    "invoice.date": formatDate(invoiceData.created_at),
    "invoice.hsn": invoiceData.hsn_code || "7113",
    "invoice.gst": formatPaise(invoiceData.gst_amount_paise ?? 0),
    "invoice.discount": formatPaise(invoiceData.discount_paise ?? 0),
    "invoice.urd": formatPaise(invoiceData.urd_deduction_paise ?? 0),
    "invoice.gross": formatPaise(grossTotalPaise),
    "invoice.total": formatPaise(invoiceData.total_amount_paise),
    "customer.name": invoiceData.customer?.name ?? invoiceData.walk_in_name ?? "Walk-in Customer",
    "customer.phone": invoiceData.customer?.phone ?? "-",
    "payment.cash": formatPaise(invoiceData.payments.cash_paise),
    "payment.upi": formatPaise(invoiceData.payments.upi_paise),
    "payment.card": formatPaise(invoiceData.payments.card_paise),
    "payment.udhari": formatPaise(invoiceData.payments.udhari_paise)
  };
}

function buildLabelTokenMap(item: LabelItemDocumentData, organizationData: OrganizationData) {
  return {
    ...buildShopTokenMap(organizationData),
    "item.barcode": item.barcode,
    "item.huid": item.huid ?? "-",
    "item.category": item.category,
    "item.metal": item.metal_type,
    "item.purity": `${item.purity_karat}K`,
    "item.grossWeight": formatMg(item.gross_weight_mg),
    "item.netWeight": formatMg(item.net_weight_mg),
    "item.fineWeight": formatMg(item.fine_weight_mg),
    "item.location": item.location ?? "-"
  };
}

function buildShopTokenMap(organizationData: OrganizationData) {
  return {
    "shop.name": organizationData.shop_name,
    "shop.address": organizationData.address,
    "shop.gstin": organizationData.gstin || "-",
    "shop.phone": organizationData.contact_number
  };
}

function renderTemplateText(value: string, tokenMap: Record<string, string>) {
  return value.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, token: string) => tokenMap[token] ?? "-");
}

function buildTemplateInvoiceRow(line: InvoiceLineDocumentData, index: number, columns: string[]) {
  const values: Record<string, string> = {
    item: `${index + 1}. ${line.metal_type}`,
    purity: `${line.purity_karat}K`,
    grossWeight: formatMg(line.gross_weight_mg),
    netWeight: formatMg(line.net_weight_mg),
    rate: formatPaise(line.metal_rate_paise_per_gram),
    making: formatPaise(line.making_charge_paise),
    gst: formatPaise(line.gst_paise ?? 0),
    amount: formatPaise(line.line_total_paise)
  };

  return (columns.length ? columns : ["item"]).map((column) => ({ text: values[column] ?? "-" }));
}

function getColumnHeading(column: string) {
  const headings: Record<string, string> = {
    item: "Item",
    purity: "Purity",
    grossWeight: "Gross Wt",
    netWeight: "Net Wt",
    rate: "Rate/g",
    making: "Making",
    gst: "GST",
    amount: "Amount"
  };

  return headings[column] ?? column;
}

function getTokenLabel(token: string) {
  return token.split(".").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function barcodeCanvas(value: string, height: number) {
  const bits = Array.from(value).flatMap((char) => char.charCodeAt(0).toString(2).padStart(8, "0").split(""));
  const modules = bits.length ? bits : ["1", "0", "1", "0"];
  const barWidth = 1.5;

  return modules
    .map((bit, index) => bit === "1"
      ? { type: "rect", x: index * barWidth, y: 0, w: barWidth, h: height, color: "#0f172a" }
      : null)
    .filter(Boolean);
}

function formatDate(value: string | null) {
  return value ? value.slice(0, 19) : "-";
}

function formatMg(value: number) {
  return `${(value / 1000).toFixed(3)}g`;
}

function formatPaise(value: number) {
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const rupees = Math.trunc(absolute / 100);
  const paise = String(absolute % 100).padStart(2, "0");

  return `${sign}Rs ${rupees}.${paise}`;
}

export type GirviCollateralData = {
  item_description: string;
  metal_type: string;
  purity_karat: number;
  gross_weight_mg?: number;
  stone_deduction_mg?: number;
  weight_mg: number;
  valuation_rate_paise_per_gram?: number;
  image_path: string | null;
};

export type GirviLoanDocumentData = {
  id: number;
  loan_number: string;
  principal_amount_paise: number;
  interest_rate_percentage: number;
  interest_type: "SIMPLE" | "COMPOUND";
  rate_period: "MONTHLY" | "ANNUALLY";
  interest_period_type: string;
  loan_letter_fee_paise: number;
  notice_fee_paise: number;
  customer_photo_path: string | null;
  thumbprint_path: string | null;
  issue_date: string;
  next_due_date: string | null;
  status: string;
  customer: {
    name: string;
    phone: string;
    address: string | null;
    pan_number: string | null;
    aadhaar_number: string | null;
  };
  collateral: GirviCollateralData[];
};

export type GirviRepaymentDocumentData = {
  id: number;
  loan_id: number;
  loan_number: string;
  payment_date: string;
  amount_paise: number;
  interest_allocated_paise: number;
  principal_allocated_paise: number;
  discount_paise: number;
  notice_fee_paid_paise: number;
  loan_letter_fee_paid_paise: number;
  customer: {
    name: string;
    phone: string;
  };
  outstanding_principal_paise: number;
  outstanding_fees_paise: number;
};

function getImageBase64(imagePath: string | null): string | null {
  if (!imagePath) return null;
  try {
    const filename = path.basename(imagePath);
    const filePath = path.join(process.cwd(), ".data", "images", filename);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filename).toLowerCase();
      const mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
      return `data:${mimeType};base64,${data.toString("base64")}`;
    }
  } catch (error) {
    console.error("[PDF] Failed to read image:", imagePath, error);
  }
  return null;
}

const LOCALIZED_LABELS: Record<string, Record<string, string>> = {
  en: {
    pawnTicket: "PAWN TICKET / गहाण पावती",
    borrowerDetails: "Borrower Details / ग्राहक तपशील",
    name: "Name",
    phone: "Phone",
    address: "Address",
    pan: "PAN",
    aadhaar: "Aadhaar",
    photo: "Photo",
    thumbprint: "Thumbprint",
    loanTerms: "Loan Terms / कर्जाच्या अटी",
    principal: "Principal Amount / मुद्दल",
    interestRate: "Interest Rate / व्याजाचा दर",
    interestPeriod: "Interest Period / व्याज कालावधी",
    interestType: "Interest Type / व्याजाचा प्रकार",
    letterFee: "Loan Letter Fee / पत्र फी",
    noticeFee: "Notice Fee / नोटीस फी",
    nextDue: "Next Due Date / पुढील देय तारीख",
    collateralTitle: "Collateral Ornaments / गहाण दागिने",
    sno: "S.No",
    desc: "Description / वर्णन",
    metal: "Metal / धातू",
    purity: "Purity / शुद्धता",
    weight: "Weight / वजन",
    grossWeight: "Gross Wt / एकूण वजन",
    netWeight: "Net Wt / निव्वळ वजन",
    photoHeader: "Photo / फोटो",
    authSign: "Authorized Signatory / सावकाराची सही",
    borrowerSign: "Borrower's Signature / कर्जदाराची सही"
  },
  mr: {
    pawnTicket: "गहाण पावती (Pawn Ticket)",
    borrowerDetails: "कर्जदार ग्राहक तपशील",
    name: "नाव (Name)",
    phone: "फोन (Phone)",
    address: "पत्ता (Address)",
    pan: "पॅन नंबर (PAN)",
    aadhaar: "आधार नंबर (Aadhaar)",
    photo: "फोटो",
    thumbprint: "अंगठ्याचा ठसा",
    loanTerms: "कर्जाच्या अटी",
    principal: "मुद्दल रक्कम (Principal)",
    interestRate: "व्याजाचा दर (Interest Rate)",
    interestPeriod: "व्याज कालावधी",
    interestType: "व्याजाचा प्रकार",
    letterFee: "पत्र फी",
    noticeFee: "नोटीस फी",
    nextDue: "पुढील देय तारीख",
    collateralTitle: "गहाण दागिने (Collateral)",
    sno: "अ.क्र.",
    desc: "दागिन्यांचे वर्णन",
    metal: "धातू (Metal)",
    purity: "शुद्धता (Purity)",
    weight: "वजन (Weight)",
    grossWeight: "एकूण वजन (Gross)",
    netWeight: "निव्वळ वजन (Net)",
    photoHeader: "फोटो",
    authSign: "सावकाराची सही (Auth Sign)",
    borrowerSign: "कर्जदाराची सही (Borrower Sign)"
  },
  hi: {
    pawnTicket: "गिरवी रसीद (Pawn Ticket)",
    borrowerDetails: "ऋणदाता / ग्राहक विवरण",
    name: "नाम (Name)",
    phone: "फोन (Phone)",
    address: "पता (Address)",
    pan: "पैन नंबर (PAN)",
    aadhaar: "आधार नंबर (Aadhaar)",
    photo: "फोटो",
    thumbprint: "अंगूठे का निशान",
    loanTerms: "ऋण की शर्तें",
    principal: "मूलधन राशि (Principal)",
    interestRate: "ब्याज दर (Interest Rate)",
    interestPeriod: "ब्याज अवधि",
    interestType: "ब्याज का प्रकार",
    letterFee: "पत्र शुल्क",
    noticeFee: "नोटिस शुल्क",
    nextDue: "अगली देय तिथि",
    collateralTitle: "गिरवी रखे आभूषण",
    sno: "क्र.सं.",
    desc: "आभूषण विवरण",
    metal: "धातु (Metal)",
    purity: "शुद्धता (Purity)",
    weight: "वजन (Weight)",
    grossWeight: "कुल वजन (Gross)",
    netWeight: "शुद्ध वजन (Net)",
    photoHeader: "फोटो",
    authSign: "साहूकार के हस्ताक्षर",
    borrowerSign: "ऋणदाता के हस्ताक्षर"
  }
};

export async function generateGirviPavati(loanData: GirviLoanDocumentData, organizationData: OrganizationData, lang = "en") {
  const customerPhotoBase64 = getImageBase64(loanData.customer_photo_path);
  const thumbprintBase64 = getImageBase64(loanData.thumbprint_path);
  
  const labels = LOCALIZED_LABELS[lang] ?? LOCALIZED_LABELS.en;

  const customerPhotoCell = customerPhotoBase64
    ? { image: customerPhotoBase64, fit: [70, 70], alignment: "center" }
    : {
        table: {
          widths: [70],
          heights: [70],
          body: [[{ text: "NO PHOTO\nAVAILABLE", alignment: "center", margin: [0, 20, 0, 0], color: "#94a3b8", fontSize: 8 }]]
        },
        layout: {
          hLineColor: () => "#cbd5e1",
          vLineColor: () => "#cbd5e1"
        }
      };

  const thumbprintCell = thumbprintBase64
    ? { image: thumbprintBase64, fit: [70, 70], alignment: "center" }
    : {
        table: {
          widths: [70],
          heights: [70],
          body: [[{ text: "NO THUMB\nPRINT", alignment: "center", margin: [0, 20, 0, 0], color: "#94a3b8", fontSize: 8 }]]
        },
        layout: {
          hLineColor: () => "#cbd5e1",
          vLineColor: () => "#cbd5e1"
        }
      };

  return createPdfBuffer({
    pageSize: "A4",
    pageMargins: [36, 40, 36, 40],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    styles: {
      title: { fontSize: 16, bold: true, alignment: "center" },
      shopName: { fontSize: 14, bold: true },
      sectionLabel: { fontSize: 10, bold: true, color: "#1e293b" },
      tableHeader: { bold: true, fillColor: "#f1f5f9", color: "#0f172a" },
      boldText: { bold: true }
    },
    content: [
      { text: labels.pawnTicket, style: "title", margin: [0, 0, 0, 10] },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: organizationData.shop_name, style: "shopName" },
              { text: organizationData.address },
              { text: `GSTIN: ${organizationData.gstin || "-"}` },
              { text: `Contact: ${organizationData.contact_number}` }
            ]
          },
          {
            width: 180,
            table: {
              widths: [80, "*"],
              body: [
                metaRow("Pawn Ticket No", loanData.loan_number),
                metaRow("Issue Date", formatDate(loanData.issue_date)),
                metaRow("Status", loanData.status)
              ]
            },
            layout: "lightHorizontalLines"
          }
        ],
        margin: [0, 0, 0, 15]
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1, strokeColor: "#cbd5e1" }], margin: [0, 0, 0, 15] },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: labels.borrowerDetails, style: "sectionLabel", margin: [0, 0, 0, 6] },
              { text: `${labels.name}: ${loanData.customer.name}`, bold: true },
              { text: `${labels.phone}: ${loanData.customer.phone || "-"}` },
              { text: `${labels.address}: ${loanData.customer.address || "-"}` },
              { text: `${labels.pan}: ${loanData.customer.pan_number || "-"}` },
              { text: `${labels.aadhaar}: ${loanData.customer.aadhaar_number || "-"}` }
            ]
          },
          {
            width: 180,
            columns: [
              { width: "*", stack: [{ text: labels.photo, alignment: "center", fontSize: 8, margin: [0, 0, 0, 4] }, customerPhotoCell] },
              { width: "*", stack: [{ text: labels.thumbprint, alignment: "center", fontSize: 8, margin: [0, 0, 0, 4] }, thumbprintCell] }
            ]
          }
        ],
        margin: [0, 0, 0, 15]
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1, strokeColor: "#cbd5e1" }], margin: [0, 0, 0, 15] },
      { text: labels.loanTerms, style: "sectionLabel", margin: [0, 0, 0, 6] },
      {
        table: {
          widths: ["*", "*", "*", "*"],
          body: [
            [
              { text: labels.principal, style: "boldText" },
              { text: formatPaise(loanData.principal_amount_paise), fontSize: 12, bold: true },
              { text: labels.interestRate, style: "boldText" },
              { text: `${loanData.interest_rate_percentage}% per ${loanData.rate_period === "MONTHLY" ? "Month" : "Year"}` }
            ],
            [
              { text: labels.interestPeriod, style: "boldText" },
              { text: loanData.interest_period_type },
              { text: labels.interestType, style: "boldText" },
              { text: loanData.interest_type }
            ],
            [
              { text: labels.letterFee, style: "boldText" },
              { text: formatPaise(loanData.loan_letter_fee_paise) },
              { text: labels.noticeFee, style: "boldText" },
              { text: formatPaise(loanData.notice_fee_paise) }
            ],
            [
              { text: labels.nextDue, style: "boldText" },
              { text: formatDate(loanData.next_due_date), colSpan: 3 },
              {},
              {}
            ]
          ]
        },
        layout: {
          hLineColor: () => "#e2e8f0",
          vLineColor: () => "#e2e8f0",
          paddingTop: () => 6,
          paddingBottom: () => 6
        },
        margin: [0, 0, 0, 15]
      },
      { text: labels.collateralTitle, style: "sectionLabel", margin: [0, 0, 0, 6] },
      {
        table: {
          headerRows: 1,
          widths: [25, "*", 45, 45, 60, 60, 70],
          body: [
            [labels.sno, labels.desc, labels.metal, labels.purity, labels.grossWeight, labels.netWeight, labels.photoHeader].map((t) => ({
              text: t,
              style: "tableHeader"
            })),
            ...loanData.collateral.map((item, index) => {
              const itemBase64 = getImageBase64(item.image_path);
              const colCell = itemBase64
                ? { image: itemBase64, fit: [50, 50], alignment: "center" }
                : { text: "No Image", alignment: "center", fontSize: 8, color: "#94a3b8" };

              // Gross falls back to net for legacy records issued before gross/stone capture.
              const grossMg = item.gross_weight_mg && item.gross_weight_mg > 0 ? item.gross_weight_mg : item.weight_mg;

              return [
                String(index + 1),
                item.item_description,
                item.metal_type,
                `${item.purity_karat}K`,
                formatMg(grossMg),
                formatMg(item.weight_mg),
                colCell
              ];
            })
          ]
        },
        layout: {
          hLineColor: () => "#cbd5e1",
          vLineColor: () => "#cbd5e1",
          paddingTop: () => 4,
          paddingBottom: () => 4
        },
        margin: [0, 0, 0, 15]
      },
      {
        stack: [
          { text: "Terms & Conditions / नियम आणि अटी", bold: true, fontSize: 10, margin: [0, 0, 0, 4] },
          {
            text: "1. English: The borrower agrees to redeem the pledged article(s) by paying the principal and accrued interest within the agreed tenure. If the loan is not settled, the pawnbroker reserves the right to default and auction the collateral as per regulations.\n" +
                  "2. Marathi: कर्जदाराने ठरलेल्या मुदतीत मुद्दल आणि जमा झालेले व्याज देऊन गहाण ठेवलेले दागिने सोडवून घेणे बंधनकारक आहे. कर्ज न फेडल्यास, नियमांनुसार दागिन्यांचा लिलाव करण्याचा अधिकार सावकाराला राहील.\n" +
                  "3. Hindi: कर्जदार सहमत है कि वह तय समय सीमा के भीतर मूलधन और अर्जित ब्याज का भुगतान करके गिरवी रखी वस्तुओं को छुड़ा लेगा। यदि ऋण का निपटान नहीं किया जाता है, तो कानूनन गिरवी रखी वस्तुओं की नीलामी का अधिकार होगा।",
            fontSize: 7.5,
            color: "#475569"
          }
        ],
        margin: [0, 0, 0, 25]
      },
      {
        columns: [
          { text: labels.authSign, alignment: "left", decoration: "overline", margin: [0, 30, 0, 0] },
          { text: labels.borrowerSign, alignment: "right", decoration: "overline", margin: [0, 30, 0, 0] }
        ]
      }
    ]
  });
}

export type GirviReleaseDocumentData = GirviLoanDocumentData & {
  repayments: {
    total_repaid_paise: number;
    total_interest_allocated_paise: number;
    total_principal_allocated_paise: number;
    total_discount_allowed_paise: number;
    total_notice_fee_paid_paise: number;
    total_letter_fee_paid_paise: number;
  };
};

export async function generateGirviReleaseReceipt(releaseData: GirviReleaseDocumentData, organizationData: OrganizationData) {
  return createPdfBuffer({
    pageSize: "A4",
    pageMargins: [36, 40, 36, 40],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    styles: {
      title: { fontSize: 16, bold: true, alignment: "center" },
      shopName: { fontSize: 14, bold: true },
      sectionLabel: { fontSize: 10, bold: true, color: "#1e293b" },
      tableHeader: { bold: true, fillColor: "#f1f5f9", color: "#0f172a" },
      boldText: { bold: true }
    },
    content: [
      { text: "PLEDGE RELEASE RECEIPT / गहाण मुक्ती पावती", style: "title", margin: [0, 0, 0, 10] },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: organizationData.shop_name, style: "shopName" },
              { text: organizationData.address },
              { text: `GSTIN: ${organizationData.gstin || "-"}` },
              { text: `Contact: ${organizationData.contact_number}` }
            ]
          },
          {
            width: 180,
            table: {
              widths: [85, "*"],
              body: [
                metaRow("Pawn Ticket No", releaseData.loan_number),
                metaRow("Issue Date", formatDate(releaseData.issue_date)),
                metaRow("Release Date", new Date().toISOString().slice(0, 10)),
                metaRow("Status", "SETTLED / RELEASED")
              ]
            },
            layout: "lightHorizontalLines"
          }
        ],
        margin: [0, 0, 0, 15]
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1, strokeColor: "#cbd5e1" }], margin: [0, 0, 0, 15] },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "Borrower Details", style: "sectionLabel", margin: [0, 0, 0, 6] },
              { text: `Name: ${releaseData.customer.name}`, bold: true },
              { text: `Phone: ${releaseData.customer.phone || "-"}` },
              { text: `Address: ${releaseData.customer.address || "-"}` }
            ]
          }
        ],
        margin: [0, 0, 0, 15]
      },
      { text: "Repayment Settlement Summary", style: "sectionLabel", margin: [0, 0, 0, 6] },
      {
        table: {
          widths: ["*", "*", "*", "*"],
          body: [
            [
              { text: "Original Principal / मूळ मुद्दल", style: "boldText" },
              { text: formatPaise(releaseData.principal_amount_paise) },
              { text: "Total Amount Repaid / एकूण भरलेली रक्कम", style: "boldText" },
              { text: formatPaise(releaseData.repayments.total_repaid_paise), bold: true }
            ],
            [
              { text: "Principal Settled / जमा मुद्दल", style: "boldText" },
              { text: formatPaise(releaseData.repayments.total_principal_allocated_paise) },
              { text: "Interest Settled / जमा व्याज", style: "boldText" },
              { text: formatPaise(releaseData.repayments.total_interest_allocated_paise) }
            ],
            [
              { text: "Notice Fee Paid / नोटीस फी", style: "boldText" },
              { text: formatPaise(releaseData.repayments.total_notice_fee_paid_paise) },
              { text: "Letter Fee Paid / पत्र फी", style: "boldText" },
              { text: formatPaise(releaseData.repayments.total_letter_fee_paid_paise) }
            ],
            [
              { text: "Discount Allowed / सूट", style: "boldText" },
              { text: formatPaise(releaseData.repayments.total_discount_allowed_paise), colSpan: 3 },
              {},
              {}
            ]
          ]
        },
        layout: {
          hLineColor: () => "#e2e8f0",
          vLineColor: () => "#e2e8f0",
          paddingTop: () => 6,
          paddingBottom: () => 6
        },
        margin: [0, 0, 0, 15]
      },
      { text: "Released Collateral Items", style: "sectionLabel", margin: [0, 0, 0, 6] },
      {
        table: {
          headerRows: 1,
          widths: [30, "*", 80, 80, 100],
          body: [
            ["S.No", "Description / वर्णन", "Metal / धातू", "Purity / शुद्धता", "Weight / वजन"].map((t) => ({
              text: t,
              style: "tableHeader"
            })),
            ...releaseData.collateral.map((item, index) => [
              String(index + 1),
              item.item_description,
              item.metal_type,
              `${item.purity_karat}K`,
              formatMg(item.weight_mg)
            ])
          ]
        },
        layout: {
          hLineColor: () => "#cbd5e1",
          vLineColor: () => "#cbd5e1",
          paddingTop: () => 4,
          paddingBottom: () => 4
        },
        margin: [0, 0, 0, 15]
      },
      {
        stack: [
          { text: "Release Acknowledgment & Consent", bold: true, fontSize: 10, margin: [0, 0, 0, 4] },
          {
            text: "1. English: The borrower hereby acknowledges receipt of all collateral articles listed above in good and satisfactory condition and confirms that the loan account is fully settled with no further liability.\n" +
                  "2. Marathi: कर्जदार याद्वारे कबूल करतो की गहाण ठेवलेले सर्व दागिने चांगल्या आणि समाधानकारक स्थितीत परत मिळाले आहेत आणि कर्ज खाते पूर्णपणे बंद झाले असून सावकारावर कोणतीही कायदेशीर जबाबदारी नाही.\n" +
                  "3. Hindi: ऋणदाता स्वीकार करता है कि गिरवी रखी सभी वस्तुएं सुरक्षित और संतोषजनक स्थिति में वापस मिल गई हैं और ऋण खाता पूर्णतः चुकता कर दिया गया है।",
            fontSize: 7.5,
            color: "#475569"
          }
        ],
        margin: [0, 0, 0, 25]
      },
      {
        columns: [
          { text: "Authorized Signatory / सावकाराची सही", alignment: "left", decoration: "overline", margin: [0, 30, 0, 0] },
          { text: "Borrower's Signature / कर्जदाराची सही", alignment: "right", decoration: "overline", margin: [0, 30, 0, 0] }
        ]
      }
    ]
  });
}

export type GirviNoticeDocumentData = GirviLoanDocumentData & {
  outstanding_principal_paise: number;
  accrued_interest_paise: number;
  total_due_paise: number;
  notice_date: string;
};

export async function generateGirviLegalNotice(noticeData: GirviNoticeDocumentData, organizationData: OrganizationData, lang = "en") {
  const isMr = lang === "mr";
  const isHi = lang === "hi";

  const title = isMr 
    ? "गहाण थकबाकी अंतिम चेतावणी नोटीस" 
    : isHi 
      ? "गिरवी ऋण भुगतान अंतिम चेतावनी नोटिस" 
      : "OVERDUE PAYMENTS - FINAL WARNING NOTICE";

  const noticeDateLabel = isMr ? "नोटीस तारीख" : isHi ? "नोटिस तिथि" : "Notice Date";
  const loanNumLabel = isMr ? "गहाण क्रमांक" : isHi ? "गिरवी संख्या" : "Pawn Ticket No";
  const issueDateLabel = isMr ? "तारीख" : isHi ? "ऋण तिथि" : "Issue Date";

  const letterBody = isMr
    ? `प्रिय ${noticeData.customer.name},\n\n` +
      `आपण आमच्याकडे कर्ज क्रमांक ${noticeData.loan_number} अन्वये तारीख ${formatDate(noticeData.issue_date)} रोजी मुद्दल रक्कम ${formatPaise(noticeData.principal_amount_paise)} देऊन सोन्याचे/चांदीचे दागिने गहाण ठेवले होते.\n\n` +
      `सध्याच्या हिशोबानुसार, आपले खालील कर्ज अत्यंत थकबाकीत आहे:\n` +
      `• थकीत मुद्दल: ${formatPaise(noticeData.outstanding_principal_paise)}\n` +
      `• आजवरचे थकीत व्याज: ${formatPaise(noticeData.accrued_interest_paise)}\n` +
      `• नोटीस व इतर फी: ${formatPaise(noticeData.notice_fee_paise + noticeData.loan_letter_fee_paise)}\n` +
      `• एकूण देणे: ${formatPaise(noticeData.total_due_paise)}\n\n` +
      `आपणास याद्वारे कळविण्यात येते की, ही नोटीस मिळाल्यापासून १५ (पंधरा) दिवसांच्या आत वरील संपूर्ण थकबाकी भरून आपले दागिने सोडवून घ्यावेत. मुदतीत पैसे न भरल्यास, सावकारी कायद्यानुसार आम्हाला आपल्या गहाण दागिन्यांचा जाहीर लिलाव करून थकबाकी वसूल करण्याचा पूर्ण अधिकार राहील, याची नोंद घ्यावी.`
    : isHi
      ? `प्रिय ${noticeData.customer.name},\n\n` +
        `आपने हमारे यहाँ ऋण संख्या ${noticeData.loan_number} के तहत दिनांक ${formatDate(noticeData.issue_date)} को मूलधन राशि ${formatPaise(noticeData.principal_amount_paise)} का सोने/चांदी के आभूषण गिरवी रखकर ऋण लिया था।\n\n` +
        `वर्तमान विवरण के अनुसार, आपका ऋण अतिदेय (Overdue) हो चुका है:\n` +
        `• बकाया मूलधन: ${formatPaise(noticeData.outstanding_principal_paise)}\n` +
        `• बकाया ब्याज: ${formatPaise(noticeData.accrued_interest_paise)}\n` +
        `• नोटिस व अन्य शुल्क: ${formatPaise(noticeData.notice_fee_paise + noticeData.loan_letter_fee_paise)}\n` +
        `• कुल देय राशि: ${formatPaise(noticeData.total_due_paise)}\n\n` +
        `आपको सूचित किया जाता है कि इस नोटिस के प्राप्त होने के १५ (पंद्रह) दिनों के भीतर बकाया राशि चुकाकर अपने आभूषण छुड़ा लें। अन्यथा, नियमानुसार गिरवी रखे आभूषणों की सार्वजनिक नीलामी की जाएगी, जिसकी जिम्मेदारी आपकी होगी।`
      : `Dear ${noticeData.customer.name},\n\n` +
        `This is a formal legal notice regarding your pledge account number ${noticeData.loan_number} issued on ${formatDate(noticeData.issue_date)} against gold/silver collateral.\n\n` +
        `As of today, your loan account has remained unpaid and overdue. The details of the outstanding balance are:\n` +
        `• Outstanding Principal: ${formatPaise(noticeData.outstanding_principal_paise)}\n` +
        `• Accrued Overdue Interest: ${formatPaise(noticeData.accrued_interest_paise)}\n` +
        `• Notice and Administration Fees: ${formatPaise(noticeData.notice_fee_paise + noticeData.loan_letter_fee_paise)}\n` +
        `• Total Outstanding Balance: ${formatPaise(noticeData.total_due_paise)}\n\n` +
        `Please be advised that you are required to clear the entire outstanding balance within 15 days from the date of this notice to redeem your collateral. Failure to settle this account will result in the public auction of your pledged articles as per government regulations.`;

  return createPdfBuffer({
    pageSize: "A4",
    pageMargins: [36, 40, 36, 40],
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.3 },
    content: [
      { text: title, fontSize: 15, bold: true, alignment: "center", color: "#b91c1c", margin: [0, 0, 0, 15] },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: organizationData.shop_name, fontSize: 13, bold: true },
              { text: organizationData.address },
              { text: `Contact: ${organizationData.contact_number}` }
            ]
          },
          {
            width: 180,
            table: {
              widths: [80, "*"],
              body: [
                metaRow(noticeDateLabel, formatDate(noticeData.notice_date)),
                metaRow(loanNumLabel, noticeData.loan_number),
                metaRow(issueDateLabel, formatDate(noticeData.issue_date))
              ]
            },
            layout: "lightHorizontalLines"
          }
        ],
        margin: [0, 0, 0, 20]
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 523, y2: 0, lineWidth: 1, strokeColor: "#cbd5e1" }], margin: [0, 0, 0, 15] },
      { text: letterBody, whiteSpace: "pre-line", margin: [0, 10, 0, 20] },
      { text: isMr ? "गहाण ठेवलेल्या दागिन्यांची यादी:" : isHi ? "गिरवी रखे आभूषणों की सूची:" : "Pledged Collateral Inventory:", bold: true, margin: [0, 10, 0, 6] },
      {
        table: {
          widths: [30, "*", 100],
          body: [
            [isMr ? "अ.क्र." : isHi ? "क्र." : "S.No", isMr ? "वर्णन" : isHi ? "विवरण" : "Description", isMr ? "वजन" : isHi ? "वजन" : "Weight"].map((t) => ({
              text: t,
              style: "tableHeader",
              bold: true,
              fillColor: "#f1f5f9"
            })),
            ...noticeData.collateral.map((item, index) => [
              String(index + 1),
              item.item_description,
              formatMg(item.weight_mg)
            ])
          ]
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 30]
      },
      {
        columns: [
          { text: isMr ? "सावकाराची स्वाक्षरी" : isHi ? "साहूक़ार के हस्ताक्षर" : "Authorized Signatory", alignment: "right", decoration: "overline", margin: [0, 30, 0, 0] }
        ]
      }
    ]
  });
}

export async function generateGirviReceipt(repaymentData: GirviRepaymentDocumentData, organizationData: OrganizationData) {
  return createPdfBuffer({
    pageSize: "A5",
    pageOrientation: "landscape",
    pageMargins: [20, 20, 20, 24],
    defaultStyle: { font: "Roboto", fontSize: 8.5 },
    styles: {
      title: { fontSize: 13, bold: true, alignment: "center" },
      shopName: { fontSize: 11, bold: true },
      sectionLabel: { fontSize: 9, bold: true, color: "#1e293b" },
      tableHeader: { bold: true, fillColor: "#f1f5f9", color: "#0f172a" },
      boldText: { bold: true }
    },
    content: [
      { text: "GIRVI REPAYMENT RECEIPT / गहाण परतफेड पावती", style: "title", margin: [0, 0, 0, 6] },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: organizationData.shop_name, style: "shopName" },
              { text: organizationData.address },
              { text: `Contact: ${organizationData.contact_number}` }
            ]
          },
          {
            width: 180,
            table: {
              widths: [80, "*"],
              body: [
                metaRow("Receipt No", repaymentData.id ? `REPAY-${repaymentData.id}` : "-"),
                metaRow("Payment Date", formatDate(repaymentData.payment_date)),
                metaRow("Loan Number", repaymentData.loan_number)
              ]
            },
            layout: "lightHorizontalLines"
          }
        ],
        margin: [0, 0, 0, 10]
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 380, y2: 0, lineWidth: 1, strokeColor: "#cbd5e1" }], margin: [0, 0, 0, 10] },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "Customer / ग्राहक तपशील", style: "sectionLabel", margin: [0, 0, 0, 4] },
              { text: `Name: ${repaymentData.customer.name}`, bold: true },
              { text: `Phone: ${repaymentData.customer.phone || "-"}` },
              { text: "Thank you for your payment.", margin: [0, 10, 0, 0], color: "#475569", italics: true }
            ]
          },
          {
            width: 200,
            table: {
              widths: ["*", 80],
              body: [
                summaryRow("Total Amount Paid / एकूण भरलेली रक्कम", repaymentData.amount_paise, true),
                summaryRow("Principal Allocation / मुद्दल जमा", repaymentData.principal_allocated_paise),
                summaryRow("Interest Allocation / व्याज जमा", repaymentData.interest_allocated_paise),
                summaryRow("Discount Allowed / सूट", repaymentData.discount_paise),
                summaryRow("Notice Fee Paid / नोटीस फी जमा", repaymentData.notice_fee_paid_paise),
                summaryRow("Letter Fee Paid / पत्र फी जमा", repaymentData.loan_letter_fee_paid_paise),
                summaryRow("Remaining Principal / शिल्लक मुद्दल", repaymentData.outstanding_principal_paise, true),
                summaryRow("Remaining Fees / शिल्लक नोटीस/पत्र फी", repaymentData.outstanding_fees_paise)
              ]
            },
            layout: "lightHorizontalLines"
          }
        ]
      },
      {
        margin: [0, 15, 0, 0],
        columns: [
          { text: "Authorized Signatory / सही", alignment: "left" },
          { text: "Customer Signature / ग्राहकाची सही", alignment: "right" }
        ]
      }
    ]
  });
}

export type UrdVoucherDocumentData = {
  id: number;
  voucher_number: string;
  customer_name: string;
  customer_phone: string | null;
  voucher_date: string;
  description: string;
  metal_type: string;
  purity_tunch: string;
  gross_weight_mg: number;
  stone_weight_mg: number;
  black_bead_weight_mg: number;
  net_weight_mg: number;
  fine_weight_mg: number;
  applied_rate_paise_per_gram: number;
  total_value_paise: number;
  payment_mode: string;
  payment_reference: string | null;
  pan_number: string | null;
  aadhaar_number: string | null;
  created_at: string | null;
};

export type GssReceiptDocumentData = {
  id: number;
  card_number: string;
  installment_number: number;
  payment_date: string;
  amount_paid_paise: number;
  payment_mode: string;
  customer_name: string;
  customer_phone: string;
  scheme_name: string;
  scheme_code: string;
  duration_months: number;
  monthly_amount_paise: number;
  enrollment_date: string;
  maturity_date: string;
  total_paid_paise: number;
  installments_paid_count: number;
  status: string;
};

export type VoucherDocumentData = {
  id: number;
  voucher_number: string;
  voucher_type: string;
  reference_type: string;
  reference_id: number | null;
  narration: string | null;
  total_debit_paise: number;
  total_credit_paise: number;
  status: string;
  created_at: string | null;
  lines: Array<{
    account_name: string;
    account_type: string;
    transaction_type: string;
    amount_paise: number;
    description: string | null;
  }>;
};

export type KarigarSlipDocumentData = {
  job: {
    id: number;
    order_number: string;
    target_purity: number;
    target_weight_mg: number;
    status: string;
    created_at: string | null;
  };
  karigar: {
    name: string;
    phone: string;
    specialty: string;
  };
  issues: Array<{
    id: number;
    issue_date: string;
    metal_type: string;
    purity_tunch: number;
    gross_weight_mg: number;
    fine_gold_mg: number;
  }>;
  receipts: Array<{
    id: number;
    receive_date: string;
    final_gross_weight_mg: number;
    final_net_weight_mg: number;
    scrap_returned_mg: number;
    scrap_purity_tunch: number;
    acceptable_loss_mg: number;
    actual_loss_mg: number;
    excess_loss_mg: number;
    labor_charge_paise: number;
    is_anomaly: boolean;
  }>;
};

export type RefineryChallanDocumentData = {
  id: number;
  transfer_date: string;
  metal_type: string;
  gross_weight_mg: number;
  purity_tunch: number;
  fine_gold_mg: number;
  description: string | null;
  created_at: string | null;
  refinery: {
    name: string;
    phone: string | null;
  };
};

export type StockVerificationReportDocumentData = {
  session: {
    id: number;
    name: string;
    location: string | null;
    expected_status: string;
    status: string;
    created_at: string | null;
    completed_at: string | null;
  };
  counts: {
    expected: number;
    found: number;
    missing: number;
    unknown: number;
    scanned: number;
  };
  found_items: StockVerificationItemDocumentData[];
  missing_items: StockVerificationItemDocumentData[];
  unknown_scans: Array<{ barcode: string; scanned_at: string | null }>;
};

export type StockVerificationItemDocumentData = {
  barcode: string;
  huid: string | null;
  category: string;
  metal_type: string;
  purity_karat: number;
  gross_weight_mg: number;
  net_weight_mg: number;
  location: string | null;
};

export async function generateUrdVoucher(voucherData: UrdVoucherDocumentData, organizationData: OrganizationData) {
  return createPdfBuffer({
    pageSize: "A4",
    pageMargins: [32, 34, 32, 40],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    styles: documentStyles(),
    content: [
      ...documentHeader("URD PURCHASE VOUCHER", organizationData, [
        metaRow("Voucher No", voucherData.voucher_number),
        metaRow("Date", formatDate(voucherData.voucher_date)),
        metaRow("Payment", voucherData.payment_mode)
      ]),
      sectionTitle("Seller Details"),
      twoColumnFacts([
        ["Name", voucherData.customer_name],
        ["Phone", voucherData.customer_phone || "-"],
        ["PAN", voucherData.pan_number || "-"],
        ["Aadhaar", maskAadhaar(voucherData.aadhaar_number)]
      ]),
      sectionTitle("Old Gold Details"),
      {
        table: {
          widths: ["*", 60, 60, 60, 60, 60, 70, 70],
          body: [
            tableHeader(["Description", "Metal", "Purity", "Gross", "Less", "Net", "Fine", "Value"]),
            [
              voucherData.description,
              voucherData.metal_type,
              `${voucherData.purity_tunch}%`,
              formatMg(voucherData.gross_weight_mg),
              formatMg(voucherData.stone_weight_mg + voucherData.black_bead_weight_mg),
              formatMg(voucherData.net_weight_mg),
              formatMg(voucherData.fine_weight_mg),
              formatPaise(voucherData.total_value_paise)
            ]
          ]
        },
        layout: tableLayout(),
        margin: [0, 0, 0, 12]
      },
      twoColumnFacts([
        ["Applied Rate", `${formatPaise(voucherData.applied_rate_paise_per_gram)} / g`],
        ["Payment Reference", voucherData.payment_reference || "-"]
      ]),
      legalDeclaration("Seller confirms ownership of the submitted old gold and accepts the above purity, weight, valuation, and payment details."),
      signatureBlock("Seller Signature", "Authorized Signatory")
    ]
  });
}

export async function generateGssReceipt(receiptData: GssReceiptDocumentData, organizationData: OrganizationData) {
  const remainingInstallments = Math.max(0, receiptData.duration_months - receiptData.installments_paid_count);

  return createPdfBuffer({
    pageSize: "A5",
    pageOrientation: "landscape",
    pageMargins: [20, 20, 20, 24],
    defaultStyle: { font: "Roboto", fontSize: 8.5 },
    styles: documentStyles(),
    content: [
      ...documentHeader("GOLD SAVING SCHEME RECEIPT", organizationData, [
        metaRow("Receipt No", `GSS-${receiptData.id}`),
        metaRow("Date", formatDate(receiptData.payment_date)),
        metaRow("Card No", receiptData.card_number)
      ]),
      {
        columns: [
          {
            width: "*",
            stack: [
              sectionTitle("Member"),
              { text: receiptData.customer_name, bold: true },
              { text: `Phone: ${receiptData.customer_phone || "-"}` },
              { text: `Scheme: ${receiptData.scheme_name} (${receiptData.scheme_code})` },
              { text: `Enrollment: ${formatDate(receiptData.enrollment_date)}  Maturity: ${formatDate(receiptData.maturity_date)}` }
            ]
          },
          {
            width: 210,
            table: {
              widths: ["*", 75],
              body: [
                valueRow("Installment No", String(receiptData.installment_number)),
                summaryRow("Amount Paid", receiptData.amount_paid_paise, true),
                valueRow("Payment Mode", receiptData.payment_mode),
                summaryRow("Total Paid", receiptData.total_paid_paise, true),
                valueRow("Remaining Inst.", String(remainingInstallments)),
                valueRow("Status", receiptData.status)
              ]
            },
            layout: "lightHorizontalLines"
          }
        ]
      },
      legalDeclaration("This receipt acknowledges the installment collected under the selected gold saving scheme. Redemption is subject to scheme terms and account status."),
      signatureBlock("Member Signature", "Cashier")
    ]
  });
}

export async function generateVoucherDocument(voucherData: VoucherDocumentData, organizationData: OrganizationData) {
  return createPdfBuffer({
    pageSize: "A4",
    pageMargins: [32, 34, 32, 40],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    styles: documentStyles(),
    content: [
      ...documentHeader("ACCOUNTING VOUCHER", organizationData, [
        metaRow("Voucher No", voucherData.voucher_number),
        metaRow("Type", voucherData.voucher_type),
        metaRow("Date", formatDate(voucherData.created_at)),
        metaRow("Status", voucherData.status)
      ]),
      twoColumnFacts([
        ["Reference", `${voucherData.reference_type}${voucherData.reference_id ? ` #${voucherData.reference_id}` : ""}`],
        ["Narration", voucherData.narration || "-"]
      ]),
      sectionTitle("Voucher Lines"),
      {
        table: {
          headerRows: 1,
          widths: [28, "*", 80, 70, 70, "*"],
          body: [
            tableHeader(["S.No", "Ledger", "Account Type", "Debit", "Credit", "Description"]),
            ...voucherData.lines.map((line, index) => [
              String(index + 1),
              line.account_name,
              line.account_type,
              line.transaction_type === "DEBIT" ? formatPaise(line.amount_paise) : "-",
              line.transaction_type === "CREDIT" ? formatPaise(line.amount_paise) : "-",
              line.description || "-"
            ]),
            [
              { text: "Totals", colSpan: 3, bold: true, alignment: "right" },
              {},
              {},
              { text: formatPaise(voucherData.total_debit_paise), bold: true },
              { text: formatPaise(voucherData.total_credit_paise), bold: true },
              voucherData.total_debit_paise === voucherData.total_credit_paise ? "Balanced" : "Mismatch"
            ]
          ]
        },
        layout: tableLayout()
      },
      legalDeclaration("Voucher is computer generated from posted ledger entries and must remain balanced before accounting close."),
      signatureBlock("Prepared By", "Checked By")
    ]
  });
}

export async function generateKarigarSlip(slipData: KarigarSlipDocumentData, organizationData: OrganizationData) {
  const issuedFineMg = slipData.issues.reduce((sum, issue) => sum + issue.fine_gold_mg, 0);
  const receivedFineMg = slipData.receipts.reduce((sum, receipt) => sum + receipt.final_net_weight_mg, 0);
  const laborPaise = slipData.receipts.reduce((sum, receipt) => sum + receipt.labor_charge_paise, 0);

  return createPdfBuffer({
    pageSize: "A5",
    pageOrientation: "landscape",
    pageMargins: [20, 20, 20, 24],
    defaultStyle: { font: "Roboto", fontSize: 8 },
    styles: documentStyles(),
    content: [
      ...documentHeader("KARIGAR JOB SLIP", organizationData, [
        metaRow("Order No", slipData.job.order_number),
        metaRow("Status", slipData.job.status),
        metaRow("Date", formatDate(slipData.job.created_at))
      ]),
      twoColumnFacts([
        ["Karigar", `${slipData.karigar.name} (${slipData.karigar.specialty})`],
        ["Phone", slipData.karigar.phone || "-"],
        ["Target Purity", formatBasisPoints(slipData.job.target_purity)],
        ["Target Weight", formatMg(slipData.job.target_weight_mg)]
      ]),
      {
        columns: [
          {
            width: "*",
            stack: [
              sectionTitle("Material Issued"),
              compactTable(["Date", "Metal", "Purity", "Gross", "Fine"], slipData.issues.map((issue) => [
                formatDate(issue.issue_date),
                issue.metal_type,
                formatBasisPoints(issue.purity_tunch),
                formatMg(issue.gross_weight_mg),
                formatMg(issue.fine_gold_mg)
              ]))
            ]
          },
          {
            width: "*",
            stack: [
              sectionTitle("Job Receipt"),
              compactTable(["Date", "Gross", "Net", "Scrap", "Loss", "Labor"], slipData.receipts.map((receipt) => [
                formatDate(receipt.receive_date),
                formatMg(receipt.final_gross_weight_mg),
                formatMg(receipt.final_net_weight_mg),
                formatMg(receipt.scrap_returned_mg),
                formatMg(receipt.actual_loss_mg),
                formatPaise(receipt.labor_charge_paise)
              ]))
            ]
          }
        ],
        columnGap: 12
      },
      twoColumnFacts([
        ["Issued Fine", formatMg(issuedFineMg)],
        ["Received Net", formatMg(receivedFineMg)],
        ["Labor Payable", formatPaise(laborPaise)],
        ["Anomaly", slipData.receipts.some((receipt) => receipt.is_anomaly) ? "YES" : "NO"]
      ]),
      signatureBlock("Karigar Signature", "Issuer / Receiver")
    ]
  });
}

export async function generateRefineryChallan(challanData: RefineryChallanDocumentData, organizationData: OrganizationData) {
  return createPdfBuffer({
    pageSize: "A4",
    pageMargins: [32, 34, 32, 40],
    defaultStyle: { font: "Roboto", fontSize: 9 },
    styles: documentStyles(),
    content: [
      ...documentHeader("REFINERY TRANSFER CHALLAN", organizationData, [
        metaRow("Challan No", `REF-${challanData.id}`),
        metaRow("Date", formatDate(challanData.transfer_date)),
        metaRow("Refinery", challanData.refinery.name)
      ]),
      twoColumnFacts([
        ["Refinery Phone", challanData.refinery.phone || "-"],
        ["Description", challanData.description || "-"]
      ]),
      sectionTitle("Metal Sent For Refining"),
      {
        table: {
          widths: ["*", "*", "*", "*", "*"],
          body: [
            tableHeader(["Metal", "Gross Weight", "Purity", "Fine Weight", "Remarks"]),
            [
              challanData.metal_type,
              formatMg(challanData.gross_weight_mg),
              `${challanData.purity_tunch.toFixed(2)}%`,
              formatMg(challanData.fine_gold_mg),
              challanData.description || "-"
            ]
          ]
        },
        layout: tableLayout()
      },
      legalDeclaration("Goods are transferred to the named refinery for melting, assay, or refining. Receiver must verify weight and purity before processing."),
      signatureBlock("Issued By", "Received By")
    ]
  });
}

export async function generateStockVerificationReport(reportData: StockVerificationReportDocumentData, organizationData: OrganizationData) {
  return createPdfBuffer({
    pageSize: "A4",
    pageMargins: [28, 32, 28, 36],
    defaultStyle: { font: "Roboto", fontSize: 8 },
    styles: documentStyles(),
    content: [
      ...documentHeader("STOCK VERIFICATION REPORT", organizationData, [
        metaRow("Session", reportData.session.name),
        metaRow("Location", reportData.session.location || "All"),
        metaRow("Status", reportData.session.status),
        metaRow("Completed", formatDate(reportData.session.completed_at))
      ]),
      {
        table: {
          widths: ["*", "*", "*", "*", "*"],
          body: [
            tableHeader(["Expected", "Found", "Missing", "Unknown", "Scanned"]),
            [
              String(reportData.counts.expected),
              String(reportData.counts.found),
              String(reportData.counts.missing),
              String(reportData.counts.unknown),
              String(reportData.counts.scanned)
            ]
          ]
        },
        layout: tableLayout(),
        margin: [0, 0, 0, 12]
      },
      sectionTitle("Missing Items"),
      stockItemsTable(reportData.missing_items),
      sectionTitle("Unknown Scans"),
      compactTable(["Barcode", "Scanned At"], reportData.unknown_scans.map((scan) => [scan.barcode, formatDate(scan.scanned_at)])),
      legalDeclaration("Report records physical stock verification variance for audit follow-up, approval, and adjustment posting."),
      signatureBlock("Verified By", "Approved By")
    ]
  });
}

function documentStyles() {
  return {
    title: { fontSize: 14, bold: true, alignment: "center" },
    shopName: { fontSize: 13, bold: true },
    sectionLabel: { fontSize: 9, bold: true, color: "#1e293b" },
    tableHeader: { bold: true, fillColor: "#e2e8f0", color: "#0f172a" }
  };
}

function documentHeader(title: string, organizationData: OrganizationData, metaRows: unknown[]) {
  return [
    { text: title, style: "title", margin: [0, 0, 0, 8] },
    {
      columns: [
        {
          width: "*",
          stack: [
            { text: organizationData.shop_name, style: "shopName" },
            { text: organizationData.address },
            { text: `GSTIN: ${organizationData.gstin || "-"}` },
            { text: `Contact: ${organizationData.contact_number}` }
          ]
        },
        {
          width: 190,
          table: { widths: [75, "*"], body: metaRows },
          layout: "lightHorizontalLines"
        }
      ],
      margin: [0, 0, 0, 12]
    }
  ];
}

function sectionTitle(text: string) {
  return { text, style: "sectionLabel", margin: [0, 8, 0, 5] };
}

function tableHeader(labels: string[]) {
  return labels.map((text) => ({ text, style: "tableHeader" }));
}

function tableLayout() {
  return {
    hLineColor: () => "#cbd5e1",
    vLineColor: () => "#cbd5e1",
    paddingTop: () => 4,
    paddingBottom: () => 4
  };
}

function twoColumnFacts(rows: Array<[string, string]>) {
  return {
    table: {
      widths: [90, "*", 90, "*"],
      body: chunkPairs(rows).map((pair) => [
        { text: pair[0][0], bold: true, fillColor: "#f8fafc" },
        pair[0][1],
        { text: pair[1]?.[0] ?? "", bold: true, fillColor: pair[1] ? "#f8fafc" : undefined },
        pair[1]?.[1] ?? ""
      ])
    },
    layout: "lightHorizontalLines",
    margin: [0, 0, 0, 8]
  };
}

function chunkPairs(rows: Array<[string, string]>) {
  const chunks: Array<Array<[string, string]>> = [];
  for (let index = 0; index < rows.length; index += 2) {
    chunks.push(rows.slice(index, index + 2));
  }
  return chunks;
}

function compactTable(headers: string[], rows: string[][]) {
  return {
    table: {
      headerRows: 1,
      widths: headers.map(() => "*"),
      body: [
        tableHeader(headers),
        ...(rows.length > 0 ? rows : [[{ text: "No records", colSpan: headers.length, alignment: "center", color: "#64748b" }, ...headers.slice(1).map(() => "")]])
      ]
    },
    layout: tableLayout(),
    margin: [0, 0, 0, 8]
  };
}

function stockItemsTable(items: StockVerificationItemDocumentData[]) {
  return compactTable(
    ["Barcode", "HUID", "Category", "Metal", "Purity", "Gross", "Net", "Location"],
    items.map((item) => [
      item.barcode,
      item.huid || "-",
      item.category,
      item.metal_type,
      `${item.purity_karat}K`,
      formatMg(item.gross_weight_mg),
      formatMg(item.net_weight_mg),
      item.location || "-"
    ])
  );
}

function legalDeclaration(text: string) {
  return { text, margin: [0, 12, 0, 0], fontSize: 8, color: "#475569" };
}

function signatureBlock(left: string, right: string) {
  return {
    columns: [
      { text: left, decoration: "overline", margin: [0, 30, 0, 0] },
      { text: right, alignment: "right", decoration: "overline", margin: [0, 30, 0, 0] }
    ]
  };
}

function formatBasisPoints(value: number) {
  const whole = Math.trunc(value / 100);
  const decimal = String(value % 100).padStart(2, "0");

  return `${whole}.${decimal}%`;
}

function maskAadhaar(value: string | null) {
  if (!value) return "-";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "XXXX";
  return `XXXX-XXXX-${digits.slice(-4)}`;
}
