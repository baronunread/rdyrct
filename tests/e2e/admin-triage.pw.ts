// fallow-ignore-file code-duplication -- specs repeat their setup so each reads on its own
import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin, queryRows, rawSql, seedSubscriber } from "./db";
import { createQuickLink } from "./orgs";

/**
 * The admin screens an abuse report sends somebody to: the org list's review
 * and suspended states, the user table with awkward data, and what a link row
 * says about its reports and suspension.
 */

const password = "test-password-123";

async function ownerWithLink(page: import("@playwright/test").Page, label: string) {
  const email = `${label}-${Date.now()}@gmail.com`;
  const destination = `https://${label}-${Date.now()}.example/page`;
  await signUpAndVerify(page, email, password);
  await createQuickLink(page, destination);
  await makePlatformAdmin(page, email);
  const link = (
    await queryRows<{ id: string; slug: string; org_id: string }>(
      page,
      "select id, slug, org_id from links where destination = ?",
      [destination],
    )
  )[0];
  return { email, link };
}

test("an org flagged for review can be found, filtered and marked reviewed", async ({ page }) => {
  const { email, link } = await ownerWithLink(page, "admin-review");
  await rawSql(page, "update orgs set review_flagged_at = ? where id = ?", [
    Date.now(),
    link.org_id,
  ]);

  await page.goto("/admin/orgs");
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row.getByText("needs review")).toBeVisible({ timeout: 10_000 });

  // The filter narrows to flagged orgs.
  await page.getByRole("button", { name: "Needs review", exact: true }).click();
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: "Mark reviewed" }).click();

  // Cleared, so it leaves the filtered list. The clearance is what stops the
  // next sweep flagging it again.
  await expect(row).toHaveCount(0, { timeout: 10_000 });
  const [org] = await queryRows<{ flagged: number | null; cleared: number | null }>(
    page,
    "select review_flagged_at as flagged, cleared_at as cleared from orgs where id = ?",
    [link.org_id],
  );
  expect(org.flagged).toBeNull();
  expect(org.cleared).not.toBeNull();
});

test("a suspended org shows it and Restore links brings its links back", async ({ page }) => {
  const { email, link } = await ownerWithLink(page, "admin-restore");
  const suspend = await page.request.post(`/api/admin/links/orgs/${link.org_id}/suspend`, {
    data: { reason: "triage spec" },
  });
  expect(suspend.ok()).toBe(true);

  await page.goto("/admin/orgs");
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row.getByText("suspended")).toBeVisible({ timeout: 10_000 });

  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: "Restore links" }).click();
  await expect(row.getByText("suspended")).toHaveCount(0, { timeout: 10_000 });

  await expect
    .poll(async () => (await page.request.get(`/${link.slug}`, { maxRedirects: 0 })).status(), {
      timeout: 15_000,
    })
    .toBe(302);
});

test("a link row shows its open report count and why it was suspended", async ({ page }) => {
  const { link } = await ownerWithLink(page, "admin-badges");
  for (const n of [1, 2])
    await rawSql(
      page,
      "insert into link_reports (id, slug, link_id, org_id, reason, created_at) values (?, ?, ?, ?, 'phishing', ?)",
      [`report-${Date.now()}-${n}`, link.slug, link.id, link.org_id, Date.now()],
    );
  const suspend = await page.request.patch(`/api/admin/links/${link.id}`, {
    data: { suspended: true, reason: "asks for card numbers" },
  });
  expect(suspend.ok()).toBe(true);

  await page.goto(`/admin/links?org=${link.org_id}`);
  const row = page.getByRole("row").filter({ hasText: link.slug });
  await expect(row.getByText("2 reports")).toBeVisible({ timeout: 10_000 });
  await expect(row.getByTitle("asks for card numbers")).toBeVisible();
});

test("the users table keeps one line per user when the name and email are huge", async ({
  page,
}) => {
  const email = `${"a-very-long-local-part-".repeat(2)}${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await makePlatformAdmin(page, email);
  const longName = "Wolfeschlegelsteinhausenbergerdorff".repeat(4);
  await rawSql(page, "update user set name = ? where email = ?", [longName, email]);

  await page.goto("/admin/users");
  const row = page.getByRole("row").filter({ hasText: email });
  await expect(row).toBeVisible({ timeout: 10_000 });

  // Plan and billing are one column now.
  await expect(page.getByRole("columnheader", { name: "Billing" })).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Plan" })).toBeVisible();

  // Truncated, not wrapped: a long value used to stretch the row and the table.
  const box = await row.boundingBox();
  expect(box!.height).toBeLessThan(90);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // And the table itself fits its card: an auto-layout column grows to the
  // longest value and the card starts scrolling sideways.
  const tableScroll = await page.evaluate(() => {
    const wrapper = document.querySelector("table")!.parentElement!;
    return wrapper.scrollWidth - wrapper.clientWidth;
  });
  expect(tableScroll).toBeLessThanOrEqual(0);
  // The full value stays reachable.
  await expect(row.getByTitle(email)).toBeVisible();
  await expect(row.getByTitle(longName).first()).toBeVisible();
});

test("an empty status filter says what it found, not an empty search", async ({ page }) => {
  const email = `admin-empty-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, email, password);
  await makePlatformAdmin(page, email);
  // Nothing flagged anywhere, whatever earlier runs left behind.
  await rawSql(page, "update orgs set review_flagged_at = null");

  await page.goto("/admin/orgs");
  await page.getByRole("button", { name: "Needs review", exact: true }).click();
  await expect(page.getByText("No organizations need review.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/match “”/)).toHaveCount(0);
});

test("the plan column is the plan, plus a badge only when billing has news", async ({ page }) => {
  const admin = `admin-plan-${Date.now()}@gmail.com`;
  const leaver = `leaving-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, admin, password);
  await makePlatformAdmin(page, admin);
  await seedSubscriber(page, leaver, "pro");
  await rawSql(
    page,
    "update user set polar_subscription_cancel_at_period_end = 1, polar_subscription_current_period_end = ? where email = ?",
    [Date.UTC(2030, 10, 3), leaver],
  );

  await page.goto("/admin/users");
  const leaverRow = page.getByRole("row").filter({ hasText: leaver });
  await expect(leaverRow.getByText("pro", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(leaverRow.getByText(/^cancels .*2030$/)).toBeVisible();

  // Nothing to add for an ordinary row: no badge beside the plan.
  const adminRow = page.getByRole("row").filter({ hasText: admin });
  await expect(adminRow.getByText(/cancels|past due|comped/)).toHaveCount(0);
});

test("deleting a user deletes the organizations they own", async ({ page, browser }) => {
  const victimEmail = `victim-${Date.now()}@gmail.com`;
  const destination = `https://victim-${Date.now()}.example/page`;
  const victim = await (await browser.newContext()).newPage();
  await signUpAndVerify(victim, victimEmail, password);
  await createQuickLink(victim, destination);

  const admin = `admin-delete-${Date.now()}@gmail.com`;
  await signUpAndVerify(page, admin, password);
  await makePlatformAdmin(page, admin);
  const slug = (
    await queryRows<{ slug: string }>(page, "select slug from links where destination = ?", [
      destination,
    ])
  )[0].slug;

  await page.goto("/admin/users");
  const row = page.getByRole("row").filter({ hasText: victimEmail });
  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: "Delete user" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete user" }).click();

  // The message used to be "User owns organizations, delete those orgs first".
  await expect(page.getByText("User deleted")).toBeVisible({ timeout: 10_000 });
  await expect(row).toHaveCount(0);
  await expect
    .poll(async () => (await page.request.get(`/${slug}`, { maxRedirects: 0 })).status(), {
      timeout: 30_000,
      message: "the deleted user's link never stopped redirecting",
    })
    .not.toBe(302);
});
