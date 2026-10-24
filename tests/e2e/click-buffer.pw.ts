import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows, rawSql } from "./db";
import { createQuickLink } from "./orgs";

/**
 * Clicks no longer ride a queue. The redirect hands each one to the ClickBuffer
 * Durable Object, which batches them in memory and flushes to D1 on an alarm
 * (#225): 10 s in production, 0.5 s here under CLICK_FLUSH_MS. The worker
 * tests cover the buffer in isolation; this is the end-to-end claim: a real
 * redirect, and the row turning up shortly after.
 */

const password = "test-password-123";

/** Signs up, makes a link from the dashboard and follows it once. Returns the
 * link's id. */
async function clickNewLink(page: Page, name: string): Promise<string> {
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
  const res = await page.request.get(`/${slug}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe(destination);
  return id;
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
  const id = await clickNewLink(page, "click-buffer");
  await pollCount(page, "select count(*) as n from clicks where link_id = ?", id, 1);
});

/**
 * The stats pages read the click rollups (#26), not raw clicks. The
 * clicks_rollup trigger fills them as the buffer's insert lands. The raw row
 * is deleted before the page loads, so the only place /analytics can find the
 * click is the rollup.
 */
test("a redirect's click shows on /analytics through the rollups (#26)", async ({ page }) => {
  const id = await clickNewLink(page, "click-rollup");
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
});
