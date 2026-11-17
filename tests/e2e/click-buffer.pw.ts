import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows, rawSql } from "./db";
import { createQuickLink, expectRedirect } from "./orgs";

// #225: ClickBuffer batches clicks and flushes to D1 on an alarm (CLICK_FLUSH_MS, 0.5 s here).

const password = "test-password-123";

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

  await expectRedirect(page, slug, destination);
  return { id, slug };
}

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

// The raw row is deleted before the page loads, so the rollup (#26) is the only place the click can be found.
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
  const total = page.locator("dl > div").filter({
    has: page.getByRole("term").getByText("Clicks", { exact: true }),
  });
  await expect(total.getByRole("definition").locator("span").first()).toHaveText("1");
  await expect(page.getByText("Today (UTC)")).toHaveCount(0);

  await page.getByRole("button", { name: "24h", exact: true }).click();
  await expect(page.getByText("All links · last 24 hours")).toBeVisible();
  for (const name of ["Countries", "Referrers", "Devices"]) {
    const tabRow = page
      .getByRole("tablist")
      .filter({ has: page.getByRole("tab", { name, exact: true }) })
      .locator("..");
    await expect(tabRow).toContainText("Today (UTC)");
  }

  await page.goto("/links");
  const row = page.getByRole("row").filter({ hasText: slug });
  await expect(row.locator("td.tnum")).toHaveText("1");
});
