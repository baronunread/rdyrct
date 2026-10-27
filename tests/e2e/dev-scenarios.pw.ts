import { expect, test } from "@playwright/test";
import { rawSql } from "./db";
import { hashPassword } from "../../src/worker/password";

/**
 * The dev scenario switcher (src/worker/dev-scenarios.ts) answers on the dev
 * server. The e2e database is not seeded, so a scenario finds no account in
 * its state and says so instead of signing anybody in; with seed data the
 * same link signs in as the seeded account (checked by hand against
 * `bun run db:seed:local`).
 */
test("the dev scenario list renders and an unseeded scenario signs nobody in", async ({
  request,
}) => {
  const list = await request.get("/__dev/scenarios");
  expect(list.status()).toBe(200);
  const html = await list.text();
  for (const name of ["pro-owner", "fresh", "over-plan", "locked-org", "admin"])
    expect(html).toContain(`/__dev/scenarios/${name}`);

  const unknown = await request.get("/__dev/scenarios/nobody");
  expect(unknown.status()).toBe(404);

  const unseeded = await request.get("/__dev/scenarios/fresh", { maxRedirects: 0 });
  expect(unseeded.status()).toBe(409);
  expect(unseeded.headers()["set-cookie"]).toBeUndefined();
});

/**
 * The success path: an account in the "fresh" state, written the way the
 * seeder writes it, signs in through its scenario link and lands where the
 * link says, with its org selected.
 */
test("a scenario link signs in as its seeded account and lands on the page", async ({ page }) => {
  const userId = "seed-scn-fresh";
  const orgId = "seed-scn-org-fresh";
  const now = Date.now();
  // A leftover from a seeded dev database or an earlier run would make the
  // inserts below collide; this test owns these ids.
  await rawSql(page, "DELETE FROM org_members WHERE user_id = ?", [userId]);
  await rawSql(page, "DELETE FROM orgs WHERE id = ?", [orgId]);
  await rawSql(page, "DELETE FROM account WHERE user_id = ?", [userId]);
  await rawSql(page, "DELETE FROM session WHERE user_id = ?", [userId]);
  await rawSql(page, "DELETE FROM user WHERE id = ?", [userId]);
  await rawSql(
    page,
    "INSERT INTO user (id, name, email, email_verified, plan, created_at, updated_at) VALUES (?, 'Sam Rivera', 'fresh.account@seed.test', 1, 'free', ?, ?)",
    [userId, now, now],
  );
  await rawSql(
    page,
    "INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ('seed-acc-scn-fresh', ?, 'credential', ?, ?, ?, ?)",
    [userId, userId, await hashPassword("seed-password-123"), now, now],
  );
  await rawSql(
    page,
    "INSERT INTO orgs (id, name, created_at) VALUES (?, 'Sam Rivera''s links', ?)",
    [orgId, now],
  );
  await rawSql(
    page,
    "INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    [orgId, userId, now],
  );

  await page.goto("/__dev/scenarios/fresh?to=/links");
  await expect(page).toHaveURL(/\/links$/);
  await expect(page.getByRole("button", { name: "Account menu" })).toContainText("Sam Rivera");
  expect(await page.evaluate(() => localStorage.getItem("rdyrct:currentOrg"))).toBe(orgId);

  // A destination that is not a plain app path falls back to the start page
  // instead of being written into the hop page's script.
  const hop = await page.request.get("/__dev/scenarios/fresh?to=/x%3C/script%3E%3Cscript%3E");
  expect(await hop.text()).toContain('location.replace("/dashboard")');
});
