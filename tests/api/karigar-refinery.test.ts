import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { karigars, jobOrders, jobReceipts, items, refineries, refineryTransfers, refineryReceipts } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

describe("Karigar & Refinery Integration Tests", () => {
  let adminToken: string;

  beforeEach(async () => {
    // Log in as Admin to obtain authorization
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        username: "test_admin",
        password: "admin_pass",
      });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  describe("Karigar Barcode Transfer API", () => {
    test("POST /api/karigar/jobs/:id/transfer-to-barcode should succeed for completed job and fail for duplicates", async () => {
      // 1. Create a job order for seeded Karigar (id = 1)
      const job = db
        .insert(jobOrders)
        .values({
          order_number: "JOB-TRANSFER-101",
          karigar_id: 1,
          target_purity: 9160,
          target_weight_mg: 15000,
          status: "COMPLETED" // Mark as completed
        })
        .returning()
        .get();

      // 2. Create the job receipt
      const receipt = db
        .insert(jobReceipts)
        .values({
          job_id: job.id,
          receive_date: "2026-06-01",
          final_gross_weight_mg: 15100,
          final_net_weight_mg: 14900,
          scrap_returned_mg: 100,
          scrap_purity_tunch: 10000,
          acceptable_loss_mg: 300,
          actual_loss_mg: 200,
          excess_loss_mg: 0,
          is_anomaly: false,
          fine_gold_debited_mg: 14900,
          labor_charge_paise: 50000,
          is_transferred: false
        })
        .returning()
        .get();

      // 3. Make transfer request
      const barcode = "TFRBAR101";
      const transferRes = await request(app)
        .post(`/api/karigar/jobs/${job.id}/transfer-to-barcode`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          barcode,
          huid: "HUID99",
          category: "RING",
          making_charge_type: "PER_GRAM",
          making_charge_value: 10000, // in paise
          design_name: "Test Design"
        });

      expect(transferRes.status).toBe(201);
      expect(transferRes.body.item).toBeDefined();
      expect(transferRes.body.item.barcode).toBe(barcode);
      expect(transferRes.body.item.huid).toBe("HUID99");

      // Verify DB update
      const updatedReceipt = db.select().from(jobReceipts).where(eq(jobReceipts.id, receipt.id)).get();
      expect(updatedReceipt?.is_transferred).toBe(true);

      const dbItem = db.select().from(items).where(eq(items.barcode, barcode)).get();
      expect(dbItem).toBeDefined();
      expect(dbItem?.status).toBe("IN_STOCK");
      expect(dbItem?.net_weight_mg).toBe(14900);
      expect(dbItem?.gross_weight_mg).toBe(15100);
      expect(dbItem?.purity_karat).toBe(22); // 91.60% maps to 22K

      // 4. Test duplicate barcode transfer rejection
      const duplicateRes = await request(app)
        .post(`/api/karigar/jobs/${job.id}/transfer-to-barcode`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          barcode, // Duplicate!
          category: "RING",
          making_charge_type: "PER_GRAM",
          making_charge_value: 10000
        });

      expect(duplicateRes.status).toBe(409);
    });
  });

  describe("Refinery Management API", () => {
    test("Refinery workflow: Create, Transfer scrap, Receive fine gold, check Ledger", async () => {
      // 1. Create a refinery master
      const createRes = await request(app)
        .post("/api/refineries")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Golden Gate Refinery",
          phone: "9876543210"
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.refinery).toBeDefined();
      expect(createRes.body.refinery.name).toBe("Golden Gate Refinery");
      const refineryId = createRes.body.refinery.id;

      // Verify DB
      const refineryBefore = db.select().from(refineries).where(eq(refineries.id, refineryId)).get();
      expect(refineryBefore?.fine_gold_balance_mg).toBe(0);
      expect(refineryBefore?.cash_balance_paise).toBe(0);

      // 2. Transfer scrap gold (100g = 100,000 mg at 92.00% tunch = 92,000 mg fine gold)
      const transferRes = await request(app)
        .post("/api/refineries/transfers")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          refinery_id: refineryId,
          gross_weight_mg: 100000,
          purity_tunch: 92.00, // 92%
          description: "Smelting gold scraps"
        });

      expect(transferRes.status).toBe(201);
      expect(transferRes.body.transfer).toBeDefined();
      expect(transferRes.body.transfer.fine_gold_mg).toBe(92000);

      // Verify refinery balance increased
      const refineryAfterTransfer = db.select().from(refineries).where(eq(refineries.id, refineryId)).get();
      expect(refineryAfterTransfer?.fine_gold_balance_mg).toBe(92000);

      // 3. Receive refined gold back (e.g. receive 50,000 mg fine gold, and pay 1,500 Rs in charges = 150,000 paise)
      const receiptRes = await request(app)
        .post("/api/refineries/receipts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          refinery_id: refineryId,
          fine_gold_received_mg: 50000,
          charges_paise: 150000,
          payment_mode: "CASH",
          description: "Received fine gold bar"
        });

      expect(receiptRes.status).toBe(201);

      // Verify balances updated:
      // Fine gold: 92,000 - 50,000 = 42,000 mg
      // Cash: 0 + 150,000 = 150,000 paise
      const refineryAfterReceipt = db.select().from(refineries).where(eq(refineries.id, refineryId)).get();
      expect(refineryAfterReceipt?.fine_gold_balance_mg).toBe(42000);
      expect(refineryAfterReceipt?.cash_balance_paise).toBe(150000);

      // 4. Retrieve Ledger timeline and check running balances
      const ledgerRes = await request(app)
        .get(`/api/refineries/${refineryId}/ledger`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(ledgerRes.status).toBe(200);
      expect(ledgerRes.body.timeline).toHaveLength(2);

      // Timeline events are returned newest first (descending).
      // Event 0 (newest) should be the RECEIPT
      // Event 1 (oldest) should be the TRANSFER
      const event0 = ledgerRes.body.timeline[0];
      const event1 = ledgerRes.body.timeline[1];

      expect(event0.type).toBe("RECEIPT");
      expect(event0.running_fine_gold_mg).toBe(42000);
      expect(event0.running_cash_paise).toBe(150000);

      expect(event1.type).toBe("TRANSFER");
      expect(event1.running_fine_gold_mg).toBe(92000);
      expect(event1.running_cash_paise).toBe(0);
    });
  });
});
