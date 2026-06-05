import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// The Girvi "Issue New Loan" screen pre-fills a sequential loan/Pavati number.
test.describe("Girvi auto loan number", () => {
  test("loan number field is pre-filled with a sequential GRV number", async ({ page }) => {
    await login(page, "test_admin", "admin_pass");
    await page.goto("/#/girvi");

    // Issue tab is the default; the Loan Number field auto-fills.
    await expect(page.locator('label:has-text("Loan Number") input')).toHaveValue(/GRV-\d{4}/, { timeout: 8000 });
  });
});
