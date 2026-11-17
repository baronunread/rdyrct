import { expect, test } from "@playwright/test";
import { rawSql } from "./db";
import { hashPassword } from "../../src/worker/password";
import type { Page } from "@playwright/test";

// Both tests use the one "fresh" account and each starts by removing it: the
// e2e database is shared and never reset, so a retry would find the old row.
test.describe.configure({ mode: "serial" });

const userId = "seed-scn-fresh";
const orgId = "seed-scn-org-fresh";

async function removeFreshAccount(page: Page) {
  // By address, not by id: an earlier run that died half way can leave a row
  // under another id, and the address is what is unique.
  const who = "(SELECT id FROM user WHERE email = 'fresh.account@seed.test')";
  await rawSql(page, `DELETE FROM org_members WHERE user_id IN ${who} OR org_id = ?`, [orgId]);
  await rawSql(page, "DELETE FROM orgs WHERE id = ?", [orgId]);
  await rawSql(page, `DELETE FROM account WHERE user_id IN ${who} OR id = ?`, [
    "seed-acc-scn-fresh",
  ]);
  await rawSql(page, `DELETE FROM session WHERE user_id IN ${who}`);
  await rawSql(page, "DELETE FROM user WHERE email = 'fresh.account@seed.test'");
}

test("the dev scenario list renders and an unseeded scenario signs nobody in", async ({
  page,
  request,
}) => {
  await removeFreshAccount(page);
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

test("a scenario link signs in as its seeded account and lands on the page", async ({ page }) => {
  const now = Date.now();
  await removeFreshAccount(page);
  await rawSql(
    page,
    "INSERT INTO user (id, name, email, email_verified, plan, marketing_asked_at, created_at, updated_at) VALUES (?, 'Sam Rivera', 'fresh.account@seed.test', 1, 'free', ?, ?, ?)",
    // Already asked about marketing email, as the seeder writes it: the one-time
    // dialog would otherwise open over the page this test is looking at.
    [userId, now, now, now],
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
