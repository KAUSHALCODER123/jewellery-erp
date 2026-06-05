import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items, invoices, urdPurchases, syncQueue } from "../../src/db/schema.js";

describe("POS sale flows", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  // TEST 3 — URD old-gold full sale flow.
  // Old gold bought from a customer is ingested as stock with is_urd_recycled_gold=true
  // and huid=null, then must be sellable at POS WITHOUT a HUID (BIS hallmarking is
  // applied later in the refinery/assay cycle). See src/pos/routes.ts HUID bypass.
  it("ingests a URD purchase as recycled-gold stock and sells it past the HUID check", async () => {
    // Seed a minimal invoice + URD purchase to ingest.
    db.insert(invoices)
      .values({ id: 8888, invoice_number: "URD-POS-INV-8888", total_amount_paise: 0, payment_mode: "CASH" })
      .run();
    db.insert(urdPurchases)
      .values({
        id: 8888,
        invoice_id: 8888,
        description: "10g old gold from walk-in customer",
        metal_type: "Gold",
        purity_tunch: "91.67",
        weight_mg: 10000,
        applied_rate_paise_per_gram: 600000,
        deduction_amount_paise: 6000000
      })
      .run();

    // 1. Ingest into stock.
    const ingestRes = await request(app)
      .post("/api/pos/urd-purchases/8888/ingest-stock")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ barcode: "URD-POS-10G", location: "OLD_GOLD_VAULT" });

    expect(ingestRes.status).toBe(201);
    const recycledItem = ingestRes.body.item;
    expect(recycledItem.is_urd_recycled_gold).toBe(true);
    expect(recycledItem.huid).toBeNull();
    expect(recycledItem.status).toBe("IN_STOCK");

    // 2. Checkout the recycled-gold item — must succeed despite having no HUID.
    const itemTotalPaise = 6000000;
    const checkoutRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        cartItems: [
          {
            itemId: recycledItem.id,
            barcode: recycledItem.barcode,
            metalType: "Gold",
            purityKarat: recycledItem.purity_karat,
            grossWeightMg: recycledItem.gross_weight_mg,
            netWeightMg: recycledItem.net_weight_mg,
            stoneWeightMg: 0,
            metalRatePaisePerGram: 600000,
            makingChargePaise: 0,
            wastageChargePaise: 0,
            gstPaise: 0,
            itemTotalPaise
          }
        ],
        urdItems: [],
        totals: { grossTotalPaise: itemTotalPaise, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: itemTotalPaise, gstPaise: 0 },
        payments: { cash: itemTotalPaise, upi: 0, card: 0, udhari: 0, gssCredit: 0 },
        paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
        invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
        kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
      });

    // 201 = NOT blocked by the HUID gate.
    expect(checkoutRes.status).toBe(201);

    const soldItem = db.select().from(items).where(eq(items.id, recycledItem.id)).get();
    expect(soldItem?.status).toBe("SOLD");
  });

  // TEST 8 — Checkout survives a broken Tally sync.
  // Checkout does NOT call syncVoucherToTally synchronously; it enqueues a
  // TALLY_VOUCHER row in sync_queue, which the background worker drains with
  // retries. So even if the Tally gateway is unreachable, the sale completes and
  // the server stays up. This test verifies that decoupling end-to-end.
  it("completes checkout and stays healthy even though Tally sync is decoupled via sync_queue", async () => {
    // Isolate the queue assertion from rows other tests may have enqueued
    // (sync_queue is not reset by the shared beforeEach).
    db.delete(syncQueue).run();

    // ITEM-004 is gold/22k with a valid HUID; reset to sellable.
    db.update(items).set({
      status: "IN_STOCK",
      huid: "HUID04",
      huid_status: "HUID_RECEIVED",
      is_urd_recycled_gold: false
    }).where(eq(items.id, 4)).run();

    const itemTotalPaise = 9000000;
    const checkoutRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        cartItems: [
          {
            itemId: 4,
            barcode: "ITEM-004",
            metalType: "Gold",
            purityKarat: 22,
            grossWeightMg: 15000,
            netWeightMg: 15000,
            stoneWeightMg: 0,
            metalRatePaisePerGram: 600000,
            makingChargePaise: 0,
            wastageChargePaise: 0,
            gstPaise: 0,
            itemTotalPaise
          }
        ],
        urdItems: [],
        totals: { grossTotalPaise: itemTotalPaise, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: itemTotalPaise, gstPaise: 0 },
        payments: { cash: itemTotalPaise, upi: 0, card: 0, udhari: 0, gssCredit: 0 },
        paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
        invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
        kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
      });

    // 1. Sale succeeds despite Tally being out of the synchronous path.
    expect(checkoutRes.status).toBe(201);
    const invoiceId = checkoutRes.body.invoice_id;
    expect(invoiceId).toBeDefined();

    // 2. Server did not crash.
    const health = await request(app).get("/health");
    expect(health.status).toBe(200);

    // 3. Exactly one Tally sync task was queued for later processing (PENDING here;
    //    the worker would mark it FAILED only after exhausting retries).
    const tallyTasks = db.select().from(syncQueue).where(eq(syncQueue.task_type, "TALLY_VOUCHER")).all();
    expect(tallyTasks.length).toBe(1);
    expect(["PENDING", "FAILED"]).toContain(tallyTasks[0].status);

    // 4. The invoice was persisted regardless of sync state.
    const invoice = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
    expect(invoice).toBeDefined();
  });
});
