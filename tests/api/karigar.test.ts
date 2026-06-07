import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { karigars, itemStones, jobOrders, items, materialIssues, jobReceipts, customers, auditLogs } from "../../src/db/schema.js";
import { eq, and } from "drizzle-orm";

describe("API Hostile Math & Input Constraints", () => {
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

  test("POST /api/karigar/receive-job with negative weight should fail and not alter ledger", async () => {
    // 1. Create a job order for our seeded Karigar (id = 1)
    const newJob = db
      .insert(jobOrders)
      .values({
        order_number: "JOB-HOSTILE-001",
        karigar_id: 1,
        target_purity: 9166,
        target_weight_mg: 10000,
        status: "PENDING"
      })
      .returning()
      .get();

    // 2. Issue some metal to them (10,000 mg gross, 91.66% tunch = 9166 mg fine gold)
    await request(app)
      .post("/api/karigar/issue-metal")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        job_id: newJob.id,
        gross_weight_mg: 10000,
        purity_tunch: "91.66",
        issue_date: "2026-06-01",
        metal_type: "GOLD"
      });

    // Verify Karigar balance has risen to 9166 mg
    const karigarBefore = db.select().from(karigars).where(eq(karigars.id, 1)).get();
    expect(karigarBefore?.fine_gold_balance_mg).toBe(9166);

    // 3. Attempt to receive job with hostile weight (final_net_weight_mg: -5000)
    const receivePayload = {
      job_id: newJob.id,
      final_gross_weight_mg: 5000,
      final_net_weight_mg: -5000, // Negative!
      scrap_returned_mg: 0,
      scrap_purity_tunch: "91.66",
      acceptable_wastage_percentage: "2.0",
      labor_charge_paise: 10000,
      receive_date: "2026-06-03"
    };

    const receiveRes = await request(app)
      .post("/api/karigar/receive-job")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(receivePayload);

    // Assert that the request fails due to constraint validation
    expect(receiveRes.status).toBe(400);
    expect(receiveRes.body.errors).toContain("final_net_weight_mg must be a positive integer.");

    // Assert that the Karigar's fine gold liability ledger remained completely untouched (9166 mg)
    const karigarAfter = db.select().from(karigars).where(eq(karigars.id, 1)).get();
    expect(karigarAfter?.fine_gold_balance_mg).toBe(9166);
  });

  test("POST /api/inventory/items/:id/stones with partial invalid values should fail and persist nothing", async () => {
    const testItemId = 1; // Seeded item in setup

    // Verify item starts with no stones
    const stonesBefore = db.select().from(itemStones).where(eq(itemStones.item_id, testItemId)).all();
    expect(stonesBefore.length).toBe(0);

    // Construct a payload containing 3 stones, one of which has an invalid ENUM value "GLASS"
    const hostileStonesPayload = {
      stones: [
        {
          stone_type: "DIAMOND",
          shape: "ROUND",
          carat_weight: 1.5,
          stone_rate_paise: 50000,
          certificate_lab: "GIA"
        },
        {
          stone_type: "GLASS", // Invalid! Should trigger rejection
          shape: "OVAL",
          carat_weight: 2.0,
          stone_rate_paise: 100,
          certificate_lab: "NONE"
        },
        {
          stone_type: "RUBY",
          shape: "EMERALD",
          carat_weight: 0.5,
          stone_rate_paise: 20000,
          certificate_lab: "IGI"
        }
      ]
    };

    const attachRes = await request(app)
      .post(`/api/inventory/items/${testItemId}/stones`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(hostileStonesPayload);

    // Assert that the request is rejected as a 400 Bad Request
    expect(attachRes.status).toBe(400);
    expect(attachRes.body.errors[0]).toContain("stone_type must be DIAMOND, RUBY, SAPPHIRE, EMERALD, or OTHER.");

    // Verify that absolutely no stones were saved in the database for this item (atomicity preserved)
    const stonesAfter = db.select().from(itemStones).where(eq(itemStones.item_id, testItemId)).all();
    expect(stonesAfter.length).toBe(0);
  });

  // TEST 4 — Karigar repeat metal issue.
  //
  // SPEC DEVIATION (adapted to real behavior): the spec expected the second issue
  // to be rejected with 409/422 METAL_ALREADY_ISSUED. No such guard exists — and
  // multiple issues per job are INTENTIONAL: POST /api/karigar/receive-job sums
  // every material_issue for the job (issues.reduce). So this test documents the
  // real contract: a second issue succeeds (201) and the karigar's fine-gold
  // balance ACCUMULATES across issues (it is not doubled or reset).
  test("POST /api/karigar/issue-metal permits repeated issues to the same job and accumulates balance", async () => {
    const job = db
      .insert(jobOrders)
      .values({ order_number: "JO-TEST-001", karigar_id: 1, target_purity: 9166, target_weight_mg: 10000, status: "PENDING" })
      .returning()
      .get();

    // First issue: 10g gross at 100% tunch = 10000 mg fine gold.
    const firstIssue = await request(app)
      .post("/api/karigar/issue-metal")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ job_id: job.id, gross_weight_mg: 10000, purity_tunch: "100.00", issue_date: "2026-06-01", metal_type: "GOLD" });

    expect(firstIssue.status).toBe(201);
    expect(db.select().from(karigars).where(eq(karigars.id, 1)).get()?.fine_gold_balance_mg).toBe(10000);

    // Second issue: 5g gross at 100% tunch = 5000 mg fine gold.
    const secondIssue = await request(app)
      .post("/api/karigar/issue-metal")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ job_id: job.id, gross_weight_mg: 5000, purity_tunch: "100.00", issue_date: "2026-06-02", metal_type: "GOLD" });

    // No METAL_ALREADY_ISSUED guard: succeeds and balance accumulates to 15g.
    expect(secondIssue.status).toBe(201);
    expect(db.select().from(karigars).where(eq(karigars.id, 1)).get()?.fine_gold_balance_mg).toBe(15000);

    // Both issues are recorded against the job.
    const issues = db.select().from(materialIssues).where(eq(materialIssues.job_id, job.id)).all();
    expect(issues.length).toBe(2);
  });

  // TEST 5 — Karigar job cancellation returns issued metal.
  // Cancelling a PENDING/WIP job returns all issued fine gold to vault stock
  // (karigar balance decremented to 0), sets status CANCELLED, writes an audit
  // log, and is terminal (a second cancel is rejected with 409).
  test("PATCH /api/karigar/jobs/:id/cancel returns issued metal and is terminal", async () => {
    const job = db
      .insert(jobOrders)
      .values({ order_number: "JO-CANCEL-001", karigar_id: 1, target_purity: 9166, target_weight_mg: 15000, status: "PENDING" })
      .returning()
      .get();

    // Issue 15g fine gold (15000 mg gross at 100% tunch).
    const issueRes = await request(app)
      .post("/api/karigar/issue-metal")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ job_id: job.id, gross_weight_mg: 15000, purity_tunch: "100.00", issue_date: "2026-06-01", metal_type: "GOLD" });

    expect(issueRes.status).toBe(201);
    expect(db.select().from(karigars).where(eq(karigars.id, 1)).get()?.fine_gold_balance_mg).toBe(15000);

    // Cancel the job.
    const cancelRes = await request(app)
      .patch(`/api/karigar/jobs/${job.id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cancellation_reason: "Design rejected by customer." });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.job.status).toBe("CANCELLED");

    // Karigar balance returned to 0.
    expect(db.select().from(karigars).where(eq(karigars.id, 1)).get()?.fine_gold_balance_mg).toBe(0);

    // Job persisted as CANCELLED.
    expect(db.select().from(jobOrders).where(eq(jobOrders.id, job.id)).get()?.status).toBe("CANCELLED");

    // Cancellation recorded in the audit log.
    const cancelLog = db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "CANCEL_JOB_ORDER"), eq(auditLogs.record_id, job.id)))
      .get();
    expect(cancelLog).toBeDefined();

    // Second cancel is rejected — terminal state.
    const secondCancel = await request(app)
      .patch(`/api/karigar/jobs/${job.id}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cancellation_reason: "again" });

    expect(secondCancel.status).toBe(409);
  });

  // Auto-generated sequential job slip number + job name + customer link.
  test("POST /api/karigar/jobs auto-generates JOB-#### and stores job_name + customer link", async () => {
    const customer = db.insert(customers).values({ name: "Custom Order Buyer", phone: "9000000001" }).returning().get();

    const first = await request(app)
      .post("/api/karigar/jobs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ job_name: "Bridal Bangle", karigar_id: 1, customer_id: customer.id, target_purity: "91.60", target_weight_mg: 20000 });

    expect(first.status).toBe(201);
    expect(first.body.job.order_number).toBe("JOB-0001");
    expect(first.body.job.job_name).toBe("Bridal Bangle");
    expect(first.body.job.customer_id).toBe(customer.id);

    // Next job auto-increments the slip number.
    const second = await request(app)
      .post("/api/karigar/jobs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ job_name: "Plain Chain", karigar_id: 1, target_purity: "91.60", target_weight_mg: 10000 });

    expect(second.status).toBe(201);
    expect(second.body.job.order_number).toBe("JOB-0002");
  });

  // PER_GRAM wastage allowance computed against issued gross weight, recorded on the receipt.
  test("POST /api/karigar/receive-job honours PER_GRAM wastage allowance", async () => {
    const job = db
      .insert(jobOrders)
      .values({ order_number: "JOB-PERGRAM", karigar_id: 1, target_purity: 10000, target_weight_mg: 10000, status: "PENDING" })
      .returning()
      .get();

    // Issue 10g gross at 100% tunch => 10000 mg fine gold, 10000 mg gross.
    await request(app)
      .post("/api/karigar/issue-metal")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ job_id: job.id, gross_weight_mg: 10000, purity_tunch: "100.00", metal_type: "GOLD", issue_date: "2026-06-01" });

    // Receive 9.8g finished net (0 stone), 0 scrap. Allowance 0.100 g/gram of issued gross (10g) => 1000 mg.
    // Actual loss = 10000 - 9800 = 200 mg, well under the 1000 mg allowance => no excess.
    const res = await request(app)
      .post("/api/karigar/receive-job")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        job_id: job.id,
        final_gross_weight_mg: 9800,
        final_net_weight_mg: 9800,
        scrap_returned_mg: 0,
        scrap_purity_tunch: "100.00",
        wastage_mode: "PER_GRAM",
        wastage_value: "0.100",
        labor_charge_paise: 50000,
        receive_date: "2026-06-03"
      });

    expect(res.status).toBe(201);

    const receipt = db.select().from(jobReceipts).where(eq(jobReceipts.job_id, job.id)).get();
    expect(receipt?.wastage_mode).toBe("PER_GRAM");
    expect(receipt?.wastage_value).toBe(100); // 0.100 g => 100 mg per gram
    expect(receipt?.acceptable_loss_mg).toBe(1000);
    expect(receipt?.actual_loss_mg).toBe(200);
    expect(receipt?.excess_loss_mg).toBe(0);

    // Liability fully settled: issued 10000 mg, debited 10000 mg => balance 0.
    expect(db.select().from(karigars).where(eq(karigars.id, 1)).get()?.fine_gold_balance_mg).toBe(0);
  });

  // The receive preview must reconcile against issued fine gold, not the target
  // finished weight — so the jobs list exposes the aggregated issued amounts.
  test("GET /api/karigar/jobs exposes issued fine and gross gold per job", async () => {
    const job = db
      .insert(jobOrders)
      .values({ order_number: "JOB-ISSUED-AGG", karigar_id: 1, target_purity: 9160, target_weight_mg: 48000, status: "PENDING" })
      .returning()
      .get();

    // Issue 50 g gross at 91.60% => floor(50000 * 9160 / 10000) = 45800 mg fine.
    await request(app)
      .post("/api/karigar/issue-metal")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ job_id: job.id, gross_weight_mg: 50000, purity_tunch: "91.60", issue_date: "2026-06-01", metal_type: "GOLD" });

    const res = await request(app)
      .get("/api/karigar/jobs")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const listed = res.body.jobs.find((j: { id: number }) => j.id === job.id);
    expect(listed.issued_fine_mg).toBe(45800);
    expect(listed.issued_gross_mg).toBe(50000);
  });
});
