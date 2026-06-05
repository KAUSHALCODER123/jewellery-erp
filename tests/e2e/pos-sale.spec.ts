import { test, expect } from "@playwright/test";
import { login, scanBarcode, readPaise } from "./helpers.js";

test.describe("POS happy-path sale", () => {
  test("complete a cash sale and see the invoice-saved modal", async ({ page }) => {
    await login(page, "test_staff", "staff_pass");
    await page.goto("/#/pos");
    await page.waitForLoadState("networkidle");

    await scanBarcode(page, "ITEM-003");

    const netPaise = await readPaise(page, "net-payable");
    await page.locator('label:has-text("Cash") input').fill((netPaise / 100).toString());
    await expect.poll(async () => readPaise(page, "balance-remaining")).toBe(0);

    await page.locator('button:text-is("Checkout")').click();

    // Print modal confirms the saved invoice.
    await expect(page.getByRole("heading", { name: "Invoice Saved" })).toBeVisible({ timeout: 10000 });
  });
});
