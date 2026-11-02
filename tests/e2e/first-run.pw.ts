import { expect, test } from "@playwright/test";
import { queryRows } from "./db";
import { signUpThroughForm } from "./resend";
import { currentOrgName } from "./orgs";

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
  await signUpThroughForm(page, `firstrun-${Date.now()}@gmail.com`, password);

  // The organization is real before anything is created: the switcher names
  // it, rather than saying there is none.
  const switcher = page.locator("[data-org-switcher]").first();
  await expect(switcher).toBeVisible();
  await expect(currentOrgName(page)).not.toHaveText("No organization");

  // One question, and none of the empty furniture: three zeroed stat cards
  // and a flat chart teach a new account that the product is empty.
  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();
  await expect(page.getByRole("term").getByText("Clicks", { exact: true })).toHaveCount(0);

  // The panel's button opens the New link form every page uses.
  await page.getByRole("button", { name: "Create link" }).click();
  const form = page.getByRole("dialog", { name: "New link" });
  await form
    .getByRole("textbox", { name: "Destination", exact: true })
    .fill("example.com/first-run");
  await form.getByRole("button", { name: "Create link" }).click();

  // The QR and the short URL, in the same dialog every other creation uses.
  const dialog = page.getByRole("dialog", { name: "Link created" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Close/i }).click();

  // And with a link in it, the dashboard becomes a dashboard.
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("term").getByText("Clicks", { exact: true })).toBeVisible();
  // The new link is on the page at once, in Top links at zero clicks.
  await expect(page.getByText("Your busiest links appear here")).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Range" }).getByRole("button", { name: "7d", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("the only organization can't be deleted; the page points at deleting the account", async ({
  page,
}) => {
  const email = `lastorg-${Date.now()}@gmail.com`;
  await signUpThroughForm(page, email, password);

  // An account with one organization and nowhere else to go: deleting it
  // would leave an account with nothing to use, so the way out is the
  // account itself.
  await page.goto("/organization");
  await expect(page.getByText("This is your only organization.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete organization" })).toHaveCount(0);
  await page.getByRole("link", { name: "Go to Settings" }).click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole("button", { name: "Delete account" })).toBeVisible();

  // The Worker refuses it too, whatever the page shows.
  const [org] = await queryRows<{ id: string }>(
    page,
    "select o.id from orgs o join org_members m on m.org_id = o.id join user u on u.id = m.user_id where u.email = ?",
    [email],
  );
  const res = await page.request.delete(`/api/orgs/${org!.id}`);
  expect(res.status()).toBe(409);
});
