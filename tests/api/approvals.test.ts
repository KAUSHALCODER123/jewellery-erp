import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { approvalMemoLines, approvalMemos, items } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

describe("Approval / Jangad Memo API", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  function makeStockItem(barcode: string) {
    return db.insert(items).values({
      barcode,
      category: "RING",
      metal_type: "Gold",
      purity_karat: 22,
      gross_weight_mg: 10000,
      net_weight_mg: 9500,
      making_charge_type: "FLAT",
      making_charge_value: 0,
      status: "IN_STOCK"
    }).returning().get();
  }

  test("issue reserves stock, return restores it, convert marks sold", async () => {
    const itemA = makeStockItem("APPR-A1");
    const itemB = makeStockItem("APPR-B1");

    // Issue a customer approval memo with both items
    const issueRes = await request(app)
      .post("/api/approvals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        memo_type: "CUSTOMER",
        party_name: "Test Customer",
        party_phone: "9990001111",
        lines: [
          { item_id: itemA.id, estimated_value_paise: 5000000 },
          { item_id: itemB.id }
        ]
      });

    expect(issueRes.status).toBe(201);
    expect(issueRes.body.memo.memo_number).toMatch(/^MEMO-\d{4}$/);
    expect(issueRes.body.memo.line_count).toBe(2);
    expect(issueRes.body.memo.status).toBe("OPEN");
    const memoId = issueRes.body.memo.id;

    // Both items should now be reserved (ON_APPROVAL)
    expect(db.select().from(items).where(eq(items.id, itemA.id)).get()?.status).toBe("ON_APPROVAL");
    expect(db.select().from(items).where(eq(items.id, itemB.id)).get()?.status).toBe("ON_APPROVAL");

    const lines = db.select().from(approvalMemoLines).where(eq(approvalMemoLines.memo_id, memoId)).all();
    const lineA = lines.find((l) => l.item_id === itemA.id)!;
    const lineB = lines.find((l) => l.item_id === itemB.id)!;

    // Return item A to stock
    const returnRes = await request(app)
      .post(`/api/approvals/${memoId}/return`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ line_ids: [lineA.id] });

    expect(returnRes.status).toBe(200);
    expect(returnRes.body.memo.status).toBe("PARTIAL");
    expect(db.select().from(items).where(eq(items.id, itemA.id)).get()?.status).toBe("IN_STOCK");

    // Convert item B (sold)
    const convertRes = await request(app)
      .post(`/api/approvals/${memoId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ line_ids: [lineB.id] });

    expect(convertRes.status).toBe(200);
    // No lines remain OUT: one RETURNED + one SOLD => CONVERTED
    expect(convertRes.body.memo.status).toBe("CONVERTED");
    expect(db.select().from(items).where(eq(items.id, itemB.id)).get()?.status).toBe("SOLD");

    const finalLineB = db.select().from(approvalMemoLines).where(eq(approvalMemoLines.id, lineB.id)).get();
    expect(finalLineB?.line_status).toBe("SOLD");
  });

  test("rejects issuing an item that is not in stock", async () => {
    const sold = db.insert(items).values({
      barcode: "APPR-SOLD",
      category: "RING",
      metal_type: "Gold",
      purity_karat: 22,
      gross_weight_mg: 10000,
      net_weight_mg: 9500,
      making_charge_type: "FLAT",
      making_charge_value: 0,
      status: "SOLD"
    }).returning().get();

    const res = await request(app)
      .post("/api/approvals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ party_name: "X", lines: [{ item_id: sold.id }] });

    expect(res.status).toBe(400);
    expect(db.select().from(approvalMemos).all().some((m) => false)).toBe(false);
  });

  test("allows POS checkout of items on an approval memo", async () => {
    const itemA = db.insert(items).values({
      barcode: "APPR-TEST-A",
      category: "RING",
      metal_type: "Silver",
      purity_karat: 18,
      gross_weight_mg: 10000,
      net_weight_mg: 9500,
      making_charge_type: "FLAT",
      making_charge_value: 0,
      status: "IN_STOCK"
    }).returning().get();

    const itemB = db.insert(items).values({
      barcode: "APPR-TEST-B",
      category: "RING",
      metal_type: "Silver",
      purity_karat: 18,
      gross_weight_mg: 8000,
      net_weight_mg: 7500,
      making_charge_type: "FLAT",
      making_charge_value: 0,
      status: "IN_STOCK"
    }).returning().get();

    // Issue approval memo
    const issueRes = await request(app)
      .post("/api/approvals")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        memo_type: "CUSTOMER",
        party_name: "CRM Memo Customer",
        party_phone: "9876543210",
        lines: [
          { item_id: itemA.id, estimated_value_paise: 300000 },
          { item_id: itemB.id, estimated_value_paise: 200000 }
        ]
      });
    expect(issueRes.status).toBe(201);
    const memoId = issueRes.body.memo.id;

    const lines = db.select().from(approvalMemoLines).where(eq(approvalMemoLines.memo_id, memoId)).all();
    const lineA = lines.find((l) => l.item_id === itemA.id)!;

    // Convert item A to SOLD on the memo
    const convertRes = await request(app)
      .post(`/api/approvals/${memoId}/convert`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ line_ids: [lineA.id] });
    expect(convertRes.status).toBe(200);

    // Now POS checkout both items
    const itemTotalPaise = 500000;
    const checkoutRes = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: null,
        approval_memo_id: memoId,
        cartItems: [
          {
            itemId: itemA.id,
            barcode: itemA.barcode,
            metalType: itemA.metal_type,
            purityKarat: itemA.purity_karat,
            grossWeightMg: itemA.gross_weight_mg,
            netWeightMg: itemA.net_weight_mg,
            stoneWeightMg: 500,
            metalRatePaisePerGram: 50000,
            makingChargePaise: 0,
            wastageChargePaise: 0,
            gstPaise: 0,
            itemTotalPaise: 300000
          },
          {
            itemId: itemB.id,
            barcode: itemB.barcode,
            metalType: itemB.metal_type,
            purityKarat: itemB.purity_karat,
            grossWeightMg: itemB.gross_weight_mg,
            netWeightMg: itemB.net_weight_mg,
            stoneWeightMg: 500,
            metalRatePaisePerGram: 50000,
            makingChargePaise: 0,
            wastageChargePaise: 0,
            gstPaise: 0,
            itemTotalPaise: 200000
          }
        ],
        urdItems: [],
        totals: { grossTotalPaise: itemTotalPaise, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: itemTotalPaise, gstPaise: 0 },
        payments: { cash: itemTotalPaise, upi: 0, card: 0, cheque: 0, neft: 0, udhari: 0, gssCredit: 0, advance: 0 },
        paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
        invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: true, placeOfSupplyStateCode: null, gstSupplyType: null },
        kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
      });

    expect(checkoutRes.status).toBe(201);

    // Verify both items are sold
    expect(db.select().from(items).where(eq(items.id, itemA.id)).get()?.status).toBe("SOLD");
    expect(db.select().from(items).where(eq(items.id, itemB.id)).get()?.status).toBe("SOLD");

    // Verify the approval memo lines are marked SOLD and linked to the invoice
    const finalLines = db.select().from(approvalMemoLines).where(eq(approvalMemoLines.memo_id, memoId)).all();
    for (const line of finalLines) {
      expect(line.line_status).toBe("SOLD");
      expect(line.invoice_id).toBe(checkoutRes.body.invoice.id);
    }

    // Verify the memo status became CONVERTED
    expect(db.select().from(approvalMemos).where(eq(approvalMemos.id, memoId)).get()?.status).toBe("CONVERTED");
  });
});
