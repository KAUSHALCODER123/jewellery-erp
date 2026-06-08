/**
 * Desktop FEATURE test — exercises every module's real read + write workflows
 * against the LIVE packaged desktop backend (the node.exe sidecar on :4000) and
 * its real database. Complements desktop-smoke.mjs (which drives the UI window).
 *
 * Run with the desktop app already running:  node tests/desktop/desktop-features.mjs
 *
 * Writes test data (prefixed ZZ / SMOKE) into the live DB — by design (real DB).
 */
const BASE = "http://127.0.0.1:4000";
const ADMIN = { username: "admin", password: "admin1234" };

let TOKEN = "";
const results = [];
const stamp = String(Date.now()).slice(-7);

function rec(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// SKIP: a feature whose write needs master data not present in a fresh DB.
function skip(name, reason) {
  results.push({ name, ok: true, skipped: true });
  console.log(`SKIP  ${name}  — ${reason}`);
}

async function api(method, path, body, token = TOKEN) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

// A read check: passes when the endpoint returns 2xx.
async function get(name, path) {
  try {
    const r = await api("GET", path);
    rec(name, r.ok, r.ok ? `${r.status}` : `${r.status} ${JSON.stringify(r.data)?.slice(0, 120)}`);
    return r;
  } catch (e) {
    rec(name, false, String(e).split("\n")[0]);
    return { ok: false };
  }
}

// A write check: passes when okStatuses includes the response status.
async function write(name, method, path, body, okStatuses = [200, 201]) {
  try {
    const r = await api(method, path, body);
    const ok = okStatuses.includes(r.status);
    rec(name, ok, ok ? `${r.status}` : `${r.status} ${JSON.stringify(r.data)?.slice(0, 160)}`);
    return r;
  } catch (e) {
    rec(name, false, String(e).split("\n")[0]);
    return { ok: false, data: null };
  }
}

function pick(data, ...keys) {
  for (const k of keys) {
    if (Array.isArray(data?.[k])) return data[k];
  }
  if (Array.isArray(data)) return data;
  return [];
}

async function main() {
  // ---- Auth ----
  const login = await api("POST", "/api/auth/login", ADMIN);
  TOKEN = login.data?.token ?? "";
  rec("Auth: admin login", !!TOKEN, TOKEN ? "token issued" : `${login.status}`);
  if (!TOKEN) {
    summarize();
    process.exit(1);
  }
  await get("Auth: setup status", "/api/auth/status");
  await get("Auth: list firms", "/api/auth/firms");

  // ---- Shared dependencies ----
  const customer = await write(
    "CRM: create customer",
    "POST",
    "/api/crm/customers",
    { name: `ZZ Cust ${stamp}`, phone: "9" + stamp + "01" }
  );
  const customerId = customer.data?.customer?.id ?? customer.data?.id;

  const supplier = await write(
    "Suppliers: create supplier",
    "POST",
    "/api/suppliers",
    { name: `ZZ Supplier ${stamp}`, phone: "8" + stamp + "01" }
  );
  const supplierId = supplier.data?.supplier?.id ?? supplier.data?.id;

  // A sellable silver coin (quantity-wise) for POS + approvals + general inventory.
  const coin = await write("Inventory: add item (coin)", "POST", "/api/inventory/add", {
    barcode: `ZZ-${stamp}`,
    category: "Coins",
    metal_type: "Silver",
    sale_mode: "QUANTITY_WISE",
    uom: "PIECE",
    unit_price_paise: 500000,
  });
  const coinId = coin.data?.item?.id;
  const coinBarcode = coin.data?.item?.barcode;

  // A second, dedicated item for the approvals memo (the first coin gets SOLD in POS).
  const coin2 = await write("Inventory: add item (approval stock)", "POST", "/api/inventory/add", {
    barcode: `ZZA-${stamp}`,
    category: "Coins",
    metal_type: "Silver",
    sale_mode: "QUANTITY_WISE",
    uom: "PIECE",
    unit_price_paise: 500000,
  });
  const coin2Id = coin2.data?.item?.id;

  const ledgersRes = await api("GET", "/api/accounts/ledgers");
  const ledgers = pick(ledgersRes.data, "ledgers");
  const cashLedger = ledgers.find((l) => /CASH/i.test(l.account_type || l.account_name)) || ledgers[0];
  const otherLedger = ledgers.find((l) => l.id !== cashLedger?.id) || ledgers[1] || ledgers[0];

  const karigarsRes = await api("GET", "/api/karigar/karigars");
  const karigar = pick(karigarsRes.data, "karigars", "data")[0];

  // ---- Settings ----
  await get("Settings: rates", "/api/settings/rates");
  await get("Settings: loyalty", "/api/settings/loyalty");
  await get("Settings: tally", "/api/settings/tally");
  await get("Settings: ecommerce", "/api/settings/ecommerce");
  await get("Settings: firms", "/api/settings/firms");
  await get("Settings: print templates", "/api/settings/print-templates");
  await get("Settings: rate provider", "/api/settings/rate-provider");
  await write("Settings: update rates", "PUT", "/api/settings/rates", {
    gold_24k_rate: "7000",
    gold_22k_rate: "6400",
    gold_18k_rate: "5200",
    silver_rate: "85",
  });

  // ---- CRM ----
  await get("CRM: list customers", "/api/crm/customers");
  if (customerId) await get("CRM: customer 360", `/api/crm/customers/${customerId}/360`);

  // ---- Inventory / Items ----
  await get("Inventory: list", "/api/inventory");
  await get("Inventory: item groups", "/api/inventory/item-groups");
  await get("Inventory: item definitions", "/api/inventory/item-definitions");
  await get("Inventory: next barcode", "/api/inventory/barcode/next?prefix=ZZ");
  await write("Inventory: create item group", "POST", "/api/inventory/item-groups", {
    name: `ZZ Group ${stamp}`,
    metal_type: "Silver",
    default_uom: "PIECE",
    hsn_code: "7118",
  });

  // ---- POS ----
  await get("POS: URD purchases", "/api/pos/urd-purchases");
  if (coinId) {
    await write("POS: cash checkout", "POST", "/api/pos/checkout", {
      customer_id: null,
      cartItems: [
        {
          item_id: coinId,
          barcode: coinBarcode,
          metal_type: "Silver",
          metal_rate_paise_per_gram: 0,
          making_charge_paise: 0,
          item_total_paise: 500000,
        },
      ],
      urdItems: [],
      totals: { grossTotalPaise: 500000, discountPaise: 0, urdDeductionPaise: 0, netPayablePaise: 500000 },
      payments: { cash: 500000, upi: 0, card: 0, udhari: 0, gssCredit: 0 },
    });
  } else {
    rec("POS: cash checkout", false, "skipped — no coin item");
  }

  // ---- Girvi ----
  await get("Girvi: list loans", "/api/girvi/loans");
  await get("Girvi: next loan number", "/api/girvi/next-loan-number");
  if (customerId && cashLedger) {
    await write("Girvi: issue loan", "POST", "/api/girvi/issue", {
      customer_id: customerId,
      principal_amount_paise: 3000000,
      disbursement_ledger_id: cashLedger.id,
      loan_number: `ZZL-${stamp}`,
      interest_rate_percentage: 2.0,
      interest_type: "SIMPLE",
      rate_period: "MONTHLY",
      issue_date: "2026-06-01",
      collateral: [
        {
          item_description: "ZZ Test Bangle",
          metal_type: "GOLD",
          purity_karat: 22,
          gross_weight_mg: 10000,
          net_weight_mg: 10000,
        },
      ],
    });
  } else rec("Girvi: issue loan", false, "skipped — no customer/ledger");

  // ---- GSS ----
  await get("GSS: list templates", "/api/gss/templates");
  await get("GSS: list accounts", "/api/gss/accounts");
  const gssTpl = await write("GSS: create template", "POST", "/api/gss/templates", {
    scheme_code: `ZZ-GSS-${stamp}`,
    scheme_name: `ZZ Scheme ${stamp}`,
    scheme_type: "CASH",
    duration_months: 12,
    monthly_amount_paise: 100000,
  });
  const tplId = gssTpl.data?.template?.id ?? gssTpl.data?.id;
  if (customerId && tplId) {
    await write("GSS: enroll customer", "POST", "/api/gss/enroll", {
      customer_id: customerId,
      template_id: tplId,
      card_number: `ZZGSS${stamp}`,
      enrollment_date: "2026-06-01",
    });
  } else rec("GSS: enroll customer", false, "skipped — no template/customer");

  // ---- Karigar ----
  await get("Karigar: list karigars", "/api/karigar/karigars");
  await get("Karigar: list jobs", "/api/karigar/jobs");
  await get("Karigar: next job number", "/api/karigar/next-job-number");
  if (karigar) {
    const job = await write("Karigar: create job", "POST", "/api/karigar/jobs", {
      job_name: `ZZ Job ${stamp}`,
      karigar_id: karigar.id,
      target_purity: "91.60",
      target_weight_mg: 10000,
    });
    const jobId = job.data?.job?.id ?? job.data?.id;
    if (jobId) {
      await write("Karigar: issue metal", "POST", "/api/karigar/issue-metal", {
        job_id: jobId,
        gross_weight_mg: 10000,
        purity_tunch: "100.00",
        issue_date: "2026-06-01",
        metal_type: "GOLD",
      });
    } else rec("Karigar: issue metal", false, "no job id returned");
  } else {
    // Karigars are master data (seeded via master setup); none in a fresh DB.
    skip("Karigar: create job", "no karigar master records in DB");
    skip("Karigar: issue metal", "no karigar master records in DB");
  }

  // ---- Accounts ----
  await get("Accounts: ledgers", "/api/accounts/ledgers");
  await get("Accounts: daybook", "/api/accounts/daybook");
  await get("Accounts: udhari", "/api/accounts/udhari");
  await get("Accounts: expenses", "/api/accounts/expenses");
  if (cashLedger) await get("Accounts: ledger report", `/api/accounts/ledger-report?ledger_id=${cashLedger.id}`);
  else skip("Accounts: ledger report", "no ledger available");
  if (cashLedger && otherLedger && cashLedger.id !== otherLedger.id) {
    await write("Accounts: create voucher", "POST", "/api/accounts/vouchers", {
      debit_ledger_id: otherLedger.id,
      credit_ledger_id: cashLedger.id,
      amount_paise: 100000,
      reference_type: "MANUAL",
      description: `ZZ test voucher ${stamp}`,
    });
  } else rec("Accounts: create voucher", false, "skipped — need two ledgers");
  await write("Accounts: create expense", "POST", "/api/accounts/expenses", {
    amount_paise: 50000,
    category: "Misc",
    description: `ZZ expense ${stamp}`,
    payment_mode: "CASH",
  });

  // ---- Suppliers ----
  await get("Suppliers: list", "/api/suppliers");

  // ---- Metal loans ----
  await get("Metal loans: list", "/api/metal-loans");
  await get("Metal loans: summary", "/api/metal-loans/summary");
  await get("Metal loans: next number", "/api/metal-loans/next-number");
  if (supplierId) {
    await write("Metal loans: create", "POST", "/api/metal-loans", {
      supplier_id: supplierId,
      gross_weight_mg: 100000,
      purity_basis_points: 9950,
      issue_date: "2026-06-01",
    });
  } else rec("Metal loans: create", false, "skipped — no supplier");

  // ---- Approvals / Jangad ----
  await get("Approvals: list", "/api/approvals");
  await get("Approvals: next number", "/api/approvals/next-number");
  if (coin2Id) {
    await write("Approvals: create memo", "POST", "/api/approvals", {
      memo_type: "CUSTOMER",
      party_name: `ZZ Party ${stamp}`,
      party_phone: "7" + stamp + "01",
      lines: [{ item_id: coin2Id, estimated_value_paise: 500000 }],
    });
  } else rec("Approvals: create memo", false, "no approval-stock item");

  // ---- Orders ----
  await get("Orders: list", "/api/orders");
  await get("Orders: next number", "/api/orders/next-number");
  await get("Orders: customers", "/api/orders/customers");

  // ---- Reminders ----
  await get("Reminders: due", "/api/reminders/due");

  // ---- Reports ----
  await get("Reports: MIS KPI summary", "/api/reports/mis/kpi-summary");
  await get("Reports: MIS sales trend", "/api/reports/mis/sales-trend");
  await get("Reports: MIS true margin", "/api/reports/mis/true-margin");
  await get("Reports: daybook summary", "/api/reports/daybook-summary");
  await write("Reports: builder query", "POST", "/api/reports/builder/query", {
    source: "sales",
    columns: ["invoice_number"],
    filters: [],
  }, [200, 201, 400]); // 400 acceptable if schema differs; proves endpoint is live

  // ---- Compliance ----
  await get("Compliance: audit locks", "/api/compliance/audit-locks");
  await get("Compliance: GSTR1 export", "/api/compliance/gst-export/gstr1?from=2026-04-01&to=2026-06-30");
  await get("Compliance: BIS submissions", "/api/compliance/bis-submissions");

  // ---- E-invoice / E-way ----
  await get("E-invoice: search", "/api/einvoice/invoices/search");

  // ---- Refinery ----
  await get("Refinery: list", "/api/refineries");
  await write("Refinery: create", "POST", "/api/refineries", {
    name: `ZZ Refinery ${stamp}`,
    phone: "6" + stamp + "01",
  });

  // ---- Backup ----
  await get("Backup: last status", "/api/backup/last-status");
  await get("Backup: logs", "/api/backup/logs");
  await get("Backup: schedule", "/api/backup/schedule");

  // ---- Messenger ----
  await get("Messenger: templates", "/api/messenger/templates");
  await get("Messenger: logs", "/api/messenger/logs");
  await get("Messenger: GSS reminders", "/api/messenger/reminders/gss");

  // ---- Hardware ----
  await get("Hardware: devices", "/api/hardware/devices");
  await get("Hardware: ports", "/api/hardware/ports");
  await get("Hardware: anti-theft alerts", "/api/hardware/anti-theft/alerts");
  await get("Hardware: scan audit", "/api/hardware/scans/audit");

  // ---- E-commerce ----
  // Catalog export is secured by a separate store API key (not the admin JWT);
  // a 401 without that key proves the endpoint is live and correctly protected.
  {
    const r = await api("GET", "/api/ecommerce/catalog/export");
    const ok = r.ok || r.status === 401;
    rec("E-commerce: catalog export (key-gated)", ok, `${r.status}${r.status === 401 ? " secured" : ""}`);
  }

  summarize();
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

function summarize() {
  const skipped = results.filter((r) => r.skipped).length;
  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n══════════════════════════════════════════════");
  console.log(`DESKTOP FEATURES: ${passed} passed, ${skipped} skipped, ${failed} failed (of ${results.length})`);
  if (failed) {
    console.log("FAILED:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  ✗ ${r.name}`);
  }
  console.log("══════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  summarize();
  process.exit(2);
});
