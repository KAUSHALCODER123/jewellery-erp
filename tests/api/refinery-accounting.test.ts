import request from "supertest";
import { eq } from "drizzle-orm";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { ledgers, voucherHeaders } from "../../src/db/schema.js";

// Regression coverage for the Test 12 (Refinery) defect G4: refining charges paid
// to a refinery must post to the shop ledger so they reach the Day Book / cash tally.
describe("refinery receipt posts refining charges to accounting", () => {
  let adminToken: string;

  beforeEach(async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(login.status).toBe(200);
    adminToken = login.body.token;
  });

  async function createRefinery(name: string) {
    const res = await request(app)
      .post("/api/refineries")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name });
    expect(res.status).toBe(201);
    return res.body.refinery.id as number;
  }

  it("posts DEBIT Refining Charges / CREDIT Cash for a cash refining charge", async () => {
    const refineryId = await createRefinery("Test Refinery A");

    const receipt = await request(app)
      .post("/api/refineries/receipts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ refinery_id: refineryId, fine_gold_received_mg: 0, charges_paise: 50000, payment_mode: "CASH", add_to_stock: false });
    expect(receipt.status).toBe(201);

    const refiningLedger = db.select().from(ledgers).where(eq(ledgers.account_name, "Refining Charges")).get();
    const cashLedger = db.select().from(ledgers).where(eq(ledgers.account_name, "Cash")).get();
    // EXPENSE is normal-debit (DEBIT increases); CASH is normal-debit (CREDIT decreases).
    expect(refiningLedger?.balance_paise).toBe(50000);
    expect(cashLedger?.balance_paise).toBe(-50000);

    const voucher = db.select().from(voucherHeaders).where(eq(voucherHeaders.reference_id, receipt.body.receipt.id)).get();
    expect(voucher?.voucher_type).toBe("REFINERY_CHARGE");
    expect(voucher?.total_debit_paise).toBe(50000);
    expect(voucher?.total_credit_paise).toBe(50000);
  });

  it("posts no charge voucher when there is no charge", async () => {
    const refineryId = await createRefinery("Test Refinery B");

    const receipt = await request(app)
      .post("/api/refineries/receipts")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ refinery_id: refineryId, fine_gold_received_mg: 1000, charges_paise: 0, payment_mode: "CASH", add_to_stock: false });
    expect(receipt.status).toBe(201);

    const voucher = db.select().from(voucherHeaders).where(eq(voucherHeaders.reference_id, receipt.body.receipt.id)).get();
    expect(voucher).toBeUndefined();
  });
});
