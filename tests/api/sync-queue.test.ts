import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items, syncQueue, errorLog } from "../../src/db/schema.js";

describe("Graceful error handling and sync queue", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // Ensure ITEM-001 is in a sellable state
    db.update(items).set({ status: "IN_STOCK" }).where(eq(items.id, 1)).run();

    // Clean up any leftover sync queue / error log entries
    db.delete(syncQueue).run();
    db.delete(errorLog).run();
  });

  it("enqueues sync tasks after a successful POS checkout (no synchronous sync calls)", async () => {
    // Perform a simple POS checkout with ITEM-001 (hallmarked gold)
    const checkoutRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        cartItems: [
          {
            itemId: 1,
            barcode: "ITEM-001",
            metalType: "Gold",
            purityKarat: 22,
            grossWeightMg: 10000,
            netWeightMg: 10000,
            stoneWeightMg: 0,
            metalRatePaisePerGram: 600000,
            makingChargePaise: 0,
            wastageChargePaise: 0,
            gstPaise: 18000,
            itemTotalPaise: 618000
          }
        ],
        urdItems: [],
        totals: {
          grossTotalPaise: 618000,
          discountPaise: 0,
          urdDeductionPaise: 0,
          netPayablePaise: 618000,
          gstPaise: 18000
        },
        payments: {
          cash: 618000,
          upi: 0,
          card: 0,
          udhari: 0,
          gssCredit: 0
        },
        paymentReferences: {
          cash: null,
          upi: null,
          card: null,
          cheque: null,
          dd: null,
          neft: null,
          bankName: null
        },
        invoice: {
          billPrefix: null,
          manualNumber: null,
          dueDate: null,
          salesmanName: "Test",
          gstNotRequired: false,
          placeOfSupplyStateCode: null,
          gstSupplyType: null
        },
        kyc: {
          panNumber: null,
          aadhaarNumber: null,
          documentImagePath: null
        }
      });

    expect(checkoutRes.status).toBe(201);

    // Verify the sync_queue has PENDING records
    const tallyTasks = db
      .select()
      .from(syncQueue)
      .where(eq(syncQueue.task_type, "TALLY_VOUCHER"))
      .all();

    expect(tallyTasks.length).toBe(1);
    expect(tallyTasks[0].status).toBe("PENDING");

    const ecomTasks = db
      .select()
      .from(syncQueue)
      .where(eq(syncQueue.task_type, "ECOMMERCE_ITEM_SOLD"))
      .all();

    expect(ecomTasks.length).toBe(1);
    expect(ecomTasks[0].status).toBe("PENDING");

    // Verify the payloads are valid JSON
    const tallyPayload = JSON.parse(tallyTasks[0].payload);
    expect(tallyPayload).toHaveProperty("voucherId");
    expect(typeof tallyPayload.voucherId).toBe("number");

    // Verify the server is still healthy — no process.exit was called
    const healthRes = await request(app).get("/health");
    expect(healthRes.status).toBe(200);
    expect(healthRes.body).toEqual({ status: "ok" });

    // Verify no unhandled-rejection error_log entries were created
    const errorRows = db.select().from(errorLog).all();
    expect(errorRows.length).toBe(0);
  });
});
