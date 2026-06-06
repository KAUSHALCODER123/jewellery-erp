import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { items } from "../../src/db/schema.js";

// Verifies gemstone/certificate persistence on an item (POST then GET round-trip)
// and that the parent item's stone/net weights are recalculated (1 carat = 200 mg).
describe("Item stones: attach, persist, recalc weight, certificate lookup", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  async function createItem(barcode: string) {
    const add = await request(app)
      .post("/api/inventory/add")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        barcode,
        category: "Ring",
        metal_type: "Gold",
        purity_karat: 22,
        gross_weight_mg: 10000,
        net_weight_mg: 10000,
        making_charge_type: "PER_GRAM",
        making_charge_value: 12000
      });
    expect(add.status).toBe(201);
    return add.body.item;
  }

  it("persists an attached stone and recalculates parent net weight", async () => {
    const item = await createItem("STONE-TEST-1");

    const save = await request(app)
      .post(`/api/inventory/items/${item.id}/stones`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        stones: [
          {
            stone_type: "DIAMOND",
            shape: "ROUND",
            carat_weight: 1,
            color_grade: "F",
            clarity_grade: "VS1",
            cut_grade: "EX",
            certificate_number: "CERT-TEST-1",
            certificate_lab: "GIA",
            stone_rate_paise: 0
          }
        ]
      });
    expect(save.status).toBe(200);
    expect(save.body.stone_weight_mg).toBe(200); // 1 ct = 200 mg

    // Round-trip: the stone must come back on GET (this is the regression the manual test flagged).
    const list = await request(app)
      .get(`/api/inventory/items/${item.id}/stones`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.stones).toHaveLength(1);
    expect(list.body.stones[0].certificate_number).toBe("CERT-TEST-1");
    expect(list.body.stones[0].carat_weight).toBe(1);

    // Parent item weights recalculated and persisted.
    const persisted = db.select().from(items).where(eq(items.id, item.id)).get();
    expect(persisted?.stone_weight_mg).toBe(200);
    expect(persisted?.net_weight_mg).toBe(9800); // 10000 gross - 200 stone
  });

  it("replaces stones on re-save (does not accumulate duplicates)", async () => {
    const item = await createItem("STONE-TEST-2");
    const payload = (cert: string) => ({
      stones: [{ stone_type: "RUBY", carat_weight: 0.5, certificate_number: cert, certificate_lab: "IGI", stone_rate_paise: 100000 }]
    });

    await request(app).post(`/api/inventory/items/${item.id}/stones`).set("Authorization", `Bearer ${adminToken}`).send(payload("CERT-A"));
    await request(app).post(`/api/inventory/items/${item.id}/stones`).set("Authorization", `Bearer ${adminToken}`).send(payload("CERT-B"));

    const list = await request(app)
      .get(`/api/inventory/items/${item.id}/stones`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.stones).toHaveLength(1);
    expect(list.body.stones[0].certificate_number).toBe("CERT-B");
  });

  it("rejects total stone weight exceeding the item's gross weight", async () => {
    const item = await createItem("STONE-TEST-3");
    const save = await request(app)
      .post(`/api/inventory/items/${item.id}/stones`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stones: [{ stone_type: "DIAMOND", carat_weight: 100, certificate_lab: "NONE", stone_rate_paise: 0 }] });
    expect(save.status).toBe(400); // 100 ct = 20000 mg > 10000 mg gross
  });

  it("finds an item by its stone certificate number", async () => {
    const item = await createItem("STONE-TEST-4");
    await request(app)
      .post(`/api/inventory/items/${item.id}/stones`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stones: [{ stone_type: "EMERALD", carat_weight: 2, certificate_number: "CERT-LOOKUP-9", certificate_lab: "HRD", stone_rate_paise: 0 }] });

    const lookup = await request(app)
      .get(`/api/inventory/stones/certificates?certificate_number=cert-lookup-9`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.results).toHaveLength(1);
    expect(lookup.body.results[0].item.id).toBe(item.id);
  });
});
