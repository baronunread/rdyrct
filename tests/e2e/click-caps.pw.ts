import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows, rawSql, type SqlParam } from "./db";
import { createQuickLink, expectRedirect } from "./orgs";

/**
 * Tracked clicks per plan (#387): an org at its monthly cap keeps
 * redirecting, the click is not recorded, and the owner is told so on
 * /billing and the dashboard. The worker tests cover the counter and the
 * emails; this is the claim a person checks in a browser.
 */
test("an org at its click cap still redirects, and /billing shows the cap reached", async ({
  page,
}) => {
  await signUpAndVerify(page, `click-cap-${Date.now()}@gmail.com`, "test-password-123");
  const destination = `https://example.com/click-cap-${Date.now()}`;
  await createQuickLink(page, destination);
  const [link] = await queryRows<{ id: string; slug: string; orgId: string }>(
    page,
    "select id, slug, org_id as orgId from links where destination = ?",
    [destination],
  );
  const { id, slug, orgId } = link;
  // A free org that has already recorded its 5,000 clicks this month.
  const month = new Date().toISOString().slice(0, 7);
  const usage: SqlParam[] = [orgId, month];
  await rawSql(
    page,
    "insert into org_click_usage (org_id, month, clicks) values (?, ?, 5000)",
    usage,
  );

  await expectRedirect(page, slug, destination);

  // The buffer flushes 0.5 s after the click here (CLICK_FLUSH_MS). Give it
  // several flushes' time, then check it wrote nothing for this link.
  await page.waitForTimeout(3_000);
  const [{ n }] = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from clicks where link_id = ?",
    [id],
  );
  expect(n).toBe(0);
  const [{ clicks }] = await queryRows<{ clicks: number }>(
    page,
    "select clicks from org_click_usage where org_id = ? and month = ?",
    usage,
  );
  expect(clicks).toBe(5000);

  await page.goto("/billing");
  await expect(page.getByText("Clicks counted this month 5,000 / 5,000")).toBeVisible();
  await expect(page.getByText("Limit reached.")).toBeVisible();

  await page.goto("/dashboard");
  await expect(
    page.getByText(/This organization has recorded its 5,000 clicks for .*Your links still work\./),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "See plans" })).toBeVisible();
});
