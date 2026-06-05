import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Bulk Barcode desk supports quantity-wise (per-piece) tags with a unit price.
test.describe("Bulk quantity-wise tags", () => {
  test("switch to quantity-wise, set unit price, and generate tags", async ({ page }) => {
    await login(page, "test_admin", "admin_pass");
    await page.goto("/#/barcode");

    await page.locator('label:has-text("Prefix") input').fill("QTY");
    await page.locator('label:has-text("Sale Mode") select').selectOption("QUANTITY_WISE");

    // Unit price field appears for quantity-wise.
    const unitPrice = page.locator('label:has-text("Unit Price") input');
    await expect(unitPrice).toBeVisible();
    await unitPrice.fill("5000");

    await page.locator('label:has-text("Qty") input').fill("2");
    await page.locator('button:has-text("Create Barcode Tags")').click();

    // Two QTY-prefixed per-piece tags created.
    await expect(page.getByText(/QTY\d{4}/).first()).toBeVisible({ timeout: 8000 });
  });
});
