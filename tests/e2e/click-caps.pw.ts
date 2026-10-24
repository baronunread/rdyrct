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
  browser,
}) => {
  // The control: an org under its cap, so the test can tell "capped" from
  // "nothing was recorded at all".
  const control = await (await browser.newContext()).newPage();
  await signUpAndVerify(control, `click-cap-control-${Date.now()}@gmail.com`, "test-password-123");
  const controlDestination = `https://example.com/click-cap-control-${Date.now()}`;
  await createQuickLink(control, controlDestination);
  const [controlLink] = await queryRows<{ id: string; slug: string }>(
    control,
    "select id, slug from links where destination = ?",
    [controlDestination],
  );

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
  // Followed after the capped one. Every click goes through the one buffer in
  // order, so once this one is stored, the capped click's flush has run too.
  await expectRedirect(control, controlLink.slug, controlDestination);

  const clicksOn = async (linkId: string) =>
    (
      await queryRows<{ n: number }>(page, "select count(*) as n from clicks where link_id = ?", [
        linkId,
      ])
    )[0].n;
  await expect.poll(() => clicksOn(controlLink.id), { timeout: 15_000 }).toBe(1);
  expect(await clicksOn(id)).toBe(0);
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
    page.getByText(
      /This organization has reached the 5,000 clicks its plan counts in .*Your links still work\./,
    ),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "See plans" })).toBeVisible();
  await control.context().close();
});
