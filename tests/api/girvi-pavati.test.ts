import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { customers, ledgers, girviLoans, girviRepayments, girviCollateral, messageLogs } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";

describe("Girvi Pavati / Receipt & Media Capture API", () => {
  let adminToken: string;
  let customerId: number;
  let ledgerId: number;

  beforeEach(async () => {
    // 1. Log in as admin
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({
        username: "test_admin",
        password: "admin_pass"
      });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.token;

    // 2. Clear tables to ensure isolated run
    db.delete(messageLogs).run();
    db.delete(girviRepayments).run();
    db.delete(girviCollateral).run();
    db.delete(girviLoans).run();
    db.delete(customers).run();
    db.delete(ledgers).run();

    // 3. Seed a customer
    const customer = db.insert(customers).values({
      name: "Girvi Customer",
      phone: "9876543210",
      address: "123 Street",
      pan_number: "ABCDE1234F",
      aadhaar_number: "123456789012"
    }).returning().get();
    customerId = customer.id;

    // 4. Seed CASH ledger
    const ledger = db.insert(ledgers).values({
      account_name: "Cash In Hand",
      account_type: "CASH",
      balance_paise: 100000000 // 1,000,000 Rs
    }).returning().get();
    ledgerId = ledger.id;
  });

  test("POST /api/girvi/issue stores loan with fees, interest periods, and image paths", async () => {
    const payload = {
      customer_id: customerId,
      principal_amount_paise: 3000000, // 30,000 Rs (well within 45,000 Rs LTV)
      disbursement_ledger_id: ledgerId,
      loan_number: "L-2026-001",
      interest_rate_percentage: 2.0,
      interest_type: "SIMPLE",
      rate_period: "MONTHLY",
      interest_period_type: "WEEKLY", // Weekly interest period
      loan_letter_fee_paise: 5000, // 50 Rs letter fee
      notice_fee_paise: 10000, // 100 Rs notice fee
      customer_photo_path: "/api/images/cust_photo.jpg",
      thumbprint_path: "/api/images/thumb.png",
      issue_date: "2026-06-01",
      next_due_date: "2026-07-01",
      collateral: [
        {
          item_description: "Gold Ring",
          metal_type: "GOLD",
          purity_karat: 22,
          weight_mg: 10000, // 10g
          image_path: "/api/images/ring.png"
        }
      ]
    };

    const res = await request(app)
      .post("/api/girvi/issue")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("loan");
    expect(res.body.loan.interest_period_type).toBe("WEEKLY");
    expect(res.body.loan.loan_letter_fee_paise).toBe(5000);
    expect(res.body.loan.notice_fee_paise).toBe(10000);
    expect(res.body.loan.customer_photo_path).toBe("/api/images/cust_photo.jpg");
    expect(res.body.loan.thumbprint_path).toBe("/api/images/thumb.png");

    // Check DB
    const loanDb = db.query.girviLoans.findFirst({
      where: eq(girviLoans.id, res.body.loan.id)
    }).sync();
    expect(loanDb).toBeDefined();
    expect(loanDb?.interest_period_type).toBe("WEEKLY");
  });

  test("POST /api/girvi/repay/calculate processes weekly period rates and aggregates fees", async () => {
    // 1. Create a loan
    const loan = db.insert(girviLoans).values({
      customer_id: customerId,
      principal_amount_paise: 3000000, // 30,000 Rs
      loan_number: "L-2026-002",
      interest_rate_percentage: 2.0,
      interest_type: "SIMPLE",
      rate_period: "MONTHLY",
      interest_period_type: "WEEKLY", // 7-day period
      loan_letter_fee_paise: 5000,
      notice_fee_paise: 10000,
      issue_date: "2026-06-01",
      total_repaid_paise: 0,
      status: "ACTIVE"
    }).returning().get();

    // 2. Calculate outstanding interest after 14 days (2 periods)
    // For WEEKLY (periodDays = 7): principal = 3,000,000. rateBasisPoints = 200. elapsed = 14 days. periodDays = 7.
    // Interest = 3,000,000 * 200 * 14 / (10000 * 7) = 120,000 paise (1,200 Rs)

    const calcRes = await request(app)
      .post("/api/girvi/repay/calculate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        loan_id: loan.id,
        intended_repayment_date: "2026-06-15" // exactly 14 days later
      });

    expect(calcRes.status).toBe(200);
    expect(calcRes.body.breakdown.accrued_interest_paise).toBe(120000);
    expect(calcRes.body.breakdown.outstanding_fees_paise).toBe(15000); // 5000 + 10000
    expect(calcRes.body.breakdown.total_due_paise).toBe(3135000); // 30,000 + 1,200 + 150
  });

  test("POST /api/girvi/repay tracks principal/interest splits, discounts, notice/letter fee paid", async () => {
    // Loan 1: Repay notice & letter fees
    const loan1 = db.insert(girviLoans).values({
      customer_id: customerId,
      principal_amount_paise: 3000000,
      loan_number: "L-2026-003A",
      interest_rate_percentage: 2.0,
      interest_type: "SIMPLE",
      rate_period: "MONTHLY",
      interest_period_type: "WEEKLY",
      loan_letter_fee_paise: 5000,
      notice_fee_paise: 10000,
      issue_date: "2026-06-01",
      total_repaid_paise: 0,
      status: "ACTIVE"
    }).returning().get();

    const repayRes1 = await request(app)
      .post("/api/girvi/repay")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        loan_id: loan1.id,
        receipt_ledger_id: ledgerId,
        amount_paise: 15000,
        payment_date: "2026-06-15",
        discount_paise: 0,
        notice_fee_paid_paise: 10000,
        loan_letter_fee_paid_paise: 5000
      });

    expect(repayRes1.status).toBe(201);
    expect(repayRes1.body.repayment.notice_fee_paid_paise).toBe(10000);
    expect(repayRes1.body.repayment.loan_letter_fee_paid_paise).toBe(5000);
    expect(repayRes1.body.repayment.interest_allocated_paise).toBe(0);
    expect(repayRes1.body.repayment.principal_allocated_paise).toBe(0);

    // Loan 2: Repay interest and principal with a discount
    const loan2 = db.insert(girviLoans).values({
      customer_id: customerId,
      principal_amount_paise: 3000000,
      loan_number: "L-2026-003B",
      interest_rate_percentage: 2.0,
      interest_type: "SIMPLE",
      rate_period: "MONTHLY",
      interest_period_type: "WEEKLY",
      loan_letter_fee_paise: 0,
      notice_fee_paise: 0,
      issue_date: "2026-06-01",
      total_repaid_paise: 0,
      status: "ACTIVE"
    }).returning().get();

    // 14 days later: 120,000 paise interest. Pay 100,000 paise, discount 20,000 paise.
    // Max interest to pay = 120,000 - 20,000 = 100,000 paise.
    // Amount paid = 100,000 paise. All goes to interest.
    const repayRes2 = await request(app)
      .post("/api/girvi/repay")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        loan_id: loan2.id,
        receipt_ledger_id: ledgerId,
        amount_paise: 100000,
        payment_date: "2026-06-15",
        discount_paise: 20000,
        notice_fee_paid_paise: 0,
        loan_letter_fee_paid_paise: 0
      });

    expect(repayRes2.status).toBe(201);
    expect(repayRes2.body.repayment.interest_allocated_paise).toBe(100000);
    expect(repayRes2.body.repayment.discount_paise).toBe(20000);
  });

  test("GET /api/documents/girvi/:id/pavati serves A4 PDF pawn ticket", async () => {
    // 1. Create a loan
    const loan = db.insert(girviLoans).values({
      customer_id: customerId,
      principal_amount_paise: 100000,
      loan_number: "L-2026-004",
      interest_rate_percentage: 2.0,
      interest_type: "SIMPLE",
      rate_period: "MONTHLY",
      interest_period_type: "MONTHLY",
      issue_date: "2026-06-01",
      total_repaid_paise: 0,
      status: "ACTIVE"
    }).returning().get();

    // Seed collateral
    db.insert(girviCollateral).values({
      loan_id: loan.id,
      item_description: "Ring",
      metal_type: "GOLD",
      purity_karat: 22,
      weight_mg: 10000
    }).run();

    const pdfRes = await request(app)
      .get(`/api/documents/girvi/${loan.id}/pavati`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers["content-type"]).toBe("application/pdf");
    expect(pdfRes.headers["content-disposition"]).toContain("inline; filename=");
  });

  test("GET /api/documents/girvi/repayment/:id/receipt serves A5 PDF repayment receipt", async () => {
    // 1. Create a loan
    const loan = db.insert(girviLoans).values({
      customer_id: customerId,
      principal_amount_paise: 100000,
      loan_number: "L-2026-005",
      interest_rate_percentage: 2.0,
      interest_type: "SIMPLE",
      rate_period: "MONTHLY",
      interest_period_type: "MONTHLY",
      issue_date: "2026-06-01",
      total_repaid_paise: 0,
      status: "ACTIVE"
    }).returning().get();

    // 2. Repay
    const repayment = db.insert(girviRepayments).values({
      loan_id: loan.id,
      payment_date: "2026-06-02",
      amount_paise: 10000,
      interest_allocated_paise: 1000,
      principal_allocated_paise: 9000,
      discount_paise: 0,
      notice_fee_paid_paise: 0,
      loan_letter_fee_paid_paise: 0
    }).returning().get();

    const pdfRes = await request(app)
      .get(`/api/documents/girvi/repayment/${repayment.id}/receipt`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers["content-type"]).toBe("application/pdf");
    expect(pdfRes.headers["content-disposition"]).toContain("inline; filename=");
  });
});
