import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";

/**
 * What a brand-new account walks into.
 *
 * Every account is given an organization on its first session, so the only
 * thing missing is a link, and the field that makes one is already the first
 * thing on the dashboard. What this pins down: the account is usable straight
 * away, the page asks one question rather than showing eleven empty widgets,
 * and "no organization" is now a state you can only reach by deleting the one
 * you were given.
 */

const password = "test-password-123";

test("a new account arrives with an organization and one question", async ({ page }) => {
  await signUpAndVerify(page, `firstrun-${Date.now()}@gmail.com`, password);

  // The organization is real before anything is created: the switcher names
  // it, rather than saying there is none.
  const switcher = page.getByTitle("Switch organization");
  await expect(switcher).toBeVisible();
  await expect(switcher).not.toHaveText("No organization");

  // One question, and none of the empty furniture: three zeroed stat cards
  // and a flat chart teach a new account that the product is empty.
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();
  await expect(page.getByText("Clicks · 7d")).toHaveCount(0);

  await page.getByPlaceholder("https://example.com/launch").first().fill("example.com/first-run");
  await page.getByRole("button", { name: "Create link" }).click();

  // The QR and the short URL, in the same dialog every other creation uses.
  const dialog = page.getByRole("dialog", { name: "Link created" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Close/i }).click();

  // And with a link in it, the dashboard becomes a dashboard.
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Clicks · 7d")).toBeVisible();
});

test("deleting the last organization asks for a new one, not for a first link", async ({
  page,
}) => {
  await signUpAndVerify(page, `lastorg-${Date.now()}@gmail.com`, password);

  await page.goto("/organization");
  const name = await page.getByLabel("Organization name").inputValue();
  await page.getByRole("button", { name: "Delete organization" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Delete organization" });
  await dialog.getByLabel(`Type ${name} to confirm deletion`).fill(name);
  await dialog.getByRole("button", { name: "Delete organization" }).click();

  // The plain question, with a name field. Whoever gets here has owned an
  // organization already, so onboarding copy would be nonsense.
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Create an organization" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toHaveCount(0);

  // And it works: naming one puts them back in the app.
  await page.getByLabel("Name").fill("Second Time");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByTitle("Switch organization")).toHaveText("Second Time", {
    timeout: 15_000,
  });
});
