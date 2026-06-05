import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db, sqlite } from "../src/db/client.js";
import { users, karigars, items, customers, organizationSettings } from "../src/db/schema.js";
import { hashPassword } from "../src/utils/auth.js";

async function globalSetup() {
  // Ensure we are working with the test database path
  process.env.NODE_ENV = "test";

  // Run migrations
  migrate(db, { migrationsFolder: "./drizzle" });

  // Wipe every data table so each E2E run starts from a clean, deterministic
  // state (the test DB file persists between runs). FK off so order is irrelevant.
  sqlite.pragma("foreign_keys = OFF");
  const tables = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'")
    .all() as Array<{ name: string }>;
  for (const { name } of tables) {
    sqlite.prepare(`DELETE FROM "${name}"`).run();
  }
  sqlite.pragma("foreign_keys = ON");

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

  // 2. Seed Organization Settings
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

  // 2.5 Seed a customer for E2E flows (repairs, customer-linked sales)
  db.insert(customers).values({
    id: 1,
    name: "Test Customer",
    phone: "9990001112"
  }).run();

  // 3. Seed 1 Karigar
  db.insert(karigars).values({
    id: 1,
    name: "Test Ramesh",
    phone: "9998887771",
    specialty: "HANDMADE",
    fine_gold_balance_mg: 0,
    cash_balance_paise: 0
  }).run();

  // 4. Seed 5 Inventory items
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
}

export default globalSetup;
