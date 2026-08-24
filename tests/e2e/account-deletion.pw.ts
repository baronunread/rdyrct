/**
 * What deleting an account destroys, and what it says first (#119).
 *
 * An organization has no plan of its own: `orgPlan` reads its owner's. One
 * kept alive without an owner would have no plan, no billing and nobody who
 * could delete it, so the account cannot go without them. That is a large
 * thing to do quietly, which makes the confirmation part of the feature
 * rather than decoration around it.
 */
import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows } from "./db";

const password = "test-password-123";

/** Signs up, and reports the one organization signup hands the account. */
async function ownerWithOrg(page: Page, prefix: string) {
  const email = `${prefix}-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  const [org] = await queryRows<{ id: string; name: string }>(
    page,
    `select o.id, o.name from orgs o
     join org_members m on m.org_id = o.id and m.role = 'owner'
     join user u on u.id = m.user_id
     where u.email = ?`,
    [email],
  );
  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete account" });
  await expect(dialog).toBeVisible();
  return { email, org, dialog };
}

test("the delete-account confirmation names every organization it will destroy", async ({
  page,
}) => {
  test.slow();
  // One owned org, which is the whole free-plan allowance: signup hands every
  // account one, named from the email domain.
  const { email, org, dialog } = await ownerWithOrg(page, "delete-account");

  await expect(dialog.getByText("the organization you own")).toBeVisible();
  await expect(dialog.getByText(org.name, { exact: true })).toBeVisible();
  await expect(dialog.getByText(/None of it can be recovered/)).toBeVisible();

  // Closing it changes nothing: the warning is a question, not a step.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const stillHere = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from user where email = ?",
    [email],
  );
  expect(Number(stillHere[0].n)).toBe(1);
});

test("deleting the account takes the organizations it owns, teammates and all", async ({
  page,
}) => {
  test.slow();
  const { org, dialog } = await ownerWithOrg(page, "delete-owner");

  await dialog.getByRole("button", { name: "Delete account" }).click();

  // Signed out, back on the landing page.
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

  // Gone, rather than left behind with no owner: that was the state nothing
  // in the product could express or repair. The teardown workflow runs to
  // completion here, so the row itself is already away.
  const rows = await queryRows<{ n: number }>(page, "select count(*) as n from orgs where id = ?", [
    org.id,
  ]);
  expect(Number(rows[0].n)).toBe(0);
});
