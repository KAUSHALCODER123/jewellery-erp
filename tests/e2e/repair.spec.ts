import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

test.describe("Repair / order desk", () => {
  test("create a repair intake and advance its status", async ({ page }) => {
    await login(page, "test_admin", "admin_pass");
    await page.goto("/#/repairs");

    await page.locator('button:has-text("New Intake")').click();

    const form = page.locator('form:has-text("New Repair")');
    await expect(form).toBeVisible();

    // Seeded customer id 1.
    await form.locator("select").first().selectOption("1");
    const description = `Resize ring + polish ${Date.now().toString().slice(-5)}`;
    await form.locator("textarea").fill(description);
    await form.locator('button:has-text("Create Intake")').click();

    await expect(form).toBeHidden({ timeout: 8000 });

    const card = page.locator(`article:has-text("${description}")`).first();
    await expect(card).toBeVisible({ timeout: 8000 });
    await expect(card.getByText("RECEIVED")).toBeVisible();

    // Advance Received → WIP.
    await card.locator('button:has-text("Move to WIP")').click();
    await expect(card.getByText("WIP")).toBeVisible({ timeout: 8000 });
  });
});
