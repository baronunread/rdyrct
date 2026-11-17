import { expect, test } from "@playwright/test";
import { queryRows } from "./db";
import { signUpThroughForm } from "./resend";
import { currentOrgName } from "./orgs";

const password = "test-password-123";

test("a new account arrives with an organization and one question", async ({ page }) => {
  await signUpThroughForm(page, `firstrun-${Date.now()}@gmail.com`, password);

  const switcher = page.locator("[data-org-switcher]").first();
  await expect(switcher).toBeVisible();
  await expect(currentOrgName(page)).not.toHaveText("No organization");

  await expect(page.getByRole("heading", { name: "Shorten your first link" })).toBeVisible();
  await expect(page.getByRole("term").getByText("Clicks", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Create link" }).click();
  const form = page.getByRole("dialog", { name: "New link" });
  await form
    .getByRole("textbox", { name: "Destination", exact: true })
    .fill("example.com/first-run");
  await form.getByRole("button", { name: "Create link" }).click();

  const dialog = page.getByRole("dialog", { name: "Link created" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Close/i }).click();

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("term").getByText("Clicks", { exact: true })).toBeVisible();
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
