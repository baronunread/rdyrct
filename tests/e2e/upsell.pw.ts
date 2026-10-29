import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";

/**
 * How a feature the plan lacks offers itself. A whole page the plan does
 * not include (Domains on Free) is one locked state with one way to the
 * plans. A setting the plan cannot save (QR code defaults on Free) stays
 * fully usable to try, and saving it opens the plan picker. On a paid plan
 * the same pages behave normally.
 */

const password = "test-password-123";

test("free plan: Domains is one locked state, and See plans leads to the plans", async ({
  page,
}) => {
  await signUpAndVerify(page, `upsell-domains-${Date.now()}@gmail.com`, password);
  await page.goto("/domains");

  const locked = page.getByTestId("feature-locked");
  await expect(locked).toContainText("Custom domains are available on Hobby and Pro.");
  await expect(locked).toContainText("slugs you choose");
  // No Add domain, no example row, no dialog.
  await expect(page.getByRole("button", { name: "Add domain" })).toHaveCount(0);
  await expect(page.getByTestId("domain-example")).toHaveCount(0);

  await locked.getByRole("link", { name: "See plans" }).click();
  await expect(page).toHaveURL(/\/billing$/);
});

test("paid plan: the empty state with its example, and Add domain opens the add form", async ({
  page,
}) => {
  const email = `upsell-paid-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email);
  await page.goto("/domains");

  await expect(page.getByText("No domains yet")).toBeVisible();
  await expect(page.getByTestId("domain-example")).toBeVisible();
  await expect(page.getByTestId("feature-locked")).toHaveCount(0);
  await page.getByRole("button", { name: "Add domain" }).click();
  await expect(page.getByRole("dialog", { name: "Add a domain" })).toBeVisible();
});

test("free plan: QR defaults can be tried, and Upgrade to save opens the plan picker", async ({
  page,
}) => {
  await signUpAndVerify(page, `upsell-qr-${Date.now()}@gmail.com`, password);
  await page.goto("/organization");

  const section = page.locator("section", {
    has: page.getByRole("heading", { name: "QR code defaults" }),
  });
  await expect(section).toContainText("Saving comes with a paid plan");
  const row = section.getByTestId("qr-save-row");
  await expect(row).toContainText("Every new QR code starts like this");
  await expect(row.getByRole("button", { name: "See plans" })).toBeVisible();
  await expect(section.getByText("Preview", { exact: true })).toBeVisible();

  // The editor is live: a style changes, and the row says it is not saved.
  await section.getByRole("button", { name: "Classy", exact: true }).first().click();
  await expect(row).toContainText("Not saved yet. Upgrade and it is kept.");
  await expect(section.getByText("Preview, not saved")).toBeVisible();

  // Reset goes back to what is saved.
  await row.getByRole("button", { name: "Reset" }).click();
  await expect(row.getByRole("button", { name: "See plans" })).toBeVisible();

  await section.getByRole("button", { name: "Classy", exact: true }).first().click();
  await row.getByRole("button", { name: "Upgrade to save" }).click();
  const dialog = page.getByRole("dialog", { name: "Keep this QR style" });
  await expect(dialog).toBeVisible();
  // Hobby and Pro, Hobby picked, each with its price.
  await expect(dialog.getByRole("radio", { name: /Hobby/ })).toBeChecked();
  await expect(dialog.getByRole("radio", { name: /Pro/ })).not.toBeChecked();
  await expect(dialog).toContainText("$4");
  await expect(dialog).toContainText("$9");
  await expect(dialog.getByRole("link", { name: "Compare every plan" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue to checkout" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});
