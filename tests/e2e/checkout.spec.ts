import { test, expect } from "@playwright/test";
import { db } from "../../src/db/client.js";
import { invoices, items } from "../../src/db/schema.js";
import { eq } from "drizzle-orm";
import { login, scanBarcode, readPaise } from "./helpers.js";

test.describe("POS atomicity & rollback", () => {
  test("checkout rolls back to IN_STOCK if the request is aborted mid-flight", async ({ page }) => {
    await login(page, "test_staff", "staff_pass");
    await page.goto("/#/pos");
    await page.waitForLoadState("networkidle");

    await scanBarcode(page, "ITEM-001");

    // Read the exact payable from the stable data attribute (not the animated text).
    const netPaise = await readPaise(page, "net-payable");
    await page.locator('label:has-text("Cash") input').fill((netPaise / 100).toString());

    // Balance settles to zero.
    await expect.poll(async () => readPaise(page, "balance-remaining")).toBe(0);

    // Abort the checkout request mid-flight.
    await page.route("**/api/pos/checkout", (route) => route.abort("failed"));
    await page.locator('button:text-is("Checkout")').click();

    // UI surfaces the failure.
    await expect(page.locator("p.text-red-300")).toBeVisible();

    // DB stayed consistent: no invoice, item still in stock.
    expect(db.select().from(invoices).all().length).toBe(0);
    const dbItem = db.select().from(items).where(eq(items.barcode, "ITEM-001")).get();
    expect(dbItem?.status).toBe("IN_STOCK");
  });
});
