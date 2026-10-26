import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows, rawSql } from "./db";
import { createQuickLink, expectRedirect } from "./orgs";

/**
 * Clicks no longer ride a queue. The redirect hands each one to the ClickBuffer
 * Durable Object, which batches them in memory and flushes to D1 on an alarm
 * (#225): 10 s in production, 0.5 s here under CLICK_FLUSH_MS. The worker
 * tests cover the buffer in isolation; this is the end-to-end claim: a real
 * redirect, and the row turning up shortly after.
 */

const password = "test-password-123";

/** Signs up, makes a link from the dashboard and follows it once. Returns the
 * link's id and slug. */
async function clickNewLink(page: Page, name: string): Promise<{ id: string; slug: string }> {
  await signUpAndVerify(page, `${name}-${Date.now()}@gmail.com`, password);
  const destination = `https://example.com/${name}-${Date.now()}`;
  await createQuickLink(page, destination);

  const [{ slug, id }] = await queryRows<{ slug: string; id: string }>(
    page,
    "select id, slug from links where destination = ?",
    [destination],
  );
  expect(slug).toBeTruthy();

  // KV is written in the create request, so the redirect is live at once.
  await expectRedirect(page, slug, destination);
  return { id, slug };
}

/** Polls a count query until it reaches `atLeast`. */
async function pollCount(page: Page, sql: string, id: string, atLeast: number) {
  await expect
    .poll(async () => Number((await queryRows<{ n: number }>(page, sql, [id]))[0].n), {
      timeout: 15_000,
      intervals: [500],
    })
    .toBeGreaterThanOrEqual(atLeast);
}

test("a redirect's click reaches D1 through the buffer (#225)", async ({ page }) => {
  const { id } = await clickNewLink(page, "click-buffer");
  await pollCount(page, "select count(*) as n from clicks where link_id = ?", id, 1);
});

/**
 * The stats pages and the links list read the click rollups (#26), not raw
 * clicks. insertClicks fills them through rollupStatements, in the same D1
 * batch as the buffer's raw insert. The raw row is deleted before either page
 * loads, so the only place /analytics or /links can find the click is the
 * rollup.
 */
test("a redirect's click shows on /analytics and /links through the rollups (#26)", async ({
  page,
}) => {
  const { id, slug } = await clickNewLink(page, "click-rollup");
  await pollCount(
    page,
    "select coalesce(sum(clicks), 0) as n from click_daily where link_id = ?",
    id,
    1,
  );
  await rawSql(page, "delete from clicks where link_id = ?", [id]);

  await page.goto("/analytics");
  const total = page.getByText("Total clicks", { exact: true }).locator("..");
  await expect(total.locator("p.tnum")).toHaveText("1");
  await expect(page.getByText("Today (UTC)")).toHaveCount(0);

  // The 24-hour view: its chart covers the last 24 hours, its breakdowns
  // today's UTC day, and each breakdown says so.
  await page.getByRole("button", { name: "24h", exact: true }).click();
  await expect(page.getByText("Last 24 hours")).toBeVisible();
  for (const name of ["Countries", "Referrers", "Devices"]) {
    const label = page.getByText(name, { exact: true }).locator("..");
    await expect(label).toHaveText(`${name}Today (UTC)`);
  }

  await page.goto("/links");
  const row = page.getByRole("row").filter({ hasText: slug });
  await expect(row.locator("td.tnum")).toHaveText("1");
});
