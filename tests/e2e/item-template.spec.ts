import { test, expect } from "@playwright/test";
import { login } from "./helpers.js";

// Item Master: define a reusable template, then it pre-fills the Barcode desk
// (pick-then-weigh), and a tag is generated from it.
test.describe("Item template → barcode pre-fill", () => {
  test("create a template, pre-fill the tag form, and generate a tag", async ({ page }) => {
    await login(page, "test_admin", "admin_pass");
    await page.goto("/#/barcode");

    // Define a new item template.
    await page.locator('button:has-text("New Template")').click();
    const modal = page.locator('form:has-text("New Item Template")');
    await expect(modal).toBeVisible();

    const name = `Gents Ring ${Date.now().toString().slice(-5)}`;
    await modal.locator('label:has-text("Name") input').first().fill(name);
    await modal.locator('label:has-text("Tag Prefix") input').fill("TPL");
    await modal.locator('button:has-text("Save Template")').click();
    await expect(modal).toBeHidden({ timeout: 8000 });

    // Selecting the template pre-filled the create-tag form.
    await expect(page.locator('label:has-text("Design") input')).toHaveValue(name);
    await expect(page.locator('label:has-text("Prefix") input')).toHaveValue("TPL");

    // Add weight + making and generate the tag.
    await page.locator('label:has-text("Gross Wt (g)") input').fill("5.000");
    await page.locator('label:has-text("Making Rs") input').fill("350");
    await page.locator('button:has-text("Create Barcode Tags")').click();

    // A TPL-prefixed tag was created.
    await expect(page.getByText(/TPL\d{4}/).first()).toBeVisible({ timeout: 8000 });
  });
});
