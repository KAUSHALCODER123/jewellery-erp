import { test, expect } from "@playwright/test";
import { login, scanBarcode } from "./helpers.js";

test.describe("Compliance & KYC enforcement", () => {
  test("cash ≥ ₹2,00,000 reveals KYC fields and blocks checkout", async ({ page }) => {
    await login(page, "test_staff", "staff_pass");
    await page.goto("/#/pos");
    await page.waitForLoadState("networkidle");

    await scanBarcode(page, "ITEM-001");

    // Force cash over the ₹2,00,000 compliance threshold.
    await page.locator('label:has-text("Cash") input').fill("250000");

    // KYC compliance panel + fields appear.
    await expect(page.locator("text=Compliance: Cash")).toBeVisible();
    await expect(page.locator('label:has-text("PAN Number") input')).toBeVisible();
    await expect(page.locator('label:has-text("Aadhaar Number") input')).toBeVisible();

    // Checkout is blocked while KYC is incomplete.
    const checkoutBtn = page.locator('button:text-is("Checkout")');
    await expect(checkoutBtn).toBeDisabled();

    // Force-clicking sends no request.
    let requestSent = false;
    await page.route("**/api/pos/checkout", (route) => {
      requestSent = true;
      return route.continue();
    });
    await checkoutBtn.click({ force: true });
    await page.waitForTimeout(300);
    expect(requestSent).toBe(false);
  });
});
