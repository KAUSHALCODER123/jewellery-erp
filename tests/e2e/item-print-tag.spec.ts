import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Single-item Item Master offers a "Print Tag" action immediately after saving.
test.describe("Item master print-tag", () => {
  test("offers Print Tag after saving an item", async ({ page }) => {
    await login(page, "test_admin", "admin_pass");

    // Seed a default LABEL template so the Print Tag affordance can render.
    const token = await page.evaluate(() => localStorage.getItem("jewelry_erp_jwt"));
    const seeded = await page.request.post("/api/settings/print-templates", {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `Label ${Date.now()}`, document_type: "LABEL", page_size: "LABEL_50X25", content: { showLogo: false }, is_default: true }
    });
    expect(seeded.ok()).toBeTruthy();

    await page.goto("/#/inventory");

    const barcode = `TAG${Date.now().toString().slice(-7)}`;
    await page.locator('label:has-text("Barcode") input').fill(barcode);
    await page.locator('label:has-text("Gross Weight (g)") input').fill("5.000");
    await page.locator('label:has-text("Making Charge (₹)") input').fill("350");
    await page.locator('button:has-text("Add Item")').click();

    // Success + Print Tag offered.
    await expect(page.locator("text=/Saved/").first()).toBeVisible({ timeout: 8000 });
    await expect(page.locator('button:has-text("Print Tag")')).toBeVisible({ timeout: 8000 });
  });
});
