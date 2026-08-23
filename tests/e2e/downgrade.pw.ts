import { expect, test, type Page } from "@playwright/test";
import { kvValue, makePlatformAdmin, queryRows } from "./db";
import { signUpAndVerify } from "./resend";
import { addActiveCustomDomain, createAdditionalOrg, createQuickLink, guestAccount } from "./orgs";

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
  // A root redirect, so "is it still serving" has an answer that is not the
  // same 404 an unconfigured host gives.
  const [row] = await queryRows<{ id: string; org_id: string }>(
    page,
    "select id, org_id from domains where hostname = ?",
    [hostname],
  );
  const patched = await page.request.patch(`/api/orgs/${row.org_id}/domains/${row.id}`, {
    data: { rootRedirect: "https://example.com/home" },
  });
  expect(patched.ok()).toBe(true);

  // The redirect path answers from KV alone. Before the downgrade the value
  // carries no deadline, so "still serving" below means something.
  const verdict = async () => {
    const value = await kvValue(page, `domain:${hostname}`);
    // SAFETY: this key is written only by publishDomain/desiredKvValue, both
    // of which stringify a KVDomain, so `servesUntil` is the number or null
    // they put there. A missing key reads back as null, which is the same
    // answer as "no deadline".
    return (value as { servesUntil?: number | null } | null)?.servesUntil ?? null;
  };
  expect(await verdict()).toBeNull();

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

  // And it is really still redirecting, which is the whole promise. A
  // regression that failed to republish the grace-period KV value would stop
  // the host dead while every assertion above still passed.
  // The whole pipeline: reconciliation wrote the lock, the storage queue
  // republished the key, and the value the Worker will read carries a
  // deadline that is still ahead. A regression that skipped the republish
  // leaves this null forever (serves forever) or already past (404s now).
  // Polled, because the republish rides the storage queue and is consumed
  // after the request that triggered it has already answered.
  await expect.poll(verdict, { timeout: 20_000 }).not.toBeNull();
  expect(await verdict()).toBeGreaterThan(Date.now());

  // And the banner names what is over, with a route out.
  await expect(page.getByText(/1 custom domain, and this plan has none/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Upgrade to keep them" })).toBeVisible();
});

test("losing seats demotes the newest members to viewer, and says so", async ({
  page,
  browser,
}) => {
  test.slow();
  const email = await adminAccount(page, "downgrade-members");

  // Pro allows 25 members; free allows 3 counting the owner, so two invited
  // teammates are still inside the cap and a third is not.
  await setComp(page, email, "grant");
  const guests = [];
  for (const prefix of ["seat-a", "seat-b", "seat-c"]) {
    await page.goto("/members");
    await page.getByRole("button", { name: "Invite link" }).click();
    await page.getByRole("button", { name: "Create invite link" }).click();
    const [invite] = await queryRows<{ token: string }>(
      page,
      `select token from invites
       where created_by = (select id from user where email = ?)
       order by created_at desc limit 1`,
      [email],
    );
    const guest = await guestAccount(browser, prefix);
    await guest.page.goto(`/invite/${invite.token}`);
    await guest.page.getByRole("button", { name: "Accept invite" }).click();
    await expect(guest.page).toHaveURL(/\/dashboard$/);
    guests.push(guest);
  }

  await setComp(page, email, "revoke");

  // Owner plus the two longest-standing keep their role; the newest is a
  // viewer. Nobody is removed: four rows, still.
  const rows = await queryRows<{ email: string; role: string; previous_role: string | null }>(
    page,
    `select u.email, m.role, m.previous_role from org_members m
     join user u on u.id = m.user_id
     where m.org_id = (
       select m2.org_id from org_members m2
       join user u2 on u2.id = m2.user_id
       where u2.email = ? and m2.role = 'owner'
     )
     order by m.created_at`,
    [email],
  );
  expect(rows).toHaveLength(4);
  expect(rows.map((r) => r.role)).toEqual(["owner", "member", "member", "viewer"]);
  expect(rows[3].previous_role).toBe("member");

  // The demoted member is told why, rather than left to report the missing
  // buttons as a bug. The row carries the marker; the sentence is on hover,
  // so that the reason does not repeat down every row of a long table.
  // The consent banner sits bottom-right, over the very rows this reads, and
  // swallows the hover. Answer it the way a returning visitor already has.
  await page.addInitScript(() => localStorage.setItem("rdyrct:consent:v2", "granted"));
  await page.goto("/members");
  const marker = page.getByText("demoted", { exact: true }).first();
  await expect(marker).toBeVisible({ timeout: 15_000 });
  await marker.hover();
  await expect(page.getByText(/Set to viewer when the plan changed/)).toBeVisible();

  // And they really cannot write any more.
  const demoted = guests[2].page;
  await demoted.goto("/links");
  await expect(demoted.getByRole("button", { name: "New link" }).first()).toBeHidden();

  for (const guest of guests) await guest.context.close();
});
