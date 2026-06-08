import request from "supertest";
import jwt from "jsonwebtoken";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "../src/db/client.js";
import { app } from "../src/server.js";
import {
  items,
  karigars,
  users,
  jobOrders,
  materialIssues,
  ledgers,
  jobReceipts
} from "../src/db/schema.js";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET || "local-development-jwt-secret-change-me";

// Helpers to mint test tokens
function mintToken(userId: number, username: string, role: string) {
  return jwt.sign({ userId, id: userId, username, role, is_active: true }, JWT_SECRET, {
    expiresIn: "1h"
  });
}

const adminToken = mintToken(1, "test_admin", "ADMIN");
const counterStaffToken = mintToken(2, "test_staff", "COUNTER_STAFF");

describe("E2E Integration & Stress Test Suite", () => {
  beforeAll(() => {
    // Run drizzle migrations on the test database
    migrate(db, { migrationsFolder: "./drizzle" });
  });

  beforeEach(() => {
    db.delete(jobReceipts).run();
    db.delete(materialIssues).run();
    db.delete(jobOrders).run();
    db.delete(items).run();
    db.delete(karigars).run();
    db.delete(users).run();
    db.delete(ledgers).run();

    // Seed users so that foreign key constraints on verified_by/issued_by/received_by are satisfied
    db.insert(users).values([
      {
        id: 1,
        username: "test_admin",
        full_name: "Test Admin",
        password_hash: "mocked",
        role: "ADMIN",
        is_active: true
      },
      {
        id: 2,
        username: "test_staff",
        full_name: "Test Staff",
        password_hash: "mocked",
        role: "COUNTER_STAFF",
        is_active: true
      }
    ]).run();
  });

  describe("1. Access Control & Privilege Escalation Checks", () => {
    test("GET /api/reports/mis/kpi-summary should return 403 Forbidden for COUNTER_STAFF", async () => {
      const response = await request(app)
        .get("/api/reports/mis/kpi-summary")
        .set("Authorization", `Bearer ${counterStaffToken}`);

      expect(response.status).toBe(403);
      expect(response.body.errors).toContain("Insufficient role access.");
    });

    test("GET /api/reports/mis/kpi-summary should return 200 OK for ADMIN", async () => {
      const response = await request(app)
        .get("/api/reports/mis/kpi-summary")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty("total_gold_mg");
      expect(response.body).toHaveProperty("total_market_value_paise");
    });
  });

  describe("2. POS checkout Transaction Atomicity Rollback Check", () => {
    test("Transaction must roll back item status to 'IN_STOCK' if a line item fails verification", async () => {
      // 1. Insert a mock gold item
      const testItem = db
        .insert(items)
        .values({
          barcode: "E2E-RNG-001",
          huid: "HUID01",
          // Must be fully hallmarked, otherwise checkout rejects it on the BIS
          // hallmark gate before reaching the missing-item rollback path under test.
          huid_status: "HUID_RECEIVED",
          category: "Rings",
          metal_type: "Gold",
          purity_karat: 22,
          gross_weight_mg: 10000,
          stone_weight_mg: 0,
          net_weight_mg: 10000,
          making_charge_type: "FLAT",
          making_charge_value: 50000,
          status: "IN_STOCK"
        })
        .returning()
        .get();

      // 2. Submit a checkout request containing Item 1 (valid) and Item 99999 (invalid/missing)
      const checkoutPayload = {
        customer_id: null,
        cartItems: [
          {
            item_id: testItem.id,
            barcode: testItem.barcode,
            metal_type: testItem.metal_type,
            purity_karat: testItem.purity_karat,
            gross_weight_mg: testItem.gross_weight_mg,
            net_weight_mg: testItem.net_weight_mg,
            stone_weight_mg: testItem.stone_weight_mg,
            metal_rate_paise_per_gram: 600000,
            making_charge_paise: 50000,
            item_total_paise: 650000
          },
          {
            item_id: 99999, // Invalid ID to force failure inside transaction
            barcode: "INVALID-BARCODE",
            metal_type: "Gold",
            purity_karat: 22,
            gross_weight_mg: 1000,
            net_weight_mg: 1000,
            stone_weight_mg: 0,
            metal_rate_paise_per_gram: 600000,
            making_charge_paise: 10000,
            item_total_paise: 610000
          }
        ],
        urdItems: [],
        totals: {
          grossTotalPaise: 1260000,
          discountPaise: 0,
          urdDeductionPaise: 0,
          netPayablePaise: 1260000
        },
        payments: {
          cash: 1260000,
          upi: 0,
          card: 0,
          udhari: 0,
          gssCredit: 0
        }
      };

      const response = await request(app)
        .post("/api/pos/checkout")
        .set("Authorization", `Bearer ${counterStaffToken}`)
        .send(checkoutPayload);

      // Verify checkout failed with conflict/missing status
      expect(response.status).toBe(409);
      expect(response.body.errors[0]).toContain("was not found");

      // Verify that Item 1 is still 'IN_STOCK' (proving the entire transaction rolled back)
      const itemAfterRollback = db
        .select()
        .from(items)
        .where(eq(items.id, testItem.id))
        .get();

      expect(itemAfterRollback?.status).toBe("IN_STOCK");
    });
  });

  describe("3. Compliance & KYC Enforcement Checks", () => {
    test("POS checkout with cash >= ₹2,00,000 without KYC should fail with 400 Bad Request", async () => {
      const testItem = db
        .insert(items)
        .values({
          barcode: "E2E-RNG-002",
          category: "Rings",
          metal_type: "Gold",
          purity_karat: 22,
          gross_weight_mg: 350000, // 350g gold
          stone_weight_mg: 0,
          net_weight_mg: 350000,
          making_charge_type: "FLAT",
          making_charge_value: 1000000,
          status: "IN_STOCK"
        })
        .returning()
        .get();

      const largeCashPayload = {
        customer_id: null,
        cartItems: [
          {
            item_id: testItem.id,
            barcode: testItem.barcode,
            metal_type: testItem.metal_type,
            purity_karat: testItem.purity_karat,
            gross_weight_mg: testItem.gross_weight_mg,
            net_weight_mg: testItem.net_weight_mg,
            stone_weight_mg: testItem.stone_weight_mg,
            metal_rate_paise_per_gram: 600000,
            making_charge_paise: 1000000,
            item_total_paise: 22000000 // Rs 2,20,000 (exceeds threshold)
          }
        ],
        urdItems: [],
        totals: {
          grossTotalPaise: 22000000,
          discountPaise: 0,
          urdDeductionPaise: 0,
          netPayablePaise: 22000000
        },
        payments: {
          cash: 22000000,
          upi: 0,
          card: 0,
          udhari: 0,
          gssCredit: 0
        }
      };

      const response = await request(app)
        .post("/api/pos/checkout")
        .set("Authorization", `Bearer ${counterStaffToken}`)
        .send(largeCashPayload);

      expect(response.status).toBe(400);
      expect(response.body.errors).toContain("pan_number is required when cash is Rs 2,00,000 or above.");
      expect(response.body.errors).toContain("aadhaar_number is required when cash is Rs 2,00,000 or above.");
    });
  });

  describe("4. Karigar Wastage Math Checks", () => {
    test("Receiving job with excess wastage calculates excessLossMg and updates ledger correctly", async () => {
      // 1. Create a test Karigar
      const testKarigar = db
        .insert(karigars)
        .values({
          name: "Test Ramesh",
          phone: "9998887771",
          specialty: "HANDMADE",
          fine_gold_balance_mg: 0,
          cash_balance_paise: 0
        })
        .returning()
        .get();

      // 2. Create a test job order
      const testJob = db
        .insert(jobOrders)
        .values({
          order_number: "JOB-E2E-001",
          karigar_id: testKarigar.id,
          target_purity: 9166, // 22K (91.66%)
          target_weight_mg: 10000,
          status: "PENDING"
        })
        .returning()
        .get();

      // 3. Issue metal to the Karigar
      const issuePayload = {
        job_id: testJob.id,
        gross_weight_mg: 10000, // 10g issued
        purity_tunch: "91.66",
        issue_date: "2026-06-01",
        metal_type: "GOLD"
      };

      const issueRes = await request(app)
        .post("/api/karigar/issue-metal")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(issuePayload);
      if (issueRes.status !== 201) {
        console.error("issue-metal failed:", issueRes.status, issueRes.body);
      }
      expect(issueRes.status).toBe(201);

      // Verify Karigar fine gold balance is now 9166 mg
      const karigarAfterIssue = db.select().from(karigars).where(eq(karigars.id, testKarigar.id)).get();
      expect(karigarAfterIssue?.fine_gold_balance_mg).toBe(9166);

      // 4. Receive job with massive gold loss (finished ring is only 5g, 0g scrap)
      // Issued: 9166 mg fine gold.
      // Returned: 5000 mg gross @ 22K (91.66%) = 4583 mg fine gold.
      // Net Loss: 9166 - 4583 = 4583 mg fine gold.
      // Acceptable loss (default 2% basis points = 200 bps): 9166 * 0.02 = 183 mg.
      // Excess loss: 4583 - 183 = 4400 mg fine gold.
      const receivePayload = {
        job_id: testJob.id,
        final_gross_weight_mg: 5000,
        final_net_weight_mg: 5000,
        scrap_returned_mg: 0,
        scrap_purity_tunch: "91.66",
        acceptable_wastage_percentage: "2.0", // 2.0%
        labor_charge_paise: 150000, // Rs 1500
        receive_date: "2026-06-03"
      };

      const receiveRes = await request(app)
        .post("/api/karigar/receive-job")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(receivePayload);

      if (receiveRes.status !== 201) {
        console.error("receive-job failed:", receiveRes.status, receiveRes.body);
      }
      expect(receiveRes.status).toBe(201);
      
      // Verify calculations in response
      expect(receiveRes.body.receipt.actual_loss_mg).toBe(4583);
      expect(receiveRes.body.receipt.acceptable_loss_mg).toBe(183);
      expect(receiveRes.body.receipt.excess_loss_mg).toBe(4400);
      expect(receiveRes.body.receipt.loss_exceeded).toBe(true);

      // Verify Karigar balance is updated correctly (fine gold balance should be 4400 mg representing excess loss)
      const karigarAfterReceive = db.select().from(karigars).where(eq(karigars.id, testKarigar.id)).get();
      expect(karigarAfterReceive?.fine_gold_balance_mg).toBe(4400);
      expect(karigarAfterReceive?.cash_balance_paise).toBe(150000);
    });
  });
});
