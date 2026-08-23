import { expect, test, type Page } from "@playwright/test";
import { makePlatformAdmin, queryRows } from "./db";
import { signUpAndVerify } from "./resend";
import { addActiveCustomDomain, createAdditionalOrg, createQuickLink } from "./orgs";

/**
 * What a downgrade looks like from the account it happens to (#158 to #163).
 *
 * Driven through the admin comp routes, because those are the plan change
 * this suite can actually cause: granting one runs the same reconciliation
 * pass a Polar `subscription.active` does, and revoking it runs the one a
 * `subscription.revoked` does.
 *
 * The point of every assertion here is the same: nothing was deleted, the
 * app says so, and there is a way back on the screen.
 */

const password = "test-password-123";

/** Signs up an account that is also a platform admin, so it can move its own
 * plan through the admin screens. */
async function adminAccount(page: Page, prefix: string) {
  const email = `${prefix}-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await makePlatformAdmin(page, email);
  return email;
}

/** Grants or revokes this account's own comp through /admin/users, which is
 * what triggers the reconciliation pass. */
async function setComp(page: Page, email: string, action: "grant" | "revoke") {
  await page.goto("/admin/users");
  const row = page.getByRole("row", { name: new RegExp(email) });
  await row.getByRole("button", { name: "Actions for" }).click();
  if (action === "grant") {
    await page.getByRole("menuitem", { name: "Comp a paid plan" }).click();
    const dialog = page.getByRole("dialog", { name: /^Comp / });
    await dialog.getByLabel("Reason").fill("Downgrade test");
    await dialog.getByRole("button", { name: "Grant comp" }).click();
    await expect(page.getByText("Comp granted")).toBeVisible();
  } else {
    await page.getByRole("menuitem", { name: "Revoke comp" }).click();
    await expect(page.getByText("Comp revoked")).toBeVisible();
  }
}

test("losing Pro locks the extra org, says why, and lets the owner pick which one stays", async ({
  page,
}) => {
  test.slow();
  const email = await adminAccount(page, "downgrade-orgs");

  // Pro allows three owned orgs, so a second one can exist to be locked.
  await setComp(page, email, "grant");
  await page.goto("/dashboard");
  await createQuickLink(page, "example.com/keeps-redirecting");
  // The confirmation dialog owns the screen until it is dismissed, and the
  // org switcher sits behind its backdrop.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeHidden();
  await createAdditionalOrg(page, "Second org");

  await setComp(page, email, "revoke");
  await page.goto("/dashboard");

  // The newest org is the one that gives way, so the app lands on a locked
  // org and has to explain itself rather than showing an empty screen.
  await expect(page.getByText(/is locked/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Nothing was deleted/)).toBeVisible();

  // Locked means read-only for its owner too: no create control anywhere.
  await page.goto("/links");
  await expect(page.getByRole("button", { name: "New link" }).first()).toBeHidden();

  // The locked org is still in the switcher, marked, rather than gone.
  await page.getByTitle("Switch organization").click();
  await expect(page.getByRole("menuitem", { name: /Second org/ })).toContainText("locked");
  await page.keyboard.press("Escape");

  // And the choice is a real one: keeping this org active frees the other.
  await page.getByRole("button", { name: "Use this one" }).click();
  await expect(page.getByText(/is active again/)).toBeVisible();
  await expect(page.getByText(/is locked/)).toBeHidden();
  await expect(page.getByRole("button", { name: "New link" }).first()).toBeVisible();

  const rows = await queryRows<{ n: number }>(
    page,
    `select count(*) as n from orgs
     join org_members on org_members.org_id = orgs.id
     join user on user.id = org_members.user_id
     where user.email = ? and org_members.role = 'owner'`,
    [email],
  );
  // Two orgs, still. The lock never deletes one.
  expect(rows[0].n).toBe(2);
});

test("losing a paid plan locks the custom domain, keeps it redirecting, and says when it stops", async ({
  page,
}) => {
  test.slow();
  const email = await adminAccount(page, "downgrade-domains");

  await setComp(page, email, "grant");
  const hostname = await addActiveCustomDomain(page);

  await setComp(page, email, "revoke");
  await page.goto("/domains");

  // The domain is still listed. Hiding it behind an upgrade pitch is how an
  // owner concludes we deleted it.
  await expect(page.getByText(hostname)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("locked", { exact: true })).toBeVisible();
  await expect(page.getByText(/Still redirecting until/)).toBeVisible();
  await expect(page.getByRole("heading", { name: /custom domains are locked/i })).toBeVisible();

  // The row, the KV entry and the Cloudflare hostname all stay.
  const [domain] = await queryRows<{ locked_at: number | null; cf_hostname_id: string | null }>(
    page,
    "select locked_at, cf_hostname_id from domains where hostname = ?",
    [hostname],
  );
  expect(domain.locked_at).not.toBeNull();

  // And the banner names what is over, with a route out.
  await expect(page.getByText(/1 custom domain, and this plan has none/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Upgrade to keep them" })).toBeVisible();
});
