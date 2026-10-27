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
  // A free org that has already reached its 5,000 clicks this month.
  const month = new Date().toISOString().slice(0, 7);
  const usage: SqlParam[] = [orgId, month];
  await rawSql(
    page,
    "insert into org_click_usage (org_id, month, clicks) values (?, ?, 5000)",
    usage,
  );

  await expectRedirect(page, slug, destination);

  // Wait on the capped click's own trace: the flush counts what it drops in
  // click_overflow (for the abuse sweep). Once it reads 1, the flush has run
  // and chosen to drop the click, so the checks below cannot pass merely
  // because nothing was flushed yet.
  const dropped = async () =>
    (
      await queryRows<{ n: number }>(
        page,
        "select coalesce(sum(clicks), 0) as n from click_overflow where link_id = ?",
        [id],
      )
    )[0].n;
  await expect.poll(dropped, { timeout: 15_000 }).toBe(1);
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
  // The usage row: its label, a bar, and "5,000 of 5,000".
  const clickRow = page.getByText("Clicks counted this month").locator("..");
  await expect(clickRow.getByText("5,000 of 5,000", { exact: true })).toBeVisible();
  await expect(page.getByText("Limit reached.")).toBeVisible();

  await page.goto("/dashboard");
  // One line of facts, and the sentence as the note under it.
  await expect(page.getByText("Click limit reached", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      /This organization has reached the 5,000 clicks its plan counts in .*Your links still work\./,
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "See plans" })).toBeVisible();
});
