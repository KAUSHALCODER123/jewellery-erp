import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test.describe("Customer master", () => {
  test("create a customer from the CRM Add Customer modal", async ({ page }) => {
    await login(page, "test_admin", "admin_pass");
    await page.goto("/#/crm");

    await page.locator('button:has-text("Add Customer")').click();

    const modal = page.locator('form:has-text("New Customer")');
    await expect(modal).toBeVisible();

    const name = `Playwright Buyer ${Date.now().toString().slice(-5)}`;
    const phone = "98" + Date.now().toString().slice(-8);
    await modal.locator('label:has-text("Name") input').first().fill(name);
    await modal.locator('label:has-text("Mobile No") input').fill(phone);
    await modal.locator('button:has-text("Save Customer")').click();

    // Modal closes and the new customer shows up (list row + opened 360 panel).
    await expect(modal).toBeHidden({ timeout: 8000 });
    await expect(page.getByRole("cell", { name }).first()).toBeVisible({ timeout: 8000 });
  });
});
