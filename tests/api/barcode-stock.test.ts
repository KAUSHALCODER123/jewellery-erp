import request from "supertest";
import { app } from "../../src/server.js";

describe("barcode creation and stock verification", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  it("creates auto-numbered barcode tags with jewellery weights", async () => {
    const previewRes = await request(app)
      .get("/api/inventory/barcode/next?prefix=RIN")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(previewRes.status).toBe(200);
    expect(previewRes.body.barcode).toBe("RIN0001");

    const createRes = await request(app)
      .post("/api/inventory/barcode/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        prefix: "RIN",
        quantity: 2,
        category: "Ring",
        metal_type: "Gold",
        purity_karat: 22,
        gross_weight_mg: 10500,
        stone_weight_mg: 500,
        black_bead_weight_mg: 200,
        making_charge_type: "PER_GRAM",
        making_charge_value: 30000,
        hallmark_charge_paise: 4500,
        location: "COUNTER"
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.items).toHaveLength(2);
    expect(createRes.body.items[0]).toMatchObject({
      barcode: "RIN0001",
      net_weight_g: "9.800",
      fine_weight_g: "8.983"
    });
    expect(createRes.body.items[1].barcode).toBe("RIN0002");

    const nextRes = await request(app)
      .get("/api/inventory/barcode/next?prefix=RIN")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(nextRes.status).toBe(200);
    expect(nextRes.body.barcode).toBe("RIN0003");
  });

  it("tracks found, missing, and unknown tags during stock verification", async () => {
    const createRes = await request(app)
      .post("/api/inventory/barcode/create")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        prefix: "CHK",
        quantity: 1,
        category: "Chain",
        metal_type: "Gold",
        purity_karat: 22,
        gross_weight_mg: 12000,
        stone_weight_mg: 0,
        black_bead_weight_mg: 0,
        making_charge_type: "FLAT",
        making_charge_value: 100000,
        hallmark_charge_paise: 0,
        location: "VAULT"
      });
    expect(createRes.status).toBe(201);

    const startRes = await request(app)
      .post("/api/inventory/stock-verification/start")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ location: "VAULT" });

    expect(startRes.status).toBe(201);
    const sessionId = startRes.body.session.id;

    const foundRes = await request(app)
      .post(`/api/inventory/stock-verification/${sessionId}/scan`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ barcode: "CHK0001" });

    expect(foundRes.status).toBe(201);
    expect(foundRes.body.scan.result).toBe("FOUND");

    const unknownRes = await request(app)
      .post(`/api/inventory/stock-verification/${sessionId}/scan`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ barcode: "NOTREAL" });

    expect(unknownRes.status).toBe(404);
    expect(unknownRes.body.scan.result).toBe("UNKNOWN");

    const summaryRes = await request(app)
      .get(`/api/inventory/stock-verification/${sessionId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(summaryRes.status).toBe(200);
    expect(summaryRes.body.counts.found).toBe(1);
    expect(summaryRes.body.counts.unknown).toBe(1);
    expect(summaryRes.body.counts.missing).toBeGreaterThan(0);
    expect(summaryRes.body.missing_items.some((item: { barcode: string }) => item.barcode === "CHK0001")).toBe(false);
  });
});
