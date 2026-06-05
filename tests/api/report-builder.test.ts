import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import {
  invoices,
  items,
  girviLoans,
  gssAccounts,
  gssTemplates,
  journalEntries,
  ledgers,
  customers
} from "../../src/db/schema.js";

describe("Custom Report Builder API", () => {
  let adminToken: string;
  let customerId: number;
  let cashLedgerId: number;

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

  beforeEach(() => {
    // Clear data tables
    db.delete(invoices).run();
    db.delete(items).run();
    db.delete(girviLoans).run();
    db.delete(gssAccounts).run();
    db.delete(gssTemplates).run();
    db.delete(journalEntries).run();
    db.delete(ledgers).run();
    db.delete(customers).run();

    // Create a customer
    const customer = db.insert(customers).values({
      name: "Alice Reporter",
      phone: "8887776665",
      address: "789 Report Lane"
    }).returning().get();
    customerId = customer.id;

    // Create cash ledger
    const ledger = db.insert(ledgers).values({
      account_name: "Cash Vault",
      account_type: "CASH",
      balance_paise: 500000
    }).returning().get();
    cashLedgerId = ledger.id;
  });

  test("POST /api/reports/builder/query runs queries for invoices with date/type filters", async () => {
    // Seed invoices
    db.insert(invoices).values({
      invoice_number: "INV-R-001",
      customer_id: customerId,
      total_amount_paise: 150000,
      payment_mode: "CASH",
      invoice_type: "SALE",
      created_at: "2026-06-01 10:00:00"
    }).run();

    db.insert(invoices).values({
      invoice_number: "INV-R-002",
      customer_id: customerId,
      total_amount_paise: 250000,
      payment_mode: "CARD",
      invoice_type: "SALE",
      created_at: "2026-06-03 10:00:00"
    }).run();

    const res = await request(app)
      .post("/api/reports/builder/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        dataSource: "invoices",
        columns: ["invoice_number", "total_amount_paise", "payment_mode", "customer_name"],
        filters: {
          startDate: "2026-06-02",
          endDate: "2026-06-04",
          status: "SALE"
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(1);
    expect(res.body.rows[0].invoice_number).toBe("INV-R-002");
    expect(res.body.rows[0].customer_name).toBe("Alice Reporter");
    expect(res.body.summary.totalCount).toBe(1);
    expect(res.body.summary.sumAmountPaise).toBe(250000);
  });

  test("POST /api/reports/builder/query aggregates and groups invoices by payment mode", async () => {
    db.insert(invoices).values({
      invoice_number: "INV-G-01",
      customer_id: customerId,
      total_amount_paise: 10000,
      payment_mode: "CASH",
      invoice_type: "SALE"
    }).run();

    db.insert(invoices).values({
      invoice_number: "INV-G-02",
      customer_id: customerId,
      total_amount_paise: 20000,
      payment_mode: "CASH",
      invoice_type: "SALE"
    }).run();

    db.insert(invoices).values({
      invoice_number: "INV-G-03",
      customer_id: customerId,
      total_amount_paise: 50000,
      payment_mode: "UPI",
      invoice_type: "SALE"
    }).run();

    const res = await request(app)
      .post("/api/reports/builder/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        dataSource: "invoices",
        groupBy: "payment_mode",
        aggregate: {
          field: "total_amount_paise",
          type: "SUM"
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(2);

    const cashGroup = res.body.rows.find((r: any) => r.group_value === "CASH");
    const upiGroup = res.body.rows.find((r: any) => r.group_value === "UPI");

    expect(cashGroup.count).toBe(2);
    expect(cashGroup.total_amount_paise).toBe(30000);

    expect(upiGroup.count).toBe(1);
    expect(upiGroup.total_amount_paise).toBe(50000);
  });

  test("POST /api/reports/builder/query filters items/inventory with metal_type and category", async () => {
    db.insert(items).values({
      barcode: "B-GOLD-R",
      name: "Gold Ring Special",
      metal_type: "Gold",
      category: "Ring",
      purity_karat: 22,
      gross_weight_mg: 8000,
      net_weight_mg: 7800,
      making_charge_type: "FLAT",
      making_charge_value: 1000,
      status: "IN_STOCK"
    }).run();

    db.insert(items).values({
      barcode: "B-SILVER-C",
      name: "Silver Chain Simple",
      metal_type: "Silver",
      category: "Chain",
      purity_karat: 18,
      gross_weight_mg: 15000,
      net_weight_mg: 14800,
      making_charge_type: "FLAT",
      making_charge_value: 1000,
      status: "IN_STOCK"
    }).run();

    const res = await request(app)
      .post("/api/reports/builder/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        dataSource: "items",
        filters: {
          metalType: "Gold",
          category: "Ring"
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(1);
    expect(res.body.rows[0].barcode).toBe("B-GOLD-R");
    expect(res.body.summary.sumWeightMg).toBe(8000);
  });

  test("POST /api/reports/builder/query scans and filters Girvi loans", async () => {
    db.insert(girviLoans).values({
      customer_id: customerId,
      loan_number: "G-REP-01",
      principal_amount_paise: 600000,
      interest_rate_percentage: 1.5,
      interest_type: "SIMPLE",
      rate_period: "MONTHLY",
      issue_date: "2026-06-01",
      status: "ACTIVE",
      total_repaid_paise: 0
    }).run();

    db.insert(girviLoans).values({
      customer_id: customerId,
      loan_number: "G-REP-02",
      principal_amount_paise: 800000,
      interest_rate_percentage: 1.5,
      interest_type: "SIMPLE",
      rate_period: "MONTHLY",
      issue_date: "2026-06-02",
      status: "SETTLED",
      total_repaid_paise: 800000
    }).run();

    const res = await request(app)
      .post("/api/reports/builder/query")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        dataSource: "girvi_loans",
        filters: {
          status: "ACTIVE"
        }
      });

    expect(res.status).toBe(200);
    expect(res.body.rows.length).toBe(1);
    expect(res.body.rows[0].loan_number).toBe("G-REP-01");
    expect(res.body.summary.sumPrincipalPaise).toBe(600000);
  });
});
