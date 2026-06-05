import request from "supertest";
import { app } from "../../src/server.js";
import { db } from "../../src/db/client.js";
import { organizationSettings, ledgers, voucherHeaders, voucherLines } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { syncVoucherToTally } from "../../src/utils/tallySync.js";

describe("Tally Integration API and Sync Tests", () => {
  let adminToken: string;
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

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
  });

  test("GET /api/settings/tally and PUT /api/settings/tally", async () => {
    // GET defaults
    const getRes = await request(app)
      .get("/api/settings/tally")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.tally_sync_enabled).toBe(false);
    expect(getRes.body.tally_gateway_url).toBe("http://localhost:9000");

    // PUT updates
    const putRes = await request(app)
      .put("/api/settings/tally")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        tally_sync_enabled: true,
        tally_gateway_url: "http://127.0.0.1:9000",
        tally_company_name: "Shree Jewellers"
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.tally_sync_enabled).toBe(true);
    expect(putRes.body.tally_gateway_url).toBe("http://127.0.0.1:9000");
    expect(putRes.body.tally_company_name).toBe("Shree Jewellers");
  });

  test("syncVoucherToTally formats XML and sends XML payload", async () => {
    // Mock global fetch
    const fetchCalls: any[] = [];
    const mockFetch = async (url: any, options: any) => {
      fetchCalls.push([url, options]);
      return {
        ok: true,
        text: () => Promise.resolve("<RESPONSE>Created successfully</RESPONSE>")
      };
    };
    global.fetch = mockFetch as any;

    // Enable tally sync in DB
    const settings = db.query.organizationSettings.findFirst().sync();
    if (settings) {
      db.update(organizationSettings)
        .set({
          tally_sync_enabled: true,
          tally_gateway_url: "http://localhost:9000",
          tally_company_name: "Test Shop"
        })
        .where(eq(organizationSettings.id, settings.id))
        .run();
    }

    // Seed test ledger accounts
    const cashLedger = db.insert(ledgers).values({
      account_name: "Cash Account",
      account_type: "CASH",
      balance_paise: 500000
    }).returning().get();

    const salesLedger = db.insert(ledgers).values({
      account_name: "Sales Account",
      account_type: "SALES",
      balance_paise: 0
    }).returning().get();

    // Seed test voucher header
    const voucher = db.insert(voucherHeaders).values({
      voucher_number: "VCH-SALE-101",
      voucher_type: "Sales",
      reference_type: "INVOICE",
      reference_id: 99,
      narration: "Sold test jewelry",
      total_debit_paise: 15000,
      total_credit_paise: 15000,
      created_at: "2026-06-01"
    }).returning().get();

    // Seed test voucher lines
    db.insert(voucherLines).values([
      {
        voucher_id: voucher.id,
        ledger_id: cashLedger.id,
        transaction_type: "DEBIT",
        amount_paise: 15000,
        description: "Debit Cash"
      },
      {
        voucher_id: voucher.id,
        ledger_id: salesLedger.id,
        transaction_type: "CREDIT",
        amount_paise: 15000,
        description: "Credit Sales"
      }
    ]).run();

    // Trigger sync function
    await syncVoucherToTally(voucher.id);

    // Verify fetch was called with correct XML layout
    expect(fetchCalls.length).toBe(1);
    const [calledUrl, calledOptions] = fetchCalls[0];
    expect(calledUrl).toBe("http://localhost:9000");
    expect(calledOptions.method).toBe("POST");
    expect(calledOptions.headers["Content-Type"]).toBe("text/xml");

    const payload = calledOptions.body;
    expect(payload).toContain("<ENVELOPE>");
    expect(payload).toContain("<TALLYREQUEST>Import Data</TALLYREQUEST>");
    expect(payload).toContain("<SVCURRENTCOMPANY>Test Shop</SVCURRENTCOMPANY>");
    expect(payload).toContain("<VOUCHER VCHTYPE=\"Sales\" ACTION=\"Create\" OBJVIEW=\"Accounting Voucher View\">");
    expect(payload).toContain("<DATE>20260601</DATE>");
    expect(payload).toContain("<VOUCHERNUMBER>VCH-SALE-101</VOUCHERNUMBER>");
    expect(payload).toContain("<LEDGERNAME>Cash Account</LEDGERNAME>");
    expect(payload).toContain("<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>");
    expect(payload).toContain("<AMOUNT>-150.00</AMOUNT>"); // Debit is negative in Tally XML
    expect(payload).toContain("<LEDGERNAME>Sales Account</LEDGERNAME>");
    expect(payload).toContain("<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>");
    expect(payload).toContain("<AMOUNT>150.00</AMOUNT>"); // Credit is positive in Tally XML
  });
});
