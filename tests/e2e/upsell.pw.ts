import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { setPlan } from "./db";

/**
 * How a feature the plan lacks offers itself. A whole feature (Domains)
 * keeps its normal button, badged "Paid", and pressing it opens the upgrade
 * dialog. A section inside a page (QR code defaults) shows its real editor,
 * inert, with one Upgrade under it. On a paid plan the same pages behave
 * normally.
 */

const password = "test-password-123";

test("free plan: Add domain is badged and opens the upgrade dialog, which leads to the plans", async ({
  page,
}) => {
  await signUpAndVerify(page, `upsell-domains-${Date.now()}@gmail.com`, password);
  await page.goto("/domains");

  // The empty state is the one a paid plan sees, with its example row.
  await expect(page.getByText("No domains yet")).toBeVisible();
  await expect(page.getByTestId("domain-example")).toContainText("go.yourbrand.com");

  const add = page.getByRole("button", { name: "Add domain" });
  await expect(add).toContainText("Paid");
  await add.click();

  const dialog = page.getByRole("dialog", { name: "Custom domains come with a paid plan" });
  await expect(dialog).toContainText("Cancel any time.");
  await expect(dialog.getByRole("textbox")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).toBeHidden();

  await add.click();
  await page.getByRole("link", { name: "See plans" }).click();
  await expect(page).toHaveURL(/\/billing$/);
});

test("paid plan: the same empty state, and Add domain opens the add form", async ({ page }) => {
  const email = `upsell-paid-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await setPlan(page, email);
  await page.goto("/domains");

  await expect(page.getByText("No domains yet")).toBeVisible();
  await expect(page.getByTestId("domain-example")).toBeVisible();
  const add = page.getByRole("button", { name: "Add domain" });
  await expect(add).not.toContainText("Paid");
  await add.click();
  await expect(page.getByRole("dialog", { name: "Add a domain" })).toBeVisible();
});

test("free plan: the QR defaults editor is shown inert, and Upgrade opens the dialog", async ({
  page,
}) => {
  await signUpAndVerify(page, `upsell-qr-${Date.now()}@gmail.com`, password);
  await page.goto("/organization");

  const section = page.locator("section", {
    has: page.getByRole("heading", { name: "QR code defaults" }),
  });
  await expect(section).toContainText("Paid");
  // The real rows are there, but inert: nothing in them takes focus.
  const rows = section.locator("fieldset").first();
  await expect(rows).toBeVisible();
  const focusable = await rows.evaluate((fs) => {
    const controls = [...fs.querySelectorAll<HTMLElement>("button, input")];
    return controls.filter((c) => {
      c.focus();
      return document.activeElement === c;
    }).length;
  });
  expect(focusable).toBe(0);
  await expect(section).toContainText("Your logo, colours and pattern on every new QR code.");

  await page.getByRole("button", { name: "Upgrade", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "QR code styles come with a paid plan" });
  await expect(dialog).toContainText("Your logo in every QR code");
  await dialog.getByRole("button", { name: "Not now" }).click();
  await expect(dialog).toBeHidden();
});
