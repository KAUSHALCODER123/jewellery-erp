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
});
