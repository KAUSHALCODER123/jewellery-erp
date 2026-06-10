import { sql, relations } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type UserRole = "ADMIN" | "MANAGER" | "ACCOUNTANT" | "COUNTER_STAFF";
export type LedgerAccountType = "CUSTOMER_UDHARI" | "VENDOR" | "CASH" | "BANK" | "TAX" | "GSS_LIABILITY" | "SALES" | "STOCK" | "EXPENSE" | "SALES_REVENUE" | "PURCHASE_EXPENSE";
export type JournalTransactionType = "CREDIT" | "DEBIT";
export type VoucherStatus = "POSTED" | "REVERSED";
export type GirviInterestType = "SIMPLE" | "COMPOUND";
export type GirviRatePeriod = "MONTHLY" | "ANNUALLY";
export type GirviLoanStatus = "ACTIVE" | "SETTLED" | "DEFAULTED";
export type GssBonusRuleType = "FIXED_AMOUNT" | "PERCENTAGE_OF_INSTALLMENT";
export type GssAccountStatus = "ACTIVE" | "MATURED" | "CONVERTED_TO_SALE" | "DEFAULTER" | "MERGED";
export type GssPaymentMode = "CASH" | "UPI" | "CARD";
export type KarigarSpecialty = "CASTING" | "HANDMADE" | "POLISH" | "SETTING";
export type JobOrderStatus = "PENDING" | "WIP" | "COMPLETED" | "CANCELLED";
export type RepairJobStatus = "RECEIVED" | "WIP" | "READY" | "DELIVERED";
export type KycDocumentType = "PAN" | "AADHAAR" | "PASSPORT" | "DRIVING_LICENSE";
export type PosDocumentStatus = "DRAFT" | "POSTED" | "CANCELLED" | "CONVERTED";
export type GstSupplyType = "INTRA_STATE" | "INTER_STATE" | "EXPORT" | "SEZ";
export type GstAuditLockStatus = "LOCKED" | "UNLOCKED";
export type HuidLifecycleStatus = "NOT_APPLIED" | "BIS_SUBMITTED" | "HUID_RECEIVED" | "CERT_PRINTED" | "SOLD" | "RETURNED" | "CANCELLED";
export type BisSubmissionStatus = "DRAFT" | "SUBMITTED" | "PARTIAL_RETURN" | "COMPLETED" | "CANCELLED";
export type PrintDocumentType = "INVOICE" | "RECEIPT" | "LABEL";
export type PrintPageSize = "A4" | "A5" | "THERMAL_80" | "LABEL_50X25" | "LABEL_65X35";
export type HardwareDeviceType = "THERMAL_BARCODE_PRINTER" | "BARCODE_SCANNER" | "RFID_UHF_READER" | "SMART_TRAY";
export type HardwareConnectionType = "USB_SERIAL" | "NETWORK" | "KEYBOARD_WEDGE" | "MANUAL";
export type ScannerEventType = "BARCODE_SCAN" | "RFID_SCAN" | "TRAY_SCAN" | "UNKNOWN_SCAN" | "PRINT_LABEL";
export type AntiTheftAlertStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
export type LoyaltyEarnMode = "PER_HUNDRED_RUPEES" | "PER_GRAM_GOLD";
export type LoyaltyLedgerType = "EARN" | "REDEEM";

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull().unique(),
  address: text("address"),
  pan_number: text("pan_number"),
  aadhaar_number: text("aadhaar_number"),
  kyc_photo_path: text("kyc_photo_path"),
  email: text("email"),
  whatsapp_phone: text("whatsapp_phone"),
  gstin: text("gstin"),
  area: text("area"),
  taluka: text("taluka"),
  district: text("district"),
  anniversary_date: text("anniversary_date"),
  birthday_date: text("birthday_date"),
  ring_size: text("ring_size"),
  spouse_name: text("spouse_name"),
  loyalty_enrolled: integer("loyalty_enrolled", { mode: "boolean" }).notNull().default(false),
  loyalty_points_balance: integer("loyalty_points_balance").default(0),
  opening_balance_paise: integer("opening_balance_paise").notNull().default(0),
  opening_balance_type: text("opening_balance_type", { enum: ["DEBIT", "CREDIT"] }).notNull().default("DEBIT"),
  // Maximum udhari (credit) the shop allows this customer; 0 = no limit set.
  credit_limit_paise: integer("credit_limit_paise").notNull().default(0),
  // Blacklisted customers cannot take girvi loans or buy on udhari (cash sales stay allowed).
  is_blacklisted: integer("is_blacklisted", { mode: "boolean" }).notNull().default(false),
  blacklist_reason: text("blacklist_reason"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

// Metal-wise opening balances (fine weight owed to/by the customer), separate from
// the monetary opening balance — jewellers routinely carry gold/silver weight accounts.
export const customerMetalBalances = sqliteTable("customer_metal_balances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customer_id: integer("customer_id").notNull().references(() => customers.id),
  metal_type: text("metal_type").notNull(),
  fine_weight_mg: integer("fine_weight_mg").notNull().default(0),
  direction: text("direction", { enum: ["TO_RECEIVE", "TO_PAY"] }).notNull().default("TO_RECEIVE"),
  notes: text("notes"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const items = sqliteTable("items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  barcode: text("barcode").unique().notNull(),
  huid: text("huid").unique(),
  category: text("category").notNull(),
  metal_type: text("metal_type").notNull(),
  purity_karat: integer("purity_karat").notNull(),
  gross_weight_mg: integer("gross_weight_mg").notNull(),
  stone_weight_mg: integer("stone_weight_mg").default(0),
  black_bead_weight_mg: integer("black_bead_weight_mg").notNull().default(0),
  net_weight_mg: integer("net_weight_mg").notNull(),
  final_weight_mg: integer("final_weight_mg").notNull().default(0),
  fine_weight_mg: integer("fine_weight_mg").notNull().default(0),
  wastage_percentage: real("wastage_percentage").default(0),
  making_charge_type: text("making_charge_type").notNull(),
  making_charge_value: integer("making_charge_value").notNull(),
  hallmark_charge_paise: integer("hallmark_charge_paise").notNull().default(0),
  huid_status: text("huid_status", {
    enum: ["NOT_APPLIED", "BIS_SUBMITTED", "HUID_RECEIVED", "CERT_PRINTED", "SOLD", "RETURNED", "CANCELLED"]
  }).notNull().default("NOT_APPLIED"),
  huid_certificate_number: text("huid_certificate_number"),
  huid_certificate_url: text("huid_certificate_url"),
  bis_job_number: text("bis_job_number"),
  hallmark_center_name: text("hallmark_center_name"),
  hallmark_submitted_at: text("hallmark_submitted_at"),
  hallmark_returned_at: text("hallmark_returned_at"),
  design_name: text("design_name"),
  tag_prefix: text("tag_prefix"),
  tag_number: integer("tag_number"),
  location: text("location").default("VAULT"),
  vendor_id: integer("vendor_id"),
  purchase_rate_paise: integer("purchase_rate_paise"),
  purchase_date: text("purchase_date"),
  image_path: text("image_path"),
  status: text("status").default("IN_STOCK"),
  is_published_online: integer("is_published_online", { mode: "boolean" }).default(false),
  is_urd_recycled_gold: integer("is_urd_recycled_gold", { mode: "boolean" }).notNull().default(false),
  online_title: text("online_title"),
  online_description: text("online_description"),
  image_urls: text("image_urls"),
  // Catalog dimensions: weight-priced jewellery vs fixed per-piece articles (coins, etc.).
  sale_mode: text("sale_mode", { enum: ["WEIGHT_WISE", "QUANTITY_WISE"] }).notNull().default("WEIGHT_WISE"),
  uom: text("uom", { enum: ["GRAM", "CARAT", "PIECE"] }).notNull().default("GRAM"),
  unit_price_paise: integer("unit_price_paise").notNull().default(0),
  // LOOSE = untagged bulk stock (e.g. a LOT-mode purchase line); TAGGED = barcoded piece.
  stock_form: text("stock_form", { enum: ["TAGGED", "LOOSE"] }).notNull().default("TAGGED")
});

export const itemGroups = sqliteTable("item_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  metal_type: text("metal_type"),
  hsn_code: text("hsn_code"),
  default_uom: text("default_uom", { enum: ["GRAM", "CARAT", "PIECE"] }).notNull().default("GRAM"),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

// Reusable item templates ("Item Master"): define once, then generate barcoded tags from them.
export const itemDefinitions = sqliteTable("item_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  category: text("category").notNull(),
  metal_type: text("metal_type").notNull(),
  purity_karat: integer("purity_karat").notNull().default(22),
  sale_mode: text("sale_mode", { enum: ["WEIGHT_WISE", "QUANTITY_WISE"] }).notNull().default("WEIGHT_WISE"),
  uom: text("uom", { enum: ["GRAM", "CARAT", "PIECE"] }).notNull().default("GRAM"),
  making_charge_type: text("making_charge_type", { enum: ["PER_GRAM", "FLAT"] }).notNull().default("PER_GRAM"),
  making_charge_value: integer("making_charge_value").notNull().default(0),
  tag_prefix: text("tag_prefix").notNull().default(""),
  hsn_code: text("hsn_code"),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const barcodeSequences = sqliteTable("barcode_sequences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  prefix: text("prefix").notNull().unique(),
  next_number: integer("next_number").notNull().default(1),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`)
});

export const stockVerificationSessions = sqliteTable("stock_verification_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  location: text("location"),
  expected_status: text("expected_status").notNull().default("IN_STOCK"),
  status: text("status", { enum: ["OPEN", "COMPLETED"] }).notNull().default("OPEN"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  completed_at: text("completed_at")
});

export const stockVerificationScans = sqliteTable("stock_verification_scans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  session_id: integer("session_id").notNull().references(() => stockVerificationSessions.id),
  barcode: text("barcode").notNull(),
  item_id: integer("item_id").references(() => items.id),
  result: text("result", { enum: ["FOUND", "UNKNOWN"] }).notNull(),
  scanned_at: text("scanned_at").default(sql`CURRENT_TIMESTAMP`)
});

export const hardwareDevices = sqliteTable("hardware_devices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  device_type: text("device_type", { enum: ["THERMAL_BARCODE_PRINTER", "BARCODE_SCANNER", "RFID_UHF_READER", "SMART_TRAY"] }).notNull(),
  connection_type: text("connection_type", { enum: ["USB_SERIAL", "NETWORK", "KEYBOARD_WEDGE", "MANUAL"] }).notNull(),
  port_name: text("port_name"),
  ip_address: text("ip_address"),
  baud_rate: integer("baud_rate"),
  command_language: text("command_language"),
  label_page_size: text("label_page_size"),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  last_seen_at: text("last_seen_at"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`)
});

export const scannerAuditLogs = sqliteTable("scanner_audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  event_type: text("event_type", { enum: ["BARCODE_SCAN", "RFID_SCAN", "TRAY_SCAN", "UNKNOWN_SCAN", "PRINT_LABEL"] }).notNull(),
  source_device_id: integer("source_device_id").references(() => hardwareDevices.id),
  barcode: text("barcode"),
  rfid_epc: text("rfid_epc"),
  item_id: integer("item_id").references(() => items.id),
  result: text("result").notNull(),
  context: text("context"),
  raw_payload_json: text("raw_payload_json"),
  user_id: integer("user_id").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const smartTraySessions = sqliteTable("smart_tray_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tray_code: text("tray_code").notNull(),
  device_id: integer("device_id").references(() => hardwareDevices.id),
  customer_id: integer("customer_id").references(() => customers.id),
  purpose: text("purpose").notNull().default("SHOWROOM_VIEW"),
  status: text("status", { enum: ["OPEN", "CLOSED"] }).notNull().default("OPEN"),
  opened_by: integer("opened_by").references(() => users.id),
  opened_at: text("opened_at").default(sql`CURRENT_TIMESTAMP`),
  closed_at: text("closed_at")
});

export const smartTrayItems = sqliteTable("smart_tray_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  session_id: integer("session_id").notNull().references(() => smartTraySessions.id),
  item_id: integer("item_id").references(() => items.id),
  barcode: text("barcode").notNull(),
  expected_return: integer("expected_return", { mode: "boolean" }).notNull().default(true),
  returned_at: text("returned_at")
});

export const antiTheftAlerts = sqliteTable("anti_theft_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  alert_type: text("alert_type").notNull(),
  severity: text("severity").notNull().default("HIGH"),
  status: text("status", { enum: ["OPEN", "ACKNOWLEDGED", "RESOLVED"] }).notNull().default("OPEN"),
  item_id: integer("item_id").references(() => items.id),
  barcode: text("barcode"),
  tray_session_id: integer("tray_session_id").references(() => smartTraySessions.id),
  description: text("description").notNull(),
  created_by: integer("created_by").references(() => users.id),
  acknowledged_by: integer("acknowledged_by").references(() => users.id),
  resolved_by: integer("resolved_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  acknowledged_at: text("acknowledged_at"),
  resolved_at: text("resolved_at")
});

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoice_number: text("invoice_number").unique().notNull(),
  customer_id: integer("customer_id").references(() => customers.id),
  walk_in_name: text("walk_in_name"),
  firm_id: integer("firm_id").references(() => firms.id),
  total_amount_paise: integer("total_amount_paise").notNull(),
  gst_percentage: real("gst_percentage"),
  gst_amount_paise: integer("gst_amount_paise").default(0),
  taxable_value_paise: integer("taxable_value_paise").default(0),
  cgst_paise: integer("cgst_paise").default(0),
  sgst_paise: integer("sgst_paise").default(0),
  igst_paise: integer("igst_paise").default(0),
  cess_paise: integer("cess_paise").default(0),
  supply_state_code: text("supply_state_code"),
  place_of_supply_state_code: text("place_of_supply_state_code"),
  gst_supply_type: text("gst_supply_type", { enum: ["INTRA_STATE", "INTER_STATE", "EXPORT", "SEZ"] }).default("INTRA_STATE"),
  hsn_code: text("hsn_code"),
  discount_paise: integer("discount_paise").default(0),
  wastage_total_paise: integer("wastage_total_paise").default(0),
  urd_deduction_paise: integer("urd_deduction_paise").default(0),
  gss_credit_paise: integer("gss_credit_paise").default(0),
  cheque_amount_paise: integer("cheque_amount_paise").default(0),
  neft_amount_paise: integer("neft_amount_paise").default(0),
  invoice_type: text("invoice_type").default("SALE"),
  bill_prefix: text("bill_prefix"),
  manual_number: text("manual_number"),
  due_date: text("due_date"),
  salesman_name: text("salesman_name"),
  gst_not_required: integer("gst_not_required", { mode: "boolean" }).notNull().default(false),
  payment_mode: text("payment_mode").notNull(),
  payment_reference_json: text("payment_reference_json"),
  is_cash_above_limit: integer("is_cash_above_limit", { mode: "boolean" }).default(false),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const invoiceLines = sqliteTable("invoice_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoice_id: integer("invoice_id").notNull().references(() => invoices.id),
  item_id: integer("item_id").notNull().references(() => items.id),
  metal_type: text("metal_type").notNull(),
  purity_karat: integer("purity_karat").notNull(),
  gross_weight_mg: integer("gross_weight_mg").notNull(),
  net_weight_mg: integer("net_weight_mg").notNull(),
  stone_weight_mg: integer("stone_weight_mg").default(0),
  metal_rate_paise_per_gram: integer("metal_rate_paise_per_gram").notNull(),
  making_charge_paise: integer("making_charge_paise").notNull(),
  wastage_charge_paise: integer("wastage_charge_paise").default(0),
  gst_paise: integer("gst_paise").default(0),
  taxable_value_paise: integer("taxable_value_paise").default(0),
  cgst_paise: integer("cgst_paise").default(0),
  sgst_paise: integer("sgst_paise").default(0),
  igst_paise: integer("igst_paise").default(0),
  cess_paise: integer("cess_paise").default(0),
  line_total_paise: integer("line_total_paise").notNull()
});

export const gstAuditPeriodLocks = sqliteTable("gst_audit_period_locks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  period_from: text("period_from").notNull(),
  period_to: text("period_to").notNull(),
  status: text("status", { enum: ["LOCKED", "UNLOCKED"] }).notNull().default("LOCKED"),
  reason: text("reason"),
  locked_by: integer("locked_by").references(() => users.id),
  unlocked_by: integer("unlocked_by").references(() => users.id),
  locked_at: text("locked_at").default(sql`CURRENT_TIMESTAMP`),
  unlocked_at: text("unlocked_at")
});

export const urdPurchases = sqliteTable("urd_purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoice_id: integer("invoice_id").notNull().references(() => invoices.id),
  description: text("description").notNull(),
  metal_type: text("metal_type").notNull(),
  purity_tunch: text("purity_tunch").notNull(),
  weight_mg: integer("weight_mg").notNull(),
  applied_rate_paise_per_gram: integer("applied_rate_paise_per_gram").notNull(),
  deduction_amount_paise: integer("deduction_amount_paise").notNull(),
  stock_item_id: integer("stock_item_id").references(() => items.id),
  refinery_transfer_id: integer("refinery_transfer_id").references(() => refineryTransfers.id),
  stock_status: text("stock_status").notNull().default("PENDING")
});

export const urdVouchers = sqliteTable("urd_vouchers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  voucher_number: text("voucher_number").notNull().unique(),
  customer_id: integer("customer_id").references(() => customers.id),
  customer_name: text("customer_name").notNull(),
  customer_phone: text("customer_phone"),
  voucher_date: text("voucher_date").notNull(),
  description: text("description").notNull(),
  metal_type: text("metal_type").notNull(),
  purity_tunch: text("purity_tunch").notNull(),
  gross_weight_mg: integer("gross_weight_mg").notNull(),
  stone_weight_mg: integer("stone_weight_mg").notNull().default(0),
  black_bead_weight_mg: integer("black_bead_weight_mg").notNull().default(0),
  net_weight_mg: integer("net_weight_mg").notNull(),
  fine_weight_mg: integer("fine_weight_mg").notNull(),
  applied_rate_paise_per_gram: integer("applied_rate_paise_per_gram").notNull(),
  total_value_paise: integer("total_value_paise").notNull(),
  payment_mode: text("payment_mode").notNull(),
  payment_reference: text("payment_reference"),
  pan_number: text("pan_number"),
  aadhaar_number: text("aadhaar_number"),
  stock_item_id: integer("stock_item_id").references(() => items.id),
  refinery_transfer_id: integer("refinery_transfer_id").references(() => refineryTransfers.id),
  stock_status: text("stock_status").notNull().default("PENDING"),
  kyc_verified: integer("kyc_verified", { mode: "boolean" }).notNull().default(false),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const quotations = sqliteTable("quotations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quotation_number: text("quotation_number").notNull().unique(),
  customer_id: integer("customer_id").references(() => customers.id),
  quotation_date: text("quotation_date").notNull(),
  expiry_date: text("expiry_date"),
  salesman_name: text("salesman_name"),
  gross_total_paise: integer("gross_total_paise").notNull(),
  discount_paise: integer("discount_paise").notNull().default(0),
  gst_amount_paise: integer("gst_amount_paise").notNull().default(0),
  total_amount_paise: integer("total_amount_paise").notNull(),
  status: text("status", { enum: ["DRAFT", "POSTED", "CANCELLED", "CONVERTED"] }).notNull().default("POSTED"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const quotationLines = sqliteTable("quotation_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quotation_id: integer("quotation_id").notNull().references(() => quotations.id),
  item_id: integer("item_id").references(() => items.id),
  description: text("description").notNull(),
  metal_type: text("metal_type").notNull(),
  purity_karat: integer("purity_karat").notNull(),
  gross_weight_mg: integer("gross_weight_mg").notNull(),
  stone_weight_mg: integer("stone_weight_mg").notNull().default(0),
  net_weight_mg: integer("net_weight_mg").notNull(),
  metal_rate_paise_per_gram: integer("metal_rate_paise_per_gram").notNull(),
  making_charge_paise: integer("making_charge_paise").notNull().default(0),
  gst_paise: integer("gst_paise").notNull().default(0),
  line_total_paise: integer("line_total_paise").notNull()
});

// Wholesale supplier / vendor master so purchases pick from a list instead of free text.
export const suppliers = sqliteTable("suppliers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  phone: text("phone"),
  gstin: text("gstin"),
  address: text("address"),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  opening_balance_paise: integer("opening_balance_paise").notNull().default(0),
  opening_balance_type: text("opening_balance_type", { enum: ["DEBIT", "CREDIT"] }).notNull().default("CREDIT"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const supplierMetalBalances = sqliteTable("supplier_metal_balances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  supplier_id: integer("supplier_id").notNull().references(() => suppliers.id),
  metal_type: text("metal_type").notNull(),
  fine_weight_mg: integer("fine_weight_mg").notNull().default(0),
  direction: text("direction", { enum: ["TO_RECEIVE", "TO_PAY"] }).notNull().default("TO_RECEIVE"),
  notes: text("notes"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const purchaseInvoices = sqliteTable("purchase_invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  purchase_number: text("purchase_number").notNull().unique(),
  supplier_id: integer("supplier_id").references(() => suppliers.id),
  supplier_name: text("supplier_name").notNull(),
  supplier_phone: text("supplier_phone"),
  supplier_gstin: text("supplier_gstin"),
  purchase_date: text("purchase_date").notNull(),
  bill_number: text("bill_number"),
  payment_mode: text("payment_mode").notNull(),
  payment_reference: text("payment_reference"),
  gross_total_paise: integer("gross_total_paise").notNull(),
  gst_amount_paise: integer("gst_amount_paise").notNull().default(0),
  tds_percent: real("tds_percent").notNull().default(0),
  tds_amount_paise: integer("tds_amount_paise").notNull().default(0),
  total_amount_paise: integer("total_amount_paise").notNull(),
  status: text("status", { enum: ["DRAFT", "POSTED", "CANCELLED", "CONVERTED"] }).notNull().default("POSTED"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const purchaseInvoiceLines = sqliteTable("purchase_invoice_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  purchase_invoice_id: integer("purchase_invoice_id").notNull().references(() => purchaseInvoices.id),
  description: text("description").notNull(),
  // Stock category and piece count, used to ingest barcoded inventory items from the purchase.
  category: text("category").notNull().default("Purchase Stock"),
  quantity: integer("quantity").notNull().default(1),
  // PIECES = one barcoded item per piece; LOT = one weight-wise item holding the full line weight.
  stock_mode: text("stock_mode", { enum: ["PIECES", "LOT"] }).notNull().default("PIECES"),
  metal_type: text("metal_type").notNull(),
  purity_karat: integer("purity_karat").notNull(),
  gross_weight_mg: integer("gross_weight_mg").notNull(),
  stone_weight_mg: integer("stone_weight_mg").notNull().default(0),
  net_weight_mg: integer("net_weight_mg").notNull(),
  metal_rate_paise_per_gram: integer("metal_rate_paise_per_gram").notNull(),
  making_charge_paise: integer("making_charge_paise").notNull().default(0),
  gst_paise: integer("gst_paise").notNull().default(0),
  line_total_paise: integer("line_total_paise").notNull()
});

export const salesReturns = sqliteTable("sales_returns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  return_number: text("return_number").notNull().unique(),
  invoice_id: integer("invoice_id").references(() => invoices.id),
  customer_id: integer("customer_id").references(() => customers.id),
  return_date: text("return_date").notNull(),
  refund_mode: text("refund_mode").notNull(),
  refund_reference: text("refund_reference"),
  reason: text("reason"),
  gross_total_paise: integer("gross_total_paise").notNull(),
  gst_reversal_paise: integer("gst_reversal_paise").notNull().default(0),
  total_refund_paise: integer("total_refund_paise").notNull(),
  status: text("status", { enum: ["DRAFT", "POSTED", "CANCELLED", "CONVERTED"] }).notNull().default("POSTED"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const salesReturnLines = sqliteTable("sales_return_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sales_return_id: integer("sales_return_id").notNull().references(() => salesReturns.id),
  item_id: integer("item_id").references(() => items.id),
  description: text("description").notNull(),
  metal_type: text("metal_type").notNull(),
  purity_karat: integer("purity_karat").notNull(),
  gross_weight_mg: integer("gross_weight_mg").notNull(),
  net_weight_mg: integer("net_weight_mg").notNull(),
  refund_amount_paise: integer("refund_amount_paise").notNull(),
  gst_reversal_paise: integer("gst_reversal_paise").notNull().default(0)
});

export const purchaseReturns = sqliteTable("purchase_returns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  return_number: text("return_number").notNull().unique(),
  purchase_invoice_id: integer("purchase_invoice_id").references(() => purchaseInvoices.id),
  supplier_name: text("supplier_name").notNull(),
  return_date: text("return_date").notNull(),
  refund_mode: text("refund_mode").notNull(),
  refund_reference: text("refund_reference"),
  reason: text("reason"),
  gross_total_paise: integer("gross_total_paise").notNull(),
  gst_reversal_paise: integer("gst_reversal_paise").notNull().default(0),
  total_refund_paise: integer("total_refund_paise").notNull(),
  status: text("status", { enum: ["DRAFT", "POSTED", "CANCELLED", "CONVERTED"] }).notNull().default("POSTED"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const purchaseReturnLines = sqliteTable("purchase_return_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  purchase_return_id: integer("purchase_return_id").notNull().references(() => purchaseReturns.id),
  description: text("description").notNull(),
  metal_type: text("metal_type").notNull(),
  purity_karat: integer("purity_karat").notNull(),
  gross_weight_mg: integer("gross_weight_mg").notNull(),
  net_weight_mg: integer("net_weight_mg").notNull(),
  return_amount_paise: integer("return_amount_paise").notNull(),
  gst_reversal_paise: integer("gst_reversal_paise").notNull().default(0)
});

export const kycVault = sqliteTable("kyc_vault", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customer_id: integer("customer_id").notNull().references(() => customers.id),
  document_type: text("document_type", { enum: ["PAN", "AADHAAR", "PASSPORT", "DRIVING_LICENSE", "VOTER_ID"] }).notNull(),
  document_number_masked: text("document_number_masked").notNull(),
  document_image_path: text("document_image_path"),
  uploaded_at: text("uploaded_at").default(sql`CURRENT_TIMESTAMP`),
  verified_by: integer("verified_by").references(() => users.id)
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  full_name: text("full_name").notNull().default(""),
  password_hash: text("password_hash").notNull(),
  role: text("role", { enum: ["ADMIN", "MANAGER", "ACCOUNTANT", "COUNTER_STAFF"] }).notNull(),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  last_login: text("last_login"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const tokenBlacklist = sqliteTable("token_blacklist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  token_jti: text("token_jti").notNull().unique(),
  user_id: integer("user_id").references(() => users.id),
  blacklisted_at: text("blacklisted_at").default(sql`CURRENT_TIMESTAMP`),
  expires_at: text("expires_at").notNull()
});

export const firms = sqliteTable("firms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  display_name: text("display_name").notNull(),
  gstin: text("gstin"),
  address: text("address"),
  contact_number: text("contact_number"),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export type Firm = typeof firms.$inferSelect;
export type NewFirm = typeof firms.$inferInsert;

export const organizationSettings = sqliteTable("organization_settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  firm_id: integer("firm_id").references(() => firms.id),
  shop_name: text("shop_name").notNull(),
  address: text("address").notNull(),
  gstin: text("gstin"),
  contact_number: text("contact_number").notNull(),
  gold_24k_rate_per_gram: integer("gold_24k_rate_per_gram").notNull().default(0),
  gold_22k_rate_per_gram: integer("gold_22k_rate_per_gram").notNull().default(0),
  gold_18k_rate_per_gram: integer("gold_18k_rate_per_gram").notNull().default(0),
  silver_rate_per_gram: integer("silver_rate_per_gram").notNull().default(0),
  // Per-shop live-rate provider credentials (entered in-app so no key is ever
  // committed or required as an OS env var on the vendor's machine).
  gold_api_key: text("gold_api_key"),
  gold_api_url: text("gold_api_url"),
  default_gst_percentage: real("default_gst_percentage").notNull().default(3.0),
  scale_port_name: text("scale_port_name"),
  scale_baud_rate: integer("scale_baud_rate").notNull().default(9600),
  webhook_secret: text("webhook_secret"),
  ecommerce_sync_url: text("ecommerce_sync_url"),
  tally_sync_enabled: integer("tally_sync_enabled", { mode: "boolean" }).notNull().default(false),
  tally_gateway_url: text("tally_gateway_url").notNull().default("http://localhost:9000"),
  tally_company_name: text("tally_company_name").notNull().default("Test Shop"),
  loyalty_points_per_hundred: integer("loyalty_points_per_hundred").notNull().default(1),
  loyalty_earn_mode: text("loyalty_earn_mode", { enum: ["PER_HUNDRED_RUPEES", "PER_GRAM_GOLD"] }).notNull().default("PER_HUNDRED_RUPEES"),
  loyalty_points_per_gram_gold: integer("loyalty_points_per_gram_gold").notNull().default(1),
  print_language: text("print_language").notNull().default("english"),
  // Moneylending (girvi) licence details printed on statutory forms and statements.
  moneylending_licence_number: text("moneylending_licence_number"),
  moneylending_licence_authority: text("moneylending_licence_authority"),
  moneylending_licence_expiry: text("moneylending_licence_expiry"),
  // Statutory redemption period (months) — drives a pledge's auction-eligible date.
  girvi_redemption_months: integer("girvi_redemption_months").notNull().default(12),
  // When on, a daily worker auto-sends birthday/anniversary greetings.
  auto_greetings_enabled: integer("auto_greetings_enabled", { mode: "boolean" }).notNull().default(false),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`)
});

export const printTemplates = sqliteTable("print_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  document_type: text("document_type", { enum: ["INVOICE", "RECEIPT", "LABEL"] }).notNull(),
  page_size: text("page_size", { enum: ["A4", "A5", "THERMAL_80", "LABEL_50X25", "LABEL_65X35"] }).notNull(),
  content_json: text("content_json").notNull(),
  is_default: integer("is_default", { mode: "boolean" }).notNull().default(false),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`)
});

export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  user_id: integer("user_id").references(() => users.id),
  action: text("action").notNull(),
  target_table: text("target_table").notNull(),
  record_id: integer("record_id"),
  old_values: text("old_values"),
  new_values: text("new_values"),
  timestamp: text("timestamp").default(sql`CURRENT_TIMESTAMP`)
});

export const ledgers = sqliteTable("ledgers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  account_name: text("account_name").notNull(),
  account_type: text("account_type", {
    enum: ["CUSTOMER_UDHARI", "VENDOR", "CASH", "BANK", "TAX", "GSS_LIABILITY", "SALES", "STOCK", "EXPENSE"]
  }).notNull(),
  entity_id: integer("entity_id"),
  balance_paise: integer("balance_paise").notNull().default(0)
});

// Shop running expenses (rent, salary, utilities, sundry) — posts to an EXPENSE ledger,
// paid from Cash or Bank, and feeds the Day Book cash reconciliation.
export const expenses = sqliteTable("expenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  expense_date: text("expense_date").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  amount_paise: integer("amount_paise").notNull(),
  payment_mode: text("payment_mode", { enum: ["CASH", "BANK"] }).notNull().default("CASH"),
  voucher_id: integer("voucher_id"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const voucherHeaders = sqliteTable("voucher_headers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  voucher_number: text("voucher_number").notNull().unique(),
  voucher_type: text("voucher_type").notNull(),
  reference_type: text("reference_type").notNull(),
  reference_id: integer("reference_id"),
  narration: text("narration"),
  total_debit_paise: integer("total_debit_paise").notNull(),
  total_credit_paise: integer("total_credit_paise").notNull(),
  status: text("status", { enum: ["POSTED", "REVERSED"] }).notNull().default("POSTED"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const voucherLines = sqliteTable("voucher_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  voucher_id: integer("voucher_id").notNull().references(() => voucherHeaders.id),
  ledger_id: integer("ledger_id").notNull().references(() => ledgers.id),
  transaction_type: text("transaction_type", { enum: ["CREDIT", "DEBIT"] }).notNull(),
  amount_paise: integer("amount_paise").notNull(),
  description: text("description"),
  journal_entry_id: integer("journal_entry_id").references(() => journalEntries.id)
});

export const journalEntries = sqliteTable("journal_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ledger_id: integer("ledger_id").notNull().references(() => ledgers.id),
  transaction_type: text("transaction_type", { enum: ["CREDIT", "DEBIT"] }).notNull(),
  amount_paise: integer("amount_paise").notNull(),
  reference_type: text("reference_type").notNull(),
  reference_id: integer("reference_id"),
  description: text("description"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const loyaltyLedger = sqliteTable("loyalty_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customer_id: integer("customer_id").notNull().references(() => customers.id),
  invoice_id: integer("invoice_id").references(() => invoices.id),
  transaction_type: text("transaction_type", { enum: ["EARN", "REDEEM"] }).notNull(),
  points: integer("points").notNull(),
  balance_after: integer("balance_after").notNull(),
  description: text("description"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const girviLoans = sqliteTable("girvi_loans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customer_id: integer("customer_id").notNull().references(() => customers.id),
  loan_number: text("loan_number").notNull().unique(),
  principal_amount_paise: integer("principal_amount_paise").notNull(),
  interest_rate_percentage: real("interest_rate_percentage").notNull(),
  interest_type: text("interest_type", { enum: ["SIMPLE", "COMPOUND"] }).notNull(),
  rate_period: text("rate_period", { enum: ["MONTHLY", "ANNUALLY"] }).notNull(),
  interest_period_type: text("interest_period_type").default("MONTHLY").notNull(),
  loan_letter_fee_paise: integer("loan_letter_fee_paise").default(0).notNull(),
  notice_fee_paise: integer("notice_fee_paise").default(0).notNull(),
  customer_photo_path: text("customer_photo_path"),
  thumbprint_path: text("thumbprint_path"),
  issue_date: text("issue_date").notNull(),
  status: text("status", { enum: ["ACTIVE", "SETTLED", "DEFAULTED"] }).notNull().default("ACTIVE"),
  total_repaid_paise: integer("total_repaid_paise").notNull().default(0),
  next_due_date: text("next_due_date"),
  // Date after which an unredeemed pledge may be auctioned (statutory redemption period).
  redemption_deadline: text("redemption_deadline"),
  created_by: integer("created_by").references(() => users.id)
});

export const girviCollateral = sqliteTable("girvi_collateral", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loan_id: integer("loan_id").notNull().references(() => girviLoans.id),
  item_description: text("item_description").notNull(),
  metal_type: text("metal_type").notNull(),
  purity_karat: integer("purity_karat").notNull(),
  // Gross weight as physically weighed; stone/non-metal deduction subtracted to get net.
  gross_weight_mg: integer("gross_weight_mg").notNull().default(0),
  stone_deduction_mg: integer("stone_deduction_mg").notNull().default(0),
  // Net metal weight (gross - stone). This is the weight used for collateral valuation.
  weight_mg: integer("weight_mg").notNull(),
  // Rate per gram actually applied at pledge time (audit trail), and whether it was an admin override.
  valuation_rate_paise_per_gram: integer("valuation_rate_paise_per_gram").notNull().default(0),
  rate_overridden: integer("rate_overridden", { mode: "boolean" }).notNull().default(false),
  image_path: text("image_path")
});

export const girviRepayments = sqliteTable("girvi_repayments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loan_id: integer("loan_id").notNull().references(() => girviLoans.id),
  payment_date: text("payment_date").notNull(),
  amount_paise: integer("amount_paise").notNull(),
  interest_allocated_paise: integer("interest_allocated_paise").notNull(),
  principal_allocated_paise: integer("principal_allocated_paise").notNull(),
  discount_paise: integer("discount_paise").default(0).notNull(),
  notice_fee_paid_paise: integer("notice_fee_paid_paise").default(0).notNull(),
  loan_letter_fee_paid_paise: integer("loan_letter_fee_paid_paise").default(0).notNull(),
  created_by: integer("created_by").references(() => users.id)
});

export const gssTemplates = sqliteTable("gss_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scheme_code: text("scheme_code").notNull().unique(),
  scheme_name: text("scheme_name").notNull(),
  duration_months: integer("duration_months").notNull(),
  monthly_amount_paise: integer("monthly_amount_paise").notNull(),
  bonus_rule_type: text("bonus_rule_type", { enum: ["FIXED_AMOUNT", "PERCENTAGE_OF_INSTALLMENT"] }).notNull(),
  bonus_value_paise: integer("bonus_value_paise").notNull(),
  is_active: integer("is_active", { mode: "boolean" }).notNull().default(true),
  scheme_type: text("scheme_type", { enum: ["CASH", "GOLD"] }).notNull().default("CASH"),
  is_variable: integer("is_variable", { mode: "boolean" }).notNull().default(false),
  min_monthly_amount_paise: integer("min_monthly_amount_paise"),
  max_monthly_amount_paise: integer("max_monthly_amount_paise"),
  // "11+1" style schemes: customer pays `customer_months`, shop funds `maturity_months`.
  customer_months: integer("customer_months"),
  maturity_months: integer("maturity_months")
});

export const gssAccounts = sqliteTable("gss_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customer_id: integer("customer_id").notNull().references(() => customers.id),
  template_id: integer("template_id").notNull().references(() => gssTemplates.id),
  card_number: text("card_number").notNull().unique(),
  enrollment_date: text("enrollment_date").notNull(),
  maturity_date: text("maturity_date").notNull(),
  status: text("status", { enum: ["ACTIVE", "MATURED", "CONVERTED_TO_SALE", "DEFAULTER", "MERGED"] }).notNull().default("ACTIVE"),
  total_paid_paise: integer("total_paid_paise").notNull().default(0),
  installments_paid_count: integer("installments_paid_count").notNull().default(0),
  gold_weight_accumulated_mg: integer("gold_weight_accumulated_mg").notNull().default(0),
  redeemed_invoice_id: integer("redeemed_invoice_id").references(() => invoices.id),
  redeemed_at: text("redeemed_at")
});

export const gssReceipts = sqliteTable("gss_receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gss_account_id: integer("gss_account_id").notNull().references(() => gssAccounts.id),
  installment_number: integer("installment_number").notNull(),
  payment_date: text("payment_date").notNull(),
  amount_paid_paise: integer("amount_paid_paise").notNull(),
  payment_mode: text("payment_mode", { enum: ["CASH", "UPI", "CARD"] }).notNull(),
  journal_entry_id: integer("journal_entry_id").references(() => journalEntries.id),
  created_by: integer("created_by").references(() => users.id),
  gold_rate_per_gram_paise: integer("gold_rate_per_gram_paise"),
  gold_weight_credited_mg: integer("gold_weight_credited_mg")
});

export const karigars = sqliteTable("karigars", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  specialty: text("specialty", { enum: ["CASTING", "HANDMADE", "POLISH", "SETTING"] }).notNull(),
  fine_gold_balance_mg: integer("fine_gold_balance_mg").notNull().default(0),
  cash_balance_paise: integer("cash_balance_paise").notNull().default(0)
});

export const repairJobs = sqliteTable("repair_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customer_id: integer("customer_id").notNull().references(() => customers.id),
  intake_photo_paths: text("intake_photo_paths"),
  description: text("description").notNull(),
  status: text("status", { enum: ["RECEIVED", "WIP", "READY", "DELIVERED"] }).notNull().default("RECEIVED"),
  estimated_charge_paise: integer("estimated_charge_paise").default(0),
  actual_charge_paise: integer("actual_charge_paise").default(0),
  karigar_id: integer("karigar_id").references(() => karigars.id),
  intake_date: text("intake_date").notNull(),
  delivery_date: text("delivery_date")
});

export const jobOrders = sqliteTable("job_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  order_number: text("order_number").notNull().unique(),
  // Human-friendly job/design label, kept separate from the auto-generated order_number slip.
  job_name: text("job_name"),
  karigar_id: integer("karigar_id").notNull().references(() => karigars.id),
  customer_id: integer("customer_id").references(() => customers.id),
  design_image_path: text("design_image_path"),
  target_purity: integer("target_purity").notNull(),
  target_weight_mg: integer("target_weight_mg").notNull(),
  status: text("status", { enum: ["PENDING", "WIP", "COMPLETED", "CANCELLED"] }).notNull().default("PENDING"),
  cancellation_reason: text("cancellation_reason"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const materialIssues = sqliteTable("material_issues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  job_id: integer("job_id").notNull().references(() => jobOrders.id),
  issue_date: text("issue_date").notNull(),
  metal_type: text("metal_type").notNull(),
  purity_tunch: integer("purity_tunch").notNull(),
  gross_weight_mg: integer("gross_weight_mg").notNull(),
  fine_gold_mg: integer("fine_gold_mg").notNull(),
  issued_by: integer("issued_by").references(() => users.id)
});

export const jobReceipts = sqliteTable("job_receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  job_id: integer("job_id").notNull().references(() => jobOrders.id),
  receive_date: text("receive_date").notNull(),
  final_gross_weight_mg: integer("final_gross_weight_mg").notNull(),
  final_net_weight_mg: integer("final_net_weight_mg").notNull(),
  scrap_returned_mg: integer("scrap_returned_mg").notNull(),
  scrap_purity_tunch: integer("scrap_purity_tunch").notNull().default(10000),
  // Wastage allowance the operator entered: PERCENTAGE (value = basis points) or PER_GRAM (value = mg of loss per gram of issued metal).
  wastage_mode: text("wastage_mode", { enum: ["PERCENTAGE", "PER_GRAM"] }).notNull().default("PERCENTAGE"),
  wastage_value: integer("wastage_value").notNull().default(200),
  acceptable_loss_mg: integer("acceptable_loss_mg").notNull(),
  actual_loss_mg: integer("actual_loss_mg").notNull(),
  excess_loss_mg: integer("excess_loss_mg").notNull().default(0),
  is_anomaly: integer("is_anomaly", { mode: "boolean" }).notNull().default(false),
  fine_gold_debited_mg: integer("fine_gold_debited_mg").notNull(),
  labor_charge_paise: integer("labor_charge_paise").notNull(),
  received_by: integer("received_by").references(() => users.id),
  is_transferred: integer("is_transferred", { mode: "boolean" }).notNull().default(false)
});

export type CustomerOrderStatus = "OPEN" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export const customerOrders = sqliteTable("customer_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  order_number: text("order_number").notNull().unique(),
  customer_id: integer("customer_id").notNull().references(() => customers.id),
  item_description: text("item_description").notNull(),
  target_weight_mg: integer("target_weight_mg").notNull().default(0),
  target_purity: integer("target_purity").notNull().default(9167),
  notes: text("notes"),
  customer_gold_mg: integer("customer_gold_mg").notNull().default(0),
  customer_gold_purity_tunch: integer("customer_gold_purity_tunch").notNull().default(10000),
  expected_by_date: text("expected_by_date"),
  advance_paise: integer("advance_paise").notNull().default(0),
  status: text("status", { enum: ["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"] }).notNull().default("OPEN"),
  karigar_job_id: integer("karigar_job_id").references(() => jobOrders.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

// Approval / Jangad / Memo: jewellery handed out on sale-or-return — to a customer "on approval"
// or sent to another jeweller / exhibition. Stock leaves the floor but is not yet sold; each line
// is tracked until it is returned to stock or converted into a sale (invoice).
export const approvalMemos = sqliteTable("approval_memos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memo_number: text("memo_number").notNull().unique(),
  memo_type: text("memo_type", { enum: ["CUSTOMER", "OUTWARD"] }).notNull().default("CUSTOMER"),
  customer_id: integer("customer_id").references(() => customers.id),
  party_name: text("party_name").notNull(),
  party_phone: text("party_phone"),
  issue_date: text("issue_date").notNull(),
  due_date: text("due_date"),
  status: text("status", { enum: ["OPEN", "PARTIAL", "CLOSED", "CONVERTED"] }).notNull().default("OPEN"),
  notes: text("notes"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const approvalMemoLines = sqliteTable("approval_memo_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  memo_id: integer("memo_id").notNull().references(() => approvalMemos.id),
  item_id: integer("item_id").references(() => items.id),
  description: text("description").notNull(),
  barcode: text("barcode"),
  metal_type: text("metal_type"),
  purity_karat: integer("purity_karat"),
  gross_weight_mg: integer("gross_weight_mg").notNull().default(0),
  net_weight_mg: integer("net_weight_mg").notNull().default(0),
  estimated_value_paise: integer("estimated_value_paise").notNull().default(0),
  line_status: text("line_status", { enum: ["OUT", "RETURNED", "SOLD"] }).notNull().default("OUT"),
  returned_at: text("returned_at"),
  invoice_id: integer("invoice_id").references(() => invoices.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export type ApprovalMemo = typeof approvalMemos.$inferSelect;
export type NewApprovalMemo = typeof approvalMemos.$inferInsert;
export type ApprovalMemoLine = typeof approvalMemoLines.$inferSelect;

// Metal loan / unfixed purchase: gold taken from a supplier or bank where the liability is owed in
// FINE GRAMS, not rupees. The shop "fixes" the rate later (fully or in parts) at the prevailing gold
// rate, converting owed grams into a rupee payable. Until fixed, the gram balance floats with the market.
export const metalLoans = sqliteTable("metal_loans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loan_number: text("loan_number").notNull().unique(),
  supplier_id: integer("supplier_id").notNull().references(() => suppliers.id),
  metal_type: text("metal_type").notNull().default("Gold"),
  issue_date: text("issue_date").notNull(),
  gross_weight_mg: integer("gross_weight_mg").notNull().default(0),
  // Purity as basis points (e.g. 9999 = 99.99%) to match the fine-weight convention elsewhere.
  purity_basis_points: integer("purity_basis_points").notNull().default(9999),
  fine_weight_mg: integer("fine_weight_mg").notNull().default(0),
  // Remaining unfixed fine weight (mg). Starts equal to fine_weight_mg, drops as rate is fixed.
  fine_outstanding_mg: integer("fine_outstanding_mg").notNull().default(0),
  // Running rupee value of fixed portions.
  fixed_amount_paise: integer("fixed_amount_paise").notNull().default(0),
  status: text("status", { enum: ["UNFIXED", "PARTIALLY_FIXED", "FIXED"] }).notNull().default("UNFIXED"),
  notes: text("notes"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const metalLoanFixings = sqliteTable("metal_loan_fixings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  loan_id: integer("loan_id").notNull().references(() => metalLoans.id),
  fixing_date: text("fixing_date").notNull(),
  fine_weight_fixed_mg: integer("fine_weight_fixed_mg").notNull(),
  rate_paise_per_gram: integer("rate_paise_per_gram").notNull(),
  amount_paise: integer("amount_paise").notNull(),
  notes: text("notes"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export type MetalLoan = typeof metalLoans.$inferSelect;
export type MetalLoanFixing = typeof metalLoanFixings.$inferSelect;

// GST e-invoice (IRP). We build the canonical IRP request payload + QR content + the document hash
// (IRN) locally. Actual IRP registration happens via a configured GSP gateway or by the jeweller on
// the government portal; the registered IRN / Ack / signed QR are recorded back here.
export const einvoiceDocuments = sqliteTable("einvoice_documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoice_id: integer("invoice_id").notNull().references(() => invoices.id),
  doc_type: text("doc_type").notNull().default("INV"),
  supply_category: text("supply_category").notNull().default("B2C"),
  irn: text("irn"),
  ack_no: text("ack_no"),
  ack_date: text("ack_date"),
  signed_qr_code: text("signed_qr_code"),
  qr_content: text("qr_content"),
  payload_json: text("payload_json"),
  gateway: text("gateway").notNull().default("LOCAL"),
  irp_registered: integer("irp_registered", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["PREPARED", "REGISTERED", "CANCELLED", "FAILED"] }).notNull().default("PREPARED"),
  cancel_reason: text("cancel_reason"),
  cancelled_at: text("cancelled_at"),
  error_message: text("error_message"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

// E-way bill for goods movement above the value threshold (branch transfer, karigar, exhibition,
// dispatch). Same prepare-locally / register-via-gateway-or-portal model as e-invoice.
export const ewaybills = sqliteTable("ewaybills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoice_id: integer("invoice_id").notNull().references(() => invoices.id),
  eway_bill_number: text("eway_bill_number"),
  eway_date: text("eway_date"),
  valid_until: text("valid_until"),
  transport_mode: text("transport_mode").notNull().default("ROAD"),
  vehicle_number: text("vehicle_number"),
  transporter_id: text("transporter_id"),
  transporter_name: text("transporter_name"),
  distance_km: integer("distance_km").notNull().default(0),
  from_pincode: text("from_pincode"),
  to_pincode: text("to_pincode"),
  payload_json: text("payload_json"),
  gateway: text("gateway").notNull().default("LOCAL"),
  status: text("status", { enum: ["PREPARED", "GENERATED", "CANCELLED"] }).notNull().default("PREPARED"),
  cancel_reason: text("cancel_reason"),
  cancelled_at: text("cancelled_at"),
  error_message: text("error_message"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export type EinvoiceDocument = typeof einvoiceDocuments.$inferSelect;
export type Ewaybill = typeof ewaybills.$inferSelect;

export type NewItem = typeof items.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const customersRelations = relations(customers, ({ many }) => ({
  gssAccounts: many(gssAccounts),
  girviLoans: many(girviLoans),
  invoices: many(invoices),
  ledgers: many(ledgers),
  loyaltyLedger: many(loyaltyLedger)
}));

export const gssAccountsRelations = relations(gssAccounts, ({ one }) => ({
  customer: one(customers, {
    fields: [gssAccounts.customer_id],
    references: [customers.id]
  }),
  template: one(gssTemplates, {
    fields: [gssAccounts.template_id],
    references: [gssTemplates.id]
  })
}));

export const gssTemplatesRelations = relations(gssTemplates, ({ many }) => ({
  gssAccounts: many(gssAccounts)
}));

export const girviLoansRelations = relations(girviLoans, ({ one, many }) => ({
  customer: one(customers, {
    fields: [girviLoans.customer_id],
    references: [customers.id]
  }),
  collateral: many(girviCollateral)
}));

export const girviCollateralRelations = relations(girviCollateral, ({ one }) => ({
  loan: one(girviLoans, {
    fields: [girviCollateral.loan_id],
    references: [girviLoans.id]
  })
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  customer: one(customers, {
    fields: [invoices.customer_id],
    references: [customers.id]
  })
}));

export const loyaltyLedgerRelations = relations(loyaltyLedger, ({ one }) => ({
  customer: one(customers, {
    fields: [loyaltyLedger.customer_id],
    references: [customers.id]
  }),
  invoice: one(invoices, {
    fields: [loyaltyLedger.invoice_id],
    references: [invoices.id]
  })
}));

export const ledgersRelations = relations(ledgers, ({ one }) => ({
  customer: one(customers, {
    fields: [ledgers.entity_id],
    references: [customers.id]
  })
}));

export const voucherHeadersRelations = relations(voucherHeaders, ({ many }) => ({
  lines: many(voucherLines)
}));

export const voucherLinesRelations = relations(voucherLines, ({ one }) => ({
  voucher: one(voucherHeaders, {
    fields: [voucherLines.voucher_id],
    references: [voucherHeaders.id]
  }),
  ledger: one(ledgers, {
    fields: [voucherLines.ledger_id],
    references: [ledgers.id]
  }),
  journalEntry: one(journalEntries, {
    fields: [voucherLines.journal_entry_id],
    references: [journalEntries.id]
  })
}));

export const itemStones = sqliteTable("item_stones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  item_id: integer("item_id").notNull().references(() => items.id),
  stone_type: text("stone_type", { enum: ["DIAMOND", "RUBY", "SAPPHIRE", "EMERALD", "OTHER"] }).notNull(),
  shape: text("shape"),
  carat_weight: real("carat_weight").notNull(),
  color_grade: text("color_grade"),
  clarity_grade: text("clarity_grade"),
  cut_grade: text("cut_grade"),
  certificate_number: text("certificate_number").unique(),
  certificate_lab: text("certificate_lab", { enum: ["GIA", "IGI", "HRD", "NONE"] }).default("NONE"),
  stone_rate_paise: integer("stone_rate_paise").notNull()
});

export const itemStonesRelations = relations(itemStones, ({ one }) => ({
  item: one(items, {
    fields: [itemStones.item_id],
    references: [items.id]
  })
}));

export const itemsRelations = relations(items, ({ many }) => ({
  stones: many(itemStones)
}));

export const huidLifecycleEvents = sqliteTable("huid_lifecycle_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  item_id: integer("item_id").notNull().references(() => items.id),
  from_status: text("from_status"),
  to_status: text("to_status", {
    enum: ["NOT_APPLIED", "BIS_SUBMITTED", "HUID_RECEIVED", "CERT_PRINTED", "SOLD", "RETURNED", "CANCELLED"]
  }).notNull(),
  event_type: text("event_type").notNull(),
  remarks: text("remarks"),
  bis_job_number: text("bis_job_number"),
  huid: text("huid"),
  certificate_number: text("certificate_number"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const bisSubmissions = sqliteTable("bis_submissions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  submission_number: text("submission_number").notNull().unique(),
  hallmark_center_name: text("hallmark_center_name").notNull(),
  submitted_date: text("submitted_date").notNull(),
  expected_return_date: text("expected_return_date"),
  status: text("status", { enum: ["DRAFT", "SUBMITTED", "PARTIAL_RETURN", "COMPLETED", "CANCELLED"] }).notNull().default("SUBMITTED"),
  remarks: text("remarks"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const bisSubmissionItems = sqliteTable("bis_submission_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  submission_id: integer("submission_id").notNull().references(() => bisSubmissions.id),
  item_id: integer("item_id").notNull().references(() => items.id),
  submitted_gross_weight_mg: integer("submitted_gross_weight_mg").notNull(),
  submitted_net_weight_mg: integer("submitted_net_weight_mg").notNull(),
  returned_at: text("returned_at"),
  huid: text("huid"),
  certificate_number: text("certificate_number"),
  certificate_url: text("certificate_url"),
  status: text("status", { enum: ["SUBMITTED", "HUID_RECEIVED", "REJECTED"] }).notNull().default("SUBMITTED"),
  remarks: text("remarks")
});

export const refineries = sqliteTable("refineries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  phone: text("phone"),
  fine_gold_balance_mg: integer("fine_gold_balance_mg").notNull().default(0),
  cash_balance_paise: integer("cash_balance_paise").notNull().default(0),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const refineryTransfers = sqliteTable("refinery_transfers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  refinery_id: integer("refinery_id").notNull().references(() => refineries.id),
  transfer_date: text("transfer_date").notNull(),
  metal_type: text("metal_type").notNull().default("Gold"),
  gross_weight_mg: integer("gross_weight_mg").notNull(),
  purity_tunch: real("purity_tunch").notNull(),
  fine_gold_mg: integer("fine_gold_mg").notNull(),
  description: text("description"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const refineryReceipts = sqliteTable("refinery_receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  refinery_id: integer("refinery_id").notNull().references(() => refineries.id),
  receive_date: text("receive_date").notNull(),
  fine_gold_received_mg: integer("fine_gold_received_mg").notNull().default(0),
  charges_paise: integer("charges_paise").notNull().default(0),
  payment_mode: text("payment_mode").notNull().default("CASH"),
  description: text("description"),
  created_by: integer("created_by").references(() => users.id),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const messageTemplates = sqliteTable("message_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  channel: text("channel").notNull(),
  content: text("content").notNull(),
  is_active: integer("is_active").notNull().default(1),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export const messageLogs = sqliteTable("message_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customer_id: integer("customer_id").references(() => customers.id),
  template_name: text("template_name").notNull(),
  recipient: text("recipient").notNull(),
  message_body: text("message_body").notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull(),
  error_message: text("error_message"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export type BackupType = "MANUAL" | "SCHEDULED";
export type BackupTarget = "LOCAL" | "USB" | "CLOUD";
export type BackupLogStatus = "SUCCESS" | "FAILED" | "UPLOADING";

export const backupLogs = sqliteTable("backup_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  backup_type: text("backup_type", { enum: ["MANUAL", "SCHEDULED"] }).notNull(),
  target: text("target", { enum: ["LOCAL", "USB", "CLOUD"] }).notNull(),
  file_name: text("file_name").notNull(),
  file_path: text("file_path").notNull(),
  file_size_bytes: integer("file_size_bytes").notNull(),
  checksum_sha256: text("checksum_sha256").notNull(),
  is_encrypted: integer("is_encrypted", { mode: "boolean" }).notNull().default(true),
  status: text("status", { enum: ["SUCCESS", "FAILED", "UPLOADING"] }).notNull(),
  error_message: text("error_message"),
  started_at: text("started_at").notNull(),
  completed_at: text("completed_at"),
  created_by: integer("created_by").references(() => users.id)
});

export const backupScheduleConfig = sqliteTable("backup_schedule_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  is_enabled: integer("is_enabled", { mode: "boolean" }).notNull().default(false),
  interval_hours: integer("interval_hours").notNull().default(24),
  target: text("target", { enum: ["LOCAL", "USB", "CLOUD"] }).notNull().default("LOCAL"),
  local_backup_dir: text("local_backup_dir"),
  usb_backup_dir: text("usb_backup_dir"),
  cloud_upload_url: text("cloud_upload_url"),
  max_retained_backups: integer("max_retained_backups").notNull().default(10),
  passphrase_hash: text("passphrase_hash"),
  backup_on_exit: integer("backup_on_exit", { mode: "boolean" }).notNull().default(false),
  last_run_at: text("last_run_at"),
  updated_at: text("updated_at").default(sql`CURRENT_TIMESTAMP`)
});

export const errorLog = sqliteTable("error_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  error_message: text("error_message").notNull(),
  stack_trace: text("stack_trace"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});

export type SyncQueueTaskType = "TALLY_VOUCHER" | "ECOMMERCE_ITEM_SOLD";
export type SyncQueueStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED";

export const syncQueue = sqliteTable("sync_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  task_type: text("task_type", { enum: ["TALLY_VOUCHER", "ECOMMERCE_ITEM_SOLD"] }).notNull(),
  payload: text("payload").notNull(),
  status: text("status", { enum: ["PENDING", "PROCESSING", "DONE", "FAILED"] }).notNull().default("PENDING"),
  attempts: integer("attempts").notNull().default(0),
  last_attempted_at: text("last_attempted_at"),
  created_at: text("created_at").default(sql`CURRENT_TIMESTAMP`)
});
