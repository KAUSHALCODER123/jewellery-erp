/**
 * Desktop-app smoke test — drives the REAL Tauri/WebView2 window over CDP.
 *
 * Prereq: launch the installed app with remote debugging enabled, e.g.
 *   $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
 *   Start-Process "$env:LOCALAPPDATA\jewelry-erp\app.exe"
 *
 * Then: node tests/desktop/desktop-smoke.mjs
 *
 * It attaches to the running window (does NOT launch its own browser), runs the
 * real login flow, visits every module route, performs one real write (create a
 * customer), logs out, and reports PASS/FAIL per check. Runs against the live
 * desktop database as-is.
 */
import pw from "@playwright/test";
const { chromium } = pw;

const CDP = "http://127.0.0.1:9222";
const BASE = "http://tauri.localhost";
const ADMIN_USER = "admin";
const ADMIN_PASS = "admin1234";

const results = [];
function rec(name, ok, detail = "") {
  results.push({ name, ok });
  const tag = ok ? "PASS" : "FAIL";
  console.log(`${tag}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const ROUTES = [
  ["MIS Dashboard", "/mis-dashboard"],
  ["Rates Dashboard", "/dashboard"],
  ["POS Billing", "/pos"],
  ["Customer Orders", "/orders"],
  ["Returns", "/returns"],
  ["URD Voucher", "/urd-voucher"],
  ["Approvals", "/approvals"],
  ["Purchase Invoice", "/purchase"],
  ["Metal Loans", "/metal-loans"],
  ["Barcode Stock Desk", "/barcode"],
  ["Hardware & Security", "/hardware-security"],
  ["Inventory", "/inventory"],
  ["Karigar / Manufacturing", "/karigar"],
  ["Repairs", "/repairs"],
  ["Girvi / Moneylending", "/girvi"],
  ["Gold Scheme", "/gold-scheme"],
  ["GSS Scheme Builder", "/gss-schemes"],
  ["Day Book", "/daybook"],
  ["CRM", "/crm"],
  ["Reminders & Ageing", "/reminders"],
  ["Messenger", "/messenger"],
  ["Report Builder", "/report-builder"],
  ["Print Templates", "/print-templates"],
  ["Accounts Day Book", "/accounts"],
  ["GST Reports", "/gst-reports"],
  ["GST eDocs", "/gst-edocs"],
  ["Refinery", "/refinery"],
  ["Backup & Recovery", "/backup-recovery"],
  ["User Management", "/users"],
  ["Settings", "/settings"],
];

const fatalErrors = [];

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("No WebView2 browser context found over CDP");
  let page =
    ctx.pages().find((p) => p.url().includes("tauri.localhost")) || ctx.pages()[0];
  if (!page) throw new Error("No app page found in the desktop window");

  page.on("pageerror", (e) => fatalErrors.push(String(e)));

  // --- 1. App shell loaded ---
  // Clear any stored session so we always exercise the real login flow.
  await page.goto(`${BASE}/#/login`, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  // Wait out the "Checking local setup" boot gate.
  await page
    .waitForFunction(() => !document.body.innerText.includes("Checking local setup"), { timeout: 20000 })
    .catch(() => {});
  const onLogin = await page.locator('button:has-text("Sign In")').first().isVisible().catch(() => false);
  rec("Desktop window reachable + boot gate cleared", onLogin, onLogin ? "login screen shown" : "login button not visible");

  // --- 2. Real login flow in the actual window ---
  fatalErrors.length = 0;
  await page.locator('label:has-text("Username") input').fill(ADMIN_USER);
  await page.locator('label:has-text("Password") input').fill(ADMIN_PASS);
  await page.locator('button:has-text("Sign In")').click();
  let loggedIn = false;
  try {
    await page.waitForFunction(() => window.location.hash.includes("dashboard"), { timeout: 15000 });
    loggedIn = true;
  } catch {}
  // Wait for the app shell to actually mount (not an instant race).
  const shellUp = await page
    .locator("aside")
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  rec("Admin login → dashboard + app shell", loggedIn && shellUp, `hash=${await page.evaluate(() => location.hash)} shell=${shellUp}`);

  await page.screenshot({ path: "test-results/desktop-dashboard.png" }).catch(() => {});

  // --- 3. Visit every module route in the real window ---
  for (const [name, path] of ROUTES) {
    fatalErrors.length = 0;
    await page.evaluate((h) => {
      window.location.hash = h;
    }, path);
    // let the route mount + initial data fetch settle
    await page.waitForTimeout(1300);
    const asideVisible = await page.locator("aside").first().isVisible().catch(() => false);
    const h1 = (await page.locator("header h1").first().innerText().catch(() => "")).trim();
    const mainText = (await page.locator("main").first().innerText().catch(() => "")).trim();
    const ok = asideVisible && mainText.length > 0 && fatalErrors.length === 0;
    rec(
      `Module: ${name} (#${path})`,
      ok,
      ok ? `h1="${h1}"` : `aside=${asideVisible} mainLen=${mainText.length} err=${fatalErrors[0] ?? "none"}`
    );
  }

  // --- 4. Real write path: create a customer via CRM ---
  fatalErrors.length = 0;
  let created = false;
  let createDetail = "";
  try {
    await page.evaluate(() => {
      window.location.hash = "/crm";
    });
    await page.waitForTimeout(1500);
    await page.locator('button:has-text("Add Customer")').first().click();
    const modal = page.locator('form:has-text("New Customer")');
    await modal.waitFor({ state: "visible", timeout: 8000 });
    const stamp = String(Date.now()).slice(-6);
    const name = `Desktop Smoke ${stamp}`;
    const phone = "97" + String(Date.now()).slice(-8);
    await modal.locator('label:has-text("Name") input').first().fill(name);
    await modal.locator('label:has-text("Mobile No") input').fill(phone);
    await modal.locator('button:has-text("Save Customer")').click();
    // The modal only closes on a successful save; with a large customer list the
    // new row may be paginated off-screen, so the modal-closing is the success signal.
    await modal.waitFor({ state: "hidden", timeout: 10000 });
    created = true;
    const rowVisible = await page.getByRole("cell", { name }).first().isVisible().catch(() => false);
    createDetail = `customer "${name}"${rowVisible ? " (row shown)" : " (saved; row off-screen)"}`;
  } catch (e) {
    createDetail = String(e).split("\n")[0];
  }
  rec("Write path: create customer (real DB)", created, createDetail);

  // --- 4b. Real POS cash sale through the actual POS screen ---
  fatalErrors.length = 0;
  let sold = false;
  let saleDetail = "";
  try {
    // Seed a guaranteed-sellable silver coin via the desktop backend (gold needs
    // a full HUID/hallmark; silver is exempt from the POS hallmark gate).
    const lr = await fetch("http://127.0.0.1:4000/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    const token = (await lr.json()).token;
    const auth = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    // Ensure a silver rate is set so the POS can price a weight-wise item
    // (this also exercises the manual Daily-Rates save path).
    await fetch("http://127.0.0.1:4000/api/settings/rates", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        gold_24k_rate: "7000",
        gold_22k_rate: "6400",
        gold_18k_rate: "5200",
        silver_rate: "85",
      }),
    });
    const barcode = "SMOKE-" + String(Date.now()).slice(-7);
    // Quantity-wise (fixed unit price) coin — exercises the POS quantity-wise
    // pricing path (must show ₹5000, not ₹0).
    const ir = await fetch("http://127.0.0.1:4000/api/inventory/add", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        barcode,
        category: "Coins",
        metal_type: "Silver",
        sale_mode: "QUANTITY_WISE",
        uom: "PIECE",
        unit_price_paise: 500000,
      }),
    });
    if (ir.status !== 201) throw new Error(`item create failed: ${ir.status} ${await ir.text()}`);

    await page.evaluate(() => {
      window.location.hash = "/pos";
    });
    await page.waitForTimeout(1800);
    // Keyboard-wedge scan into the POS screen.
    await page.click("body");
    await page.keyboard.type(barcode, { delay: 12 });
    await page.keyboard.press("Enter");
    await page.locator(`td:text-is("${barcode}")`).waitFor({ state: "visible", timeout: 6000 });

    const net = Number((await page.getByTestId("net-payable").getAttribute("data-paise")) ?? "0");
    await page.locator('label:has-text("Cash") input').fill((net / 100).toString());
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="balance-remaining"]');
        return el && Number(el.getAttribute("data-paise")) === 0;
      },
      { timeout: 6000 }
    );
    await page.locator('button:text-is("Checkout")').click();
    sold = await page
      .getByRole("heading", { name: "Invoice Saved" })
      .waitFor({ state: "visible", timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    saleDetail = `barcode ${barcode}, net ₹${(net / 100).toFixed(0)}`;
    await page.keyboard.press("Escape").catch(() => {}); // close invoice modal
  } catch (e) {
    saleDetail = String(e).split("\n")[0];
  }
  rec("POS cash sale through POS screen (real DB)", sold, saleDetail);

  // --- 5. Logout returns to login screen ---
  fatalErrors.length = 0;
  let loggedOut = false;
  let logoutDetail = "";
  try {
    // Close any open CRM 360 panel / modal so the sidebar Logout is clickable.
    await page.keyboard.press("Escape").catch(() => {});
    await page.evaluate(() => {
      window.location.hash = "/dashboard";
    });
    await page.waitForTimeout(800);
    const btn = page.locator('aside button:has-text("Logout")').first();
    const btnCount = await page.locator('button:has-text("Logout")').count();
    await btn.click({ timeout: 5000 });
    loggedOut = await page
      .locator('button:has-text("Sign In")')
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    logoutDetail = `hash=${await page.evaluate(() => location.hash)} logoutBtns=${btnCount}`;
  } catch (e) {
    logoutDetail = String(e).split("\n")[0];
  }
  if (!loggedOut) await page.screenshot({ path: "test-results/desktop-logout-fail.png" }).catch(() => {});
  rec("Logout → login screen", loggedOut, logoutDetail);

  // --- summary ---
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log("\n──────────────────────────────────────────");
  console.log(`DESKTOP SMOKE: ${passed}/${results.length} passed, ${failed} failed`);
  if (failed) {
    console.log("FAILED CHECKS:");
    for (const r of results.filter((x) => !x.ok)) console.log(`  ✗ ${r.name}`);
  }
  console.log("──────────────────────────────────────────");

  await browser.close().catch(() => {}); // detaches CDP; does NOT close the app window
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
