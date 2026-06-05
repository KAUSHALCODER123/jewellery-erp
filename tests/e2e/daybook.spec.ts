import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test.describe("Day Book", () => {
  test("renders the day-book KPI summary", async ({ page }) => {
    await login(page, "test_admin", "admin_pass");
    await page.goto("/#/daybook");

    await expect(page.locator("text=Total Sales")).toBeVisible({ timeout: 8000 });
    await expect(page.locator("text=Total Purchase")).toBeVisible();
    await expect(page.locator("text=Old Gold / URD")).toBeVisible();
    await expect(page.locator("text=Cash In Hand")).toBeVisible();
  });
});
