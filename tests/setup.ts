import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../src/db/client.js";
import {
  barcodeSequences,
  users,
  invoiceLines,
  invoices,
  urdPurchases,
  karigars,
  items,
  jobReceipts,
  materialIssues,
  ledgers,
  jobOrders,
  organizationSettings,
  journalEntries,
  kycVault,
  stockVerificationScans,
  stockVerificationSessions,
  urdVouchers,
  voucherHeaders,
  voucherLines,
  quotationLines,
  quotations,
  purchaseInvoiceLines,
  purchaseInvoices,
  salesReturnLines,
  salesReturns,
  purchaseReturnLines,
  purchaseReturns,
  refineries,
  refineryTransfers,
  refineryReceipts,
  girviLoans,
  girviCollateral,
  girviRepayments,
  hardwareDevices,
  scannerAuditLogs,
  smartTraySessions,
  smartTrayItems,
  antiTheftAlerts,
  bisSubmissions,
  bisSubmissionItems,
  huidLifecycleEvents,
  gstAuditPeriodLocks,
  customers,
  gssReceipts,
  gssAccounts,
  gssTemplates,
  backupLogs,
  backupScheduleConfig,
  itemStones,
  repairJobs,
  messageLogs,
  messageTemplates,
  printTemplates,
  auditLogs,
  tokenBlacklist,
  itemGroups,
  itemDefinitions
} from "../src/db/schema.js";
import { hashPassword } from "../src/utils/auth.js";

beforeAll(async () => {
  // Run drizzle migrations on the test database
  migrate(db, { migrationsFolder: "./drizzle" });

  // Seed default users for any test file's beforeAll if not already present
  const adminUser = db.query.users.findFirst({
    where: eq(users.username, "test_admin")
  }).sync();

  if (!adminUser) {
    const adminHash = await hashPassword("admin_pass");
    const staffHash = await hashPassword("staff_pass");

    db.insert(users).values([
      {
        id: 1,
        username: "test_admin",
        full_name: "Test Admin",
        password_hash: adminHash,
        role: "ADMIN",
        is_active: true
      },
      {
        id: 2,
        username: "test_staff",
        full_name: "Test Staff",
        password_hash: staffHash,
        role: "COUNTER_STAFF",
        is_active: true
      }
    ]).run();
  }
});

beforeEach(async () => {
  // Clean all tables to ensure isolation, deleting child tables first
  db.delete(backupLogs).run();
  db.delete(backupScheduleConfig).run();
  db.delete(bisSubmissionItems).run();
  db.delete(bisSubmissions).run();
  db.delete(huidLifecycleEvents).run();
  db.delete(gstAuditPeriodLocks).run();
  db.delete(antiTheftAlerts).run();
  db.delete(smartTrayItems).run();
  db.delete(smartTraySessions).run();
  db.delete(scannerAuditLogs).run();
  db.delete(hardwareDevices).run();
  db.delete(jobReceipts).run();
  db.delete(materialIssues).run();
  db.delete(jobOrders).run();
  db.delete(purchaseReturnLines).run();
  db.delete(purchaseReturns).run();
  db.delete(salesReturnLines).run();
  db.delete(salesReturns).run();
  db.delete(purchaseInvoiceLines).run();
  db.delete(purchaseInvoices).run();
  db.delete(quotationLines).run();
  db.delete(quotations).run();
  db.delete(urdPurchases).run();
  db.delete(gssReceipts).run();
  db.delete(gssAccounts).run();
  db.delete(gssTemplates).run();
  db.delete(invoiceLines).run();
  db.delete(voucherLines).run();
  db.delete(journalEntries).run();
  db.delete(voucherHeaders).run();
  db.delete(kycVault).run();
  db.delete(invoices).run();
  db.delete(urdVouchers).run();
  db.delete(stockVerificationScans).run();
  db.delete(stockVerificationSessions).run();
  db.delete(refineryReceipts).run();
  db.delete(refineryTransfers).run();
  db.delete(refineries).run();
  db.delete(girviRepayments).run();
  db.delete(girviCollateral).run();
  db.delete(girviLoans).run();
  db.delete(itemStones).run();
  db.delete(repairJobs).run();
  db.delete(messageLogs).run();
  db.delete(messageTemplates).run();
  db.delete(printTemplates).run();
  db.delete(auditLogs).run();
  db.delete(customers).run();
  db.delete(tokenBlacklist).run();
  db.delete(items).run();
  db.delete(itemGroups).run();
  db.delete(itemDefinitions).run();
  db.delete(barcodeSequences).run();
  db.delete(karigars).run();
  db.delete(organizationSettings).run();
  console.log("BEFORE DELETE USERS COUNT:", db.select().from(users).all().length);
  db.delete(users).run();
  console.log("AFTER DELETE USERS COUNT:", db.select().from(users).all().length);
  db.delete(ledgers).run();

  // Hash passwords
  const adminHash = await hashPassword("admin_pass");
  const staffHash = await hashPassword("staff_pass");

  // 1. Seed base users
  db.insert(users).values([
    {
      id: 1,
      username: "test_admin",
      full_name: "Test Admin",
      password_hash: adminHash,
      role: "ADMIN",
      is_active: true
    },
    {
      id: 2,
      username: "test_staff",
      full_name: "Test Staff",
      password_hash: staffHash,
      role: "COUNTER_STAFF",
      is_active: true
    }
  ]).run();

  // 1.5. Seed Organization Settings
  db.insert(organizationSettings).values({
    id: 1,
    shop_name: "Test Shop",
    address: "Test Address",
    contact_number: "9999999999",
    gold_24k_rate_per_gram: 650000,
    gold_22k_rate_per_gram: 600000,
    gold_18k_rate_per_gram: 500000,
    silver_rate_per_gram: 8000,
    default_gst_percentage: 3.0
  }).run();

  // 2. Seed 1 Karigar
  db.insert(karigars).values({
    id: 1,
    name: "Test Ramesh",
    phone: "9998887771",
    specialty: "HANDMADE",
    fine_gold_balance_mg: 0,
    cash_balance_paise: 0
  }).run();

  // 3. Seed 5 Inventory items
  db.insert(items).values([
    {
      id: 1,
      barcode: "ITEM-001",
      category: "Rings",
      metal_type: "Gold",
      purity_karat: 22,
      gross_weight_mg: 10000,
      net_weight_mg: 10000,
      making_charge_type: "FLAT",
      making_charge_value: 50000,
      status: "IN_STOCK",
      purchase_rate_paise: 400000,
      huid: "HUID01",
      huid_status: "HUID_RECEIVED"
    },
    {
      id: 2,
      barcode: "ITEM-002",
      category: "Necklaces",
      metal_type: "Gold",
      purity_karat: 22,
      gross_weight_mg: 20000,
      net_weight_mg: 20000,
      making_charge_type: "FLAT",
      making_charge_value: 100000,
      status: "IN_STOCK",
      purchase_rate_paise: 800000,
      huid: "HUID02",
      huid_status: "HUID_RECEIVED"
    },
    {
      id: 3,
      barcode: "ITEM-003",
      category: "Earrings",
      metal_type: "Gold",
      purity_karat: 22,
      gross_weight_mg: 5000,
      net_weight_mg: 5000,
      making_charge_type: "FLAT",
      making_charge_value: 25000,
      status: "IN_STOCK",
      purchase_rate_paise: 200000,
      huid: "HUID03",
      huid_status: "HUID_RECEIVED"
    },
    {
      id: 4,
      barcode: "ITEM-004",
      category: "Bracelets",
      metal_type: "Gold",
      purity_karat: 22,
      gross_weight_mg: 15000,
      net_weight_mg: 15000,
      making_charge_type: "FLAT",
      making_charge_value: 75000,
      status: "IN_STOCK",
      purchase_rate_paise: 600000,
      huid: "HUID04",
      huid_status: "HUID_RECEIVED"
    },
    {
      id: 5,
      barcode: "ITEM-005",
      category: "Chains",
      metal_type: "Gold",
      purity_karat: 22,
      gross_weight_mg: 12000,
      net_weight_mg: 12000,
      making_charge_type: "FLAT",
      making_charge_value: 60000,
      status: "IN_STOCK",
      purchase_rate_paise: 480000,
      huid: "HUID05",
      huid_status: "HUID_RECEIVED"
    }
  ]).run();
});
