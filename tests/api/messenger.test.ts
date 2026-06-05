import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import {
  messageTemplates,
  messageLogs,
  customers,
  girviLoans,
  gssAccounts,
  gssTemplates,
  organizationSettings
} from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

describe("Messenger & CRM Automation API", () => {
  let adminToken: string;
  let customerId: number;

  beforeAll(async () => {
    // Log in as admin
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        username: "test_admin",
        password: "admin_pass"
      });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;
  });

  beforeEach(async () => {
    // Clear logs, templates, and relations to ensure isolated runs
    db.delete(messageLogs).run();
    db.delete(messageTemplates).run();
    db.delete(girviLoans).run();
    db.delete(gssAccounts).run();
    db.delete(gssTemplates).run();
    db.delete(customers).run();
    db.delete(organizationSettings).run();

    // Seed organization settings
    db.insert(organizationSettings).values({
      shop_name: "Test Gold Palace",
      address: "123 Main St",
      contact_number: "9876543210"
    }).run();

    // Seed a test customer
    const customer = db.insert(customers).values({
      name: "John Doe",
      phone: "9998887776",
      address: "456 Side St",
      birthday_date: new Date().toISOString().slice(0, 10), // Birthday is today
      anniversary_date: "1995-10-10"
    }).returning().get();
    customerId = customer.id;
  });

  test("GET /api/messenger/templates lists templates and ensures defaults are seeded", async () => {
    const res = await request(app)
      .get("/api/messenger/templates")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.templates.length).toBeGreaterThan(0);

    const invoiceTemplate = res.body.templates.find((t: any) => t.name === "POS_INVOICE_CREATED");
    expect(invoiceTemplate).toBeDefined();
    expect(invoiceTemplate.channel).toBe("WHATSAPP");
  });

  test("PUT /api/messenger/templates/:id updates the content of a template", async () => {
    // List to trigger seeding
    const listRes = await request(app)
      .get("/api/messenger/templates")
      .set("Authorization", `Bearer ${adminToken}`);

    const targetTemplate = listRes.body.templates[0];

    const updateRes = await request(app)
      .put(`/api/messenger/templates/${targetTemplate.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        content: "New template text with {{customer_name}}.",
        channel: "SMS",
        is_active: 0
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.template.content).toBe("New template text with {{customer_name}}.");
    expect(updateRes.body.template.channel).toBe("SMS");
    expect(updateRes.body.template.is_active).toBe(0);
  });

  test("GET /api/messenger/logs retrieves message logs", async () => {
    // Add a log
    db.insert(messageLogs).values({
      customer_id: customerId,
      template_name: "MANUAL",
      recipient: "9998887776",
      message_body: "Test manual message",
      channel: "WHATSAPP",
      status: "SENT"
    }).run();

    const res = await request(app)
      .get("/api/messenger/logs")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBe(1);
    expect(res.body.logs[0].message_body).toBe("Test manual message");
    expect(res.body.logs[0].status).toBe("SENT");
  });

  test("POST /api/messenger/send-manual queues a custom log entry and builds whatsapp link", async () => {
    const res = await request(app)
      .post("/api/messenger/send-manual")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        recipient: "9998887776",
        message_body: "Hello manual test",
        channel: "WHATSAPP",
        customer_id: customerId
      });

    expect(res.status).toBe(201);
    expect(res.body.log.status).toBe("SENT");
    expect(res.body.log.message_body).toBe("Hello manual test");
    expect(res.body.whatsapp_link).toContain("https://wa.me/919998887776");
  });

  test("GET /api/messenger/reminders/girvi identifies active loans and formats placeholders", async () => {
    // 1. Create active loan
    db.insert(girviLoans).values({
      customer_id: customerId,
      loan_number: "L-MESSENGER-001",
      principal_amount_paise: 5000000,
      interest_rate_percentage: 2,
      interest_type: "SIMPLE",
      rate_period: "MONTHLY",
      issue_date: "2026-06-01",
      next_due_date: "2026-07-01",
      status: "ACTIVE",
      total_repaid_paise: 0
    }).run();

    const res = await request(app)
      .get("/api/messenger/reminders/girvi")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.reminders.length).toBe(1);
    expect(res.body.reminders[0].loan_number).toBe("L-MESSENGER-001");
    expect(res.body.reminders[0].message_preview).toContain("John Doe");
    expect(res.body.reminders[0].message_preview).toContain("L-MESSENGER-001");
    expect(res.body.reminders[0].message_preview).toContain("50000"); // 50,000 Rs
  });

  test("GET /api/messenger/reminders/gss scans active gold saving schemes", async () => {
    // 1. Create a GSS template
    const template = db.insert(gssTemplates).values({
      scheme_code: "SCH-1",
      scheme_name: "Saving Plan 1",
      duration_months: 11,
      monthly_amount_paise: 200000, // 2000 Rs
      bonus_rule_type: "FIXED_AMOUNT",
      bonus_value_paise: 200000,
      is_active: true
    }).returning().get();

    // 2. Create active GSS account
    db.insert(gssAccounts).values({
      customer_id: customerId,
      template_id: template.id,
      card_number: "CARD-MESSENGER-001",
      enrollment_date: "2026-06-01",
      maturity_date: "2027-05-01",
      status: "ACTIVE",
      total_paid_paise: 200000,
      installments_paid_count: 1
    }).run();

    const res = await request(app)
      .get("/api/messenger/reminders/gss")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.reminders.length).toBe(1);
    expect(res.body.reminders[0].card_number).toBe("CARD-MESSENGER-001");
    expect(res.body.reminders[0].message_preview).toContain("John Doe");
    expect(res.body.reminders[0].message_preview).toContain("2000.00");
  });

  test("GET /api/messenger/reminders/wishes scans celebrating birthdays/anniversaries today", async () => {
    const res = await request(app)
      .get("/api/messenger/reminders/wishes")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.reminders.length).toBe(1);
    expect(res.body.reminders[0].customer_name).toBe("John Doe");
    expect(res.body.reminders[0].message_preview).toContain("John Doe");
    expect(res.body.reminders[0].message_preview).toContain("Test Gold Palace");
  });
});
