import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items } from "../../src/db/schema.js";

// P6 — item catalog (group master) + quantity-wise (per-piece) items + UOM.
describe("Item catalog: groups + quantity-wise items", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  it("creates and lists item groups; rejects duplicates", async () => {
    const create = await request(app)
      .post("/api/inventory/item-groups")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Silver Coins", metal_type: "Silver", default_uom: "PIECE", hsn_code: "7118" });
    expect(create.status).toBe(201);
    expect(create.body.item_group.name).toBe("Silver Coins");
    expect(create.body.item_group.default_uom).toBe("PIECE");

    const list = await request(app)
      .get("/api/inventory/item-groups")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.item_groups.some((g: { name: string }) => g.name === "Silver Coins")).toBe(true);

    const dup = await request(app)
      .post("/api/inventory/item-groups")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Silver Coins" });
    expect(dup.status).toBe(409);
  });

  it("creates a quantity-wise per-piece item and sells it at unit price", async () => {
    const add = await request(app)
      .post("/api/inventory/add")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        barcode: "COIN-001",
        category: "Coins",
        metal_type: "Silver",
        sale_mode: "QUANTITY_WISE",
        uom: "PIECE",
        unit_price_paise: 500000
      });

    expect(add.status).toBe(201);
    expect(add.body.item.sale_mode).toBe("QUANTITY_WISE");
    expect(add.body.item.uom).toBe("PIECE");
    expect(add.body.item.unit_price_paise).toBe(500000);
    expect(add.body.item.status).toBe("IN_STOCK");
    const coin = add.body.item;

    const checkout = await request(app)
      .post("/api/pos/checkout")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        customer_id: null,
        cartItems: [
          { itemId: coin.id, barcode: coin.barcode, metalType: "Silver", metalRatePaisePerGram: 0, makingChargePaise: 0, gstPaise: 0, itemTotalPaise: 500000 }
        ],
        urdItems: [],
        totals: { grossTotalPaise: 500000, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: 500000, gstPaise: 0 },
        payments: { cash: 500000, upi: 0, card: 0, udhari: 0, gssCredit: 0 },
        paymentReferences: { cash: null, upi: null, card: null, cheque: null, dd: null, neft: null, bankName: null },
        invoice: { billPrefix: null, manualNumber: null, dueDate: null, salesmanName: "Test", gstNotRequired: false, placeOfSupplyStateCode: null, gstSupplyType: null },
        kyc: { panNumber: null, aadhaarNumber: null, documentImagePath: null }
      });

    expect(checkout.status).toBe(201);
    const sold = db.select().from(items).where(eq(items.id, coin.id)).get();
    expect(sold?.status).toBe("SOLD");
  });

  it("rejects a quantity-wise item without a unit price", async () => {
    const res = await request(app)
      .post("/api/inventory/add")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ barcode: "COIN-002", category: "Coins", metal_type: "Silver", sale_mode: "QUANTITY_WISE" });
    expect(res.status).toBe(400);
  });

  it("creates and lists reusable item templates (Item Master)", async () => {
    const create = await request(app)
      .post("/api/inventory/item-definitions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Gents Ring 22K",
        category: "Ring",
        metal_type: "Gold",
        purity_karat: 22,
        sale_mode: "WEIGHT_WISE",
        uom: "GRAM",
        making_charge_type: "PER_GRAM",
        making_charge_value: 35000,
        tag_prefix: "rin"
      });
    expect(create.status).toBe(201);
    expect(create.body.item_definition.name).toBe("Gents Ring 22K");
    expect(create.body.item_definition.tag_prefix).toBe("RIN");
    expect(create.body.item_definition.purity_karat).toBe(22);

    const list = await request(app)
      .get("/api/inventory/item-definitions?active=true")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.item_definitions.some((d: { name: string }) => d.name === "Gents Ring 22K")).toBe(true);
  });

  it("bulk-creates quantity-wise (per-piece) tags with unit price", async () => {
    const res = await request(app)
      .post("/api/inventory/barcode/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        prefix: "COIN",
        quantity: 3,
        category: "Coins",
        metal_type: "Silver",
        sale_mode: "QUANTITY_WISE",
        uom: "PIECE",
        unit_price_paise: 500000
      });

    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.items[0].sale_mode).toBe("QUANTITY_WISE");
    expect(res.body.items[0].uom).toBe("PIECE");
    expect(res.body.items[0].unit_price_paise).toBe(500000);
  });

  it("rejects quantity-wise bulk tags without a unit price", async () => {
    const res = await request(app)
      .post("/api/inventory/barcode/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ prefix: "COIN", quantity: 2, category: "Coins", metal_type: "Silver", sale_mode: "QUANTITY_WISE" });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate template name (409) and a nameless template (400)", async () => {
    const body = { name: "Bangle 22K", category: "Bangle", metal_type: "Gold" };
    expect((await request(app).post("/api/inventory/item-definitions").set("Authorization", `Bearer ${adminToken}`).send(body)).status).toBe(201);
    expect((await request(app).post("/api/inventory/item-definitions").set("Authorization", `Bearer ${adminToken}`).send(body)).status).toBe(409);
    expect((await request(app).post("/api/inventory/item-definitions").set("Authorization", `Bearer ${adminToken}`).send({ category: "Ring", metal_type: "Gold" })).status).toBe(400);
  });
});
