import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows } from "./db";

/**
 * Clicks no longer ride a queue. The redirect hands each one to the ClickBuffer
 * Durable Object, which batches them in memory and flushes to D1 on a ~10 s
 * alarm (#225). The worker tests cover the buffer in isolation; this is the
 * end-to-end claim: a real redirect, and the row turning up a few seconds
 * later.
 */

const password = "test-password-123";

test("a redirect's click reaches D1 through the buffer (#225)", async ({ page }) => {
  await signUpAndVerify(page, `click-buffer-${Date.now()}@gmail.com`, password);

  const destination = `https://example.com/buffered-${Date.now()}`;
  const field = page.getByPlaceholder("https://example.com/launch").first();
  await expect(field).toBeVisible();
  await expect(async () => {
    await field.fill(destination);
    await expect(page.getByRole("button", { name: "Create link" })).toBeEnabled();
  }).toPass();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();

  const [{ slug, id }] = await queryRows<{ slug: string; id: string }>(
    page,
    "select id, slug from links where destination = ?",
    [destination],
  );
  expect(slug).toBeTruthy();

  // The KV publish rides the storage queue, so the redirect is live a beat
  // after the row exists.
  await expect
    .poll(async () => (await page.request.get(`/${slug}`, { maxRedirects: 0 })).status(), {
      timeout: 15_000,
      intervals: [500],
    })
    .toBe(302);
  const res = await page.request.get(`/${slug}`, { maxRedirects: 0 });
  expect(res.headers()["location"]).toBe(destination);

  // The flush alarm is ~10 s out; poll past it.
  await expect
    .poll(
      async () => {
        const rows = await queryRows<{ n: number }>(
          page,
          "select count(*) as n from clicks where link_id = ?",
          [id],
        );
        return Number(rows[0].n);
      },
      { timeout: 25_000, intervals: [1_000] },
    )
    .toBeGreaterThanOrEqual(1);
});
