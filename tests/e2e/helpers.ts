import { expect, type Page } from "@playwright/test";

/** Log in through the real login UI and wait for the dashboard to load. */
export async function login(page: Page, username = "test_admin", password = "admin_pass") {
  await page.goto("/#/login");
  await page.locator('label:has-text("Username") input').fill(username);
  await page.locator('label:has-text("Password") input').fill(password);
  await page.locator('button:has-text("Sign In")').click();
  await page.waitForURL((url) => url.hash.includes("dashboard"), { timeout: 15000 });
}

/** Scan a barcode into the POS screen via the keyboard-wedge scanner. */
export async function scanBarcode(page: Page, barcode: string) {
  await page.click("body");
  await page.keyboard.type(barcode, { delay: 10 });
  await page.keyboard.press("Enter");
  await expect(page.locator(`td:text-is("${barcode}")`)).toBeVisible({ timeout: 5000 });
}

/** Read an integer paise value from a `data-paise` attribute. */
export async function readPaise(page: Page, testId: string): Promise<number> {
  const raw = await page.getByTestId(testId).getAttribute("data-paise");
  return Number(raw ?? "0");
}
