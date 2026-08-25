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
import { queryRows, rawSql } from "./db";

const password = "test-password-123";

/** Signs up, and reports the account and organization signup hands it. */
async function ownerWithOrg(page: Page, prefix: string) {
  const email = `${prefix}-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  const [row] = await queryRows<{ userId: string; id: string; name: string }>(
    page,
    `select u.id as userId, o.id, o.name from orgs o
     join org_members m on m.org_id = o.id and m.role = 'owner'
     join user u on u.id = m.user_id
     where u.email = ?`,
    [email],
  );
  return { email, userId: row.userId, org: { id: row.id, name: row.name } };
}

/** Adds the destructive scope the dialog and teardown both have to honour. */
async function addAccountDeletionScope(
  page: Page,
  owner: Awaited<ReturnType<typeof ownerWithOrg>>,
) {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const teammateId = `delete-mate-${stamp}`;
  const secondOwned = { id: `delete-owned-${stamp}`, name: "Second owned organization" };
  const memberOnly = { id: `delete-member-${stamp}`, name: "Member-only organization" };

  await rawSql(
    page,
    `insert into user
       (id, name, email, email_verified, is_admin, plan, created_at, updated_at)
     values (?, 'Teammate', ?, 1, 0, 'free', 0, 0)`,
    [teammateId, `${teammateId}@example.com`],
  );
  await rawSql(
    page,
    "insert into org_members (org_id, user_id, role, created_at) values (?, ?, 'member', 1)",
    [owner.org.id, teammateId],
  );
  await rawSql(page, "insert into orgs (id, name, created_at) values (?, ?, 0)", [
    secondOwned.id,
    secondOwned.name,
  ]);
  await rawSql(
    page,
    "insert into org_members (org_id, user_id, role, created_at) values (?, ?, 'owner', 2)",
    [secondOwned.id, owner.userId],
  );
  await rawSql(page, "insert into orgs (id, name, created_at) values (?, ?, 0)", [
    memberOnly.id,
    memberOnly.name,
  ]);
  await rawSql(
    page,
    "insert into org_members (org_id, user_id, role, created_at) values (?, ?, 'owner', 3)",
    [memberOnly.id, teammateId],
  );
  await rawSql(
    page,
    "insert into org_members (org_id, user_id, role, created_at) values (?, ?, 'member', 4)",
    [memberOnly.id, owner.userId],
  );

  return { teammateId, secondOwned, memberOnly };
}

async function openDeleteDialog(page: Page) {
  await page.goto("/settings");
  const button = page.getByRole("button", { name: "Delete account" });
  await expect(button).toBeEnabled();
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Delete account" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("the delete-account confirmation names every organization it will destroy", async ({
  page,
}) => {
  test.slow();
  const owner = await ownerWithOrg(page, "delete-account");
  const scope = await addAccountDeletionScope(page, owner);

  // The cached shell can draw Settings before the fresh /user answer arrives.
  // Until it does, opening a generic warning would hide every org name.
  let releaseUser = () => {};
  const userGate = new Promise<void>((resolve) => {
    releaseUser = resolve;
  });
  await page.route("**/api/user", async (route) => {
    await userGate;
    await route.continue();
  });
  await page.goto("/settings");
  const deleteButton = page.getByRole("button", { name: "Delete account" });
  await expect(page.getByTestId("settings-page-skeleton")).toBeVisible();
  await expect(deleteButton).toBeHidden();
  releaseUser();
  await expect(deleteButton).toBeEnabled();
  await deleteButton.click();
  const dialog = page.getByRole("dialog", { name: "Delete account" });

  await expect(dialog.getByText("the 2 organizations you own")).toBeVisible();
  await expect(dialog.getByText(owner.org.name, { exact: true })).toBeVisible();
  await expect(dialog.getByText(scope.secondOwned.name, { exact: true })).toBeVisible();
  await expect(dialog.getByText(scope.memberOnly.name, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/None of it can be recovered/)).toBeVisible();

  // Closing it changes nothing: the warning is a question, not a step.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const stillHere = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from user where email = ?",
    [owner.email],
  );
  expect(Number(stillHere[0].n)).toBe(1);
});

test("deleting the account takes the organizations it owns, teammates and all", async ({
  page,
}) => {
  test.slow();
  const owner = await ownerWithOrg(page, "delete-owner");
  const scope = await addAccountDeletionScope(page, owner);
  const dialog = await openDeleteDialog(page);

  await dialog.getByRole("button", { name: "Delete account" }).click();

  // Signed out, back on the landing page.
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });

  // Gone, rather than left behind with no owner: that was the state nothing
  // in the product could express or repair. The workflow is asynchronous, so
  // wait for its durable outcome instead of assuming it beat the redirect.
  await expect
    .poll(async () => {
      const owned = await queryRows<{ n: number }>(
        page,
        "select count(*) as n from orgs where id in (?, ?)",
        [owner.org.id, scope.secondOwned.id],
      );
      return Number(owned[0].n);
    })
    .toBe(0);

  const survivors = await queryRows<{ orgs: number; users: number }>(
    page,
    `select
       (select count(*) from orgs where id = ?) as orgs,
       (select count(*) from user where id = ?) as users`,
    [scope.memberOnly.id, scope.teammateId],
  );
  expect(Number(survivors[0].orgs)).toBe(1);
  expect(Number(survivors[0].users)).toBe(1);
});
