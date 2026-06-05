import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test.describe("Auth & RBAC", () => {
  test("counter staff land on the staff dashboard without executive navigation", async ({ page }) => {
    await login(page, "test_staff", "staff_pass");
    await expect(page).toHaveURL(/#\/dashboard/);

    // Staff-facing nav present.
    await expect(page.locator('a:has-text("POS Billing")')).toBeVisible();
    await expect(page.locator('a:has-text("Repairs")')).toBeVisible();

    // Executive-only nav hidden.
    await expect(page.locator('a:has-text("MIS Dashboard")')).toHaveCount(0);
    await expect(page.locator('a:has-text("Scheme Builder")')).toHaveCount(0);
    await expect(page.locator('a:has-text("Backup & Recovery")')).toHaveCount(0);
  });

  test("admin has full executive navigation and is routed to MIS at root", async ({ page }) => {
    await login(page, "test_admin", "admin_pass");

    // Executive nav is available to admins.
    await expect(page.locator('a:has-text("MIS Dashboard")')).toBeVisible();
    await expect(page.locator('a:has-text("Day Book")')).toBeVisible();
    await expect(page.locator('a:has-text("Scheme Builder")')).toBeVisible();

    // Visiting the app root routes executives to the MIS dashboard.
    await page.goto("/#/");
    await expect(page).toHaveURL(/#\/mis-dashboard/, { timeout: 10000 });
  });

  test("invalid credentials are rejected", async ({ page }) => {
    await page.goto("/#/login");
    await page.locator('label:has-text("Username") input').fill("test_admin");
    await page.locator('label:has-text("Password") input').fill("wrong_password");
    await page.locator('button:has-text("Sign In")').click();
    await expect(page.locator("text=/invalid|incorrect|credential/i")).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/#\/login/);
  });
});
