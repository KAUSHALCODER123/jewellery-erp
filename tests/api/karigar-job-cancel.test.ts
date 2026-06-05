import request from "supertest";
import { eq, and } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { auditLogs, jobOrders, karigars } from "../../src/db/schema.js";

describe("Job order cancellation returns issued metal", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  test("cancelling a WIP job returns fine gold to the karigar balance and is idempotently terminal", async () => {
    // 1. Create a job order for the seeded karigar (id = 1).
    const createRes = await request(app)
      .post("/api/karigar/jobs")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        order_number: "JOB-CANCEL-001",
        karigar_id: 1,
        target_purity: "91.66",
        target_weight_mg: 10000
      });

    expect(createRes.status).toBe(201);
    const jobId = createRes.body.job.id as number;

    // 2. Issue 10g (10000 mg) fine gold: 10000 mg gross at 100% tunch.
    const issueRes = await request(app)
      .post("/api/karigar/issue-metal")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        job_id: jobId,
        gross_weight_mg: 10000,
        purity_tunch: "100.00",
        issue_date: "2026-06-01",
        metal_type: "GOLD"
      });

    expect(issueRes.status).toBe(201);

    const karigarAfterIssue = db.select().from(karigars).where(eq(karigars.id, 1)).get();
    expect(karigarAfterIssue?.fine_gold_balance_mg).toBe(10000);

    // 3. Cancel the job with a reason.
    const cancelRes = await request(app)
      .patch(`/api/karigar/jobs/${jobId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cancellation_reason: "Customer cancelled the bespoke order." });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.job.status).toBe("CANCELLED");
    expect(cancelRes.body.returned_fine_gold_mg).toBe(10000);

    // 4. Job status persisted as CANCELLED with the reason.
    const persistedJob = db.select().from(jobOrders).where(eq(jobOrders.id, jobId)).get();
    expect(persistedJob?.status).toBe("CANCELLED");
    expect(persistedJob?.cancellation_reason).toBe("Customer cancelled the bespoke order.");

    // 5. Karigar fine-gold balance returns to 0.
    const karigarAfterCancel = db.select().from(karigars).where(eq(karigars.id, 1)).get();
    expect(karigarAfterCancel?.fine_gold_balance_mg).toBe(0);

    // 6. Audit log records the cancellation.
    const cancelLog = db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "CANCEL_JOB_ORDER"), eq(auditLogs.record_id, jobId)))
      .get();
    expect(cancelLog).toBeDefined();

    // 7. Cancelling again is rejected — terminal state.
    const secondCancel = await request(app)
      .patch(`/api/karigar/jobs/${jobId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ cancellation_reason: "again" });

    expect(secondCancel.status).toBe(409);

    // Balance must not change on the rejected second attempt.
    const karigarFinal = db.select().from(karigars).where(eq(karigars.id, 1)).get();
    expect(karigarFinal?.fine_gold_balance_mg).toBe(0);
  });
});
