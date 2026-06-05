import { test, expect } from "@playwright/test";
import { login, scanBarcode, readPaise } from "./helpers.js";

// Exercises the reference-style billing flow:
// customer type-ahead + mobile shown → per-line making edit → credit (udhari)
// payment → "Save on Credit?" confirm → invoice modal + WhatsApp action.
test.describe("POS reference billing flow", () => {
  test("customer search, per-line making, credit confirm, and post-save actions", async ({ page }) => {
    await login(page, "test_staff", "staff_pass");
    await page.goto("/#/pos");
    await page.waitForLoadState("networkidle");

    // (a)(b) Type-ahead customer search → select → mobile/area surfaced.
    const customerInput = page.locator('label:has-text("Customer") input');
    await customerInput.click();
    await customerInput.fill("Test");
    await page.locator('button:has-text("Test Customer")').click();
    await expect(page.locator("text=9990001112")).toBeVisible();

    // Scan an item.
    await scanBarcode(page, "ITEM-002");

    // (c) Per-line making charge is editable (second input in the row).
    const makingInput = page.locator("tbody tr input").nth(1);
    await makingInput.fill("2000");

    // (d) Pay the whole bill on credit (udhari) to trigger the credit confirm.
    const netPaise = await readPaise(page, "net-payable");
    await page.locator('label:has-text("Udhari") input').fill((netPaise / 100).toString());
    await expect.poll(async () => readPaise(page, "balance-remaining")).toBe(0);

    await page.locator('button:text-is("Checkout")').click();

    // Credit confirmation appears; confirm it.
    await expect(page.locator("text=Save on Credit?")).toBeVisible();
    await page.locator('button:has-text("Yes, Save")').click();

    // Invoice saved modal + WhatsApp action (customer is attached).
    await expect(page.getByRole("heading", { name: "Invoice Saved" })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Send WhatsApp")')).toBeVisible();
  });
});
