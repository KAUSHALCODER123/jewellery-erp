import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import {
  auditLogs,
  customers,
  girviCollateral,
  girviLoans,
  girviRepayments,
  gssAccounts,
  gssReceipts,
  gssTemplates,
  invoiceLines,
  invoices,
  items,
  jobOrders,
  jobReceipts,
  journalEntries,
  karigars,
  kycVault,
  ledgers,
  materialIssues,
  organizationSettings,
  repairJobs,
  urdPurchases,
  users,
  voucherHeaders,
  voucherLines
} from "../src/db/schema.js";

const sqlite = new Database("sqlite.db");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);

console.log("Starting Jewelry ERP seed...");

db.transaction((tx) => {
  console.log("Clearing existing data in reverse dependency order...");
  tx.delete(urdPurchases).run();
  tx.delete(invoiceLines).run();
  tx.delete(gssReceipts).run();
  tx.delete(gssAccounts).run();
  tx.delete(gssTemplates).run();
  tx.delete(girviRepayments).run();
  tx.delete(girviCollateral).run();
  tx.delete(girviLoans).run();
  tx.delete(jobReceipts).run();
  tx.delete(materialIssues).run();
  tx.delete(jobOrders).run();
  tx.delete(repairJobs).run();
  tx.delete(voucherLines).run();
  tx.delete(journalEntries).run();
  tx.delete(voucherHeaders).run();
  tx.delete(auditLogs).run();
  tx.delete(kycVault).run();
  tx.delete(invoices).run();
  tx.delete(items).run();
  tx.delete(karigars).run();
  tx.delete(ledgers).run();
  tx.delete(customers).run();
  tx.delete(users).run();
  tx.delete(organizationSettings).run();
  tx.run(sql`DELETE FROM sqlite_sequence WHERE name IN (
    'urd_purchases',
    'invoice_lines',
    'gss_receipts',
    'gss_accounts',
    'gss_templates',
    'girvi_repayments',
    'girvi_collateral',
    'girvi_loans',
    'job_receipts',
    'material_issues',
    'job_orders',
    'repair_jobs',
    'voucher_lines',
    'journal_entries',
    'voucher_headers',
    'audit_logs',
    'kyc_vault',
    'invoices',
    'items',
    'karigars',
    'ledgers',
    'customers',
    'users',
    'organization_settings'
  )`);

  console.log("Seeding organization settings...");
  tx.insert(organizationSettings)
    .values({
      shop_name: "Shree Jewelers",
      address: "MG Road, Pune, Maharashtra 411001",
      gstin: "27AAAAA0000A1Z5",
      contact_number: "9876543210",
      gold_24k_rate_per_gram: 750000,
      gold_22k_rate_per_gram: 687500,
      gold_18k_rate_per_gram: 562500,
      silver_rate_per_gram: 9000,
      default_gst_percentage: 3.0,
      scale_baud_rate: 9600
    })
    .run();

  console.log("Seeding admin user for test login...");
  tx.insert(users)
    .values({
      username: "admin",
      full_name: "System Administrator",
      password_hash: bcrypt.hashSync("admin1234", 12),
      role: "ADMIN",
      is_active: true
    })
    .run();

  console.log("Seeding customers and CRM/KYC data...");
  const rahul = tx.insert(customers).values({
    name: "Rahul Sharma",
    phone: "9000000001",
    address: "Kothrud, Pune",
    area: "Kothrud",
    taluka: "Haveli",
    district: "Pune",
    birthday_date: "1988-04-12",
    loyalty_points_balance: 120
  }).returning().get();

  const anita = tx.insert(customers).values({
    name: "Anita Desai",
    phone: "9000000002",
    address: "Deccan, Pune",
    area: "Deccan",
    taluka: "Haveli",
    district: "Pune",
    aadhaar_number: "****1234",
    pan_number: "ABCDE1234F",
    anniversary_date: "2012-11-22",
    birthday_date: "1985-08-05",
    ring_size: "14",
    spouse_name: "Nikhil Desai",
    loyalty_points_balance: 480
  }).returning().get();

  const vikram = tx.insert(customers).values({
    name: "Vikram Singh",
    phone: "9000000003",
    address: "Camp, Pune",
    area: "Camp",
    taluka: "Pune City",
    district: "Pune",
    pan_number: "FGHIJ5678K",
    loyalty_points_balance: 80
  }).returning().get();

  void rahul;
  void anita;

  console.log("Seeding ledgers, including Vikram udhari and vendor ledger...");
  tx.insert(ledgers).values([
    {
      account_name: "Cash",
      account_type: "CASH",
      entity_id: null,
      balance_paise: 0
    },
    {
      account_name: "UPI Bank",
      account_type: "BANK",
      entity_id: null,
      balance_paise: 0
    },
    {
      account_name: "Card Bank",
      account_type: "BANK",
      entity_id: null,
      balance_paise: 0
    },
    {
      account_name: "Customer Udhari Vikram Singh",
      account_type: "CUSTOMER_UDHARI",
      entity_id: vikram.id,
      balance_paise: 1500000
    },
    {
      account_name: "GSS Liability",
      account_type: "GSS_LIABILITY",
      entity_id: null,
      balance_paise: 0
    }
  ]).run();

  const vendor = tx.insert(ledgers).values({
    account_name: "Mumbai Bullion Syndicate",
    account_type: "VENDOR",
    entity_id: null,
    balance_paise: 0
  }).returning().get();

  console.log("Seeding karigars...");
  tx.insert(karigars).values([
    {
      name: "Ramesh (Handmade)",
      phone: "9100000001",
      specialty: "HANDMADE",
      fine_gold_balance_mg: 0,
      cash_balance_paise: 0
    },
    {
      name: "Suresh (Casting)",
      phone: "9100000002",
      specialty: "CASTING",
      fine_gold_balance_mg: 0,
      cash_balance_paise: 0
    }
  ]).run();

  console.log("Seeding vault inventory with 10 in-stock items...");
  tx.insert(items).values([
    createItem("SJ-RNG-0001", "A1B2C3", "Rings", "Gold", 22, 12500, 0, "Classic 22K Ring", 0, vendor.id, 675000, 125000),
    createItem("SJ-RNG-0002", "D4E5F6", "Rings", "Gold", 22, 8750, 250, "Ruby Stone Ring", 0, vendor.id, 675000, 95000),
    createItem("SJ-RNG-0003", null, "Rings", "Gold", 24, 5200, 0, "Plain Coin Ring", 0, vendor.id, 735000, 80000),
    createItem("SJ-CHN-0001", "G7H8I9", "Chains", "Gold", 22, 18500, 0, "Daily Wear Chain", 2.5, vendor.id, 675000, 150000),
    createItem("SJ-CHN-0002", "J1K2L3", "Chains", "Gold", 22, 24250, 0, "Box Chain", 2.5, vendor.id, 675000, 160000),
    createItem("SJ-CHN-0003", null, "Chains", "Gold", 24, 30200, 0, "Temple Chain", 2.5, vendor.id, 735000, 175000),
    createItem("SJ-CHN-0004", null, "Chains", "Gold", 22, 12500, 0, "Lightweight 22K Chain", 2.5, vendor.id, 675000, 140000),
    createItem("SJ-CN-0001", "M4N5O6", "Coins", "Gold", 24, 10000, 0, "24K Lakshmi Coin", 0, vendor.id, 735000, 50000),
    createItem("SJ-CN-0002", null, "Coins", "Gold", 24, 5000, 0, "24K Five Gram Coin", 0, vendor.id, 735000, 30000),
    createItem("SJ-CN-0003", null, "Coins", "Silver", 24, 50000, 0, "Silver Puja Coin", 0, vendor.id, 9000, 15000)
  ]).run();

  console.log("Seeding Gold Saving Scheme template...");
  tx.insert(gssTemplates)
    .values({
      scheme_code: "GSS-DHAN-11",
      scheme_name: "11-Month Dhanteras Plan",
      duration_months: 11,
      monthly_amount_paise: 500000,
      bonus_rule_type: "FIXED_AMOUNT",
      bonus_value_paise: 500000,
      is_active: true
    })
    .run();
});

console.log("Seed complete.");
sqlite.close();

function createItem(
  barcode: string,
  huid: string | null,
  category: string,
  metalType: string,
  purityKarat: number,
  grossWeightMg: number,
  stoneWeightMg: number,
  designName: string,
  wastagePercentage: number,
  vendorId: number,
  purchaseRatePaise: number,
  makingChargeValuePaise: number
) {
  return {
    barcode,
    huid,
    category,
    metal_type: metalType,
    purity_karat: purityKarat,
    gross_weight_mg: grossWeightMg,
    stone_weight_mg: stoneWeightMg,
    net_weight_mg: grossWeightMg - stoneWeightMg,
    wastage_percentage: wastagePercentage,
    making_charge_type: "PER_GRAM" as const,
    making_charge_value: makingChargeValuePaise,
    design_name: designName,
    location: "VAULT",
    vendor_id: vendorId,
    purchase_rate_paise: purchaseRatePaise,
    purchase_date: "2026-06-01",
    image_path: null,
    status: "IN_STOCK"
  };
}
