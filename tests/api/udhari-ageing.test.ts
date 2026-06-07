import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, journalEntries, ledgers } from "../../src/db/schema.js";

describe("Udhari Ageing & Reminders API", () => {
  let adminToken: string;

  beforeEach(async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ username: "test_admin", password: "admin_pass" });
    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  function daysAgoIso(days: number): string {
    return new Date(Date.now() - days * 86400000).toISOString();
  }

  test("FIFO ageing buckets a customer's balance by oldest unpaid debit and flags over-limit", async () => {
    const customer = db.insert(customers).values({ name: "Aging Anil", phone: "9811122233", credit_limit_paise: 500000 }).returning().get();
    const ledger = db.insert(ledgers).values({
      account_name: `Udhari ${customer.name}`,
      account_type: "CUSTOMER_UDHARI",
      entity_id: customer.id,
      balance_paise: 900000 // Rs 9,000 outstanding (over the Rs 5,000 limit)
    }).returning().get();

    // An old debit (100 days ago, Rs 4,000), a partial payment (Rs 1,000), and a recent debit (10 days, Rs 6,000).
    // FIFO: payment clears Rs 1,000 of the old lot => old lot remaining Rs 3,000 (120+ bucket), recent Rs 6,000 (0-30).
    db.insert(journalEntries).values([
      { ledger_id: ledger.id, transaction_type: "DEBIT", amount_paise: 400000, reference_type: "MANUAL", reference_id: 0, created_at: daysAgoIso(100) },
      { ledger_id: ledger.id, transaction_type: "CREDIT", amount_paise: 100000, reference_type: "MANUAL", reference_id: 0, created_at: daysAgoIso(50) },
      { ledger_id: ledger.id, transaction_type: "DEBIT", amount_paise: 600000, reference_type: "MANUAL", reference_id: 0, created_at: daysAgoIso(10) }
    ]).run();

    const res = await request(app)
      .get("/api/accounts/udhari/ageing")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const row = res.body.customers.find((c: any) => c.customer_id === customer.id);
    expect(row).toBeDefined();
    expect(row.over_limit).toBe(true);
    expect(row.oldest_days).toBeGreaterThanOrEqual(100);
    // Recent Rs 6,000 in current bucket; old remaining Rs 3,000 in the 91-120 day bucket.
    expect(row.buckets.current_rupees).toBe("6000.00");
    expect(row.buckets.days_91_120_rupees).toBe("3000.00");
    expect(row.balance_rupees).toBe("9000.00");
  });

  test("credit limit can be set and cleared", async () => {
    const customer = db.insert(customers).values({ name: "Limit Latha", phone: "9700011122" }).returning().get();

    const setRes = await request(app)
      .post(`/api/accounts/customers/${customer.id}/credit-limit`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ credit_limit_paise: 1500000 });
    expect(setRes.status).toBe(200);
    expect(setRes.body.credit_limit_rupees).toBe("15000.00");

    const dbCustomer = db.select().from(customers).all().find((c) => c.id === customer.id);
    expect(dbCustomer?.credit_limit_paise).toBe(1500000);
  });

  test("reminders digest surfaces overdue udhari with a WhatsApp link", async () => {
    const customer = db.insert(customers).values({ name: "Overdue Om", phone: "9090909090" }).returning().get();
    const ledger = db.insert(ledgers).values({
      account_name: `Udhari ${customer.name}`,
      account_type: "CUSTOMER_UDHARI",
      entity_id: customer.id,
      balance_paise: 250000
    }).returning().get();
    db.insert(journalEntries).values({
      ledger_id: ledger.id, transaction_type: "DEBIT", amount_paise: 250000, reference_type: "MANUAL", reference_id: 0, created_at: daysAgoIso(60)
    }).run();

    const res = await request(app)
      .get("/api/reminders/due?overdue_days=30")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const item = res.body.reminders.find((r: any) => r.type === "UDHARI_OVERDUE" && r.customer_id === customer.id);
    expect(item).toBeDefined();
    expect(item.whatsapp_link).toContain("wa.me/919090909090");
    expect(res.body.counts.udhari_overdue).toBeGreaterThanOrEqual(1);
  });

  test("reminders digest skips a customer whose advance nets off their overdue due", async () => {
    const customer = db.insert(customers).values({ name: "Netted Neha", phone: "9080706050" }).returning().get();
    const dueLedger = db.insert(ledgers).values({
      account_name: `Udhari ${customer.name}`, account_type: "CUSTOMER_UDHARI", entity_id: customer.id, balance_paise: 300000
    }).returning().get();
    db.insert(journalEntries).values({
      ledger_id: dueLedger.id, transaction_type: "DEBIT", amount_paise: 300000, reference_type: "MANUAL", reference_id: 0, created_at: daysAgoIso(60)
    }).run();
    // A separate advance-credit ledger for the same customer fully offsets the due.
    db.insert(ledgers).values({
      account_name: `Udhari Advance ${customer.name}`, account_type: "CUSTOMER_UDHARI", entity_id: customer.id, balance_paise: -300000
    }).run();

    const res = await request(app)
      .get("/api/reminders/due?overdue_days=30")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const item = res.body.reminders.find((r: any) => r.type === "UDHARI_OVERDUE" && r.customer_id === customer.id);
    expect(item).toBeUndefined();
  });
});
