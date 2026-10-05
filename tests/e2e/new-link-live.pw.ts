import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows } from "./db";

/**
 * A link redirects on the first click after "Create link", with no wait.
 *
 * In production it used to 404 for its first seconds while the storage queue
 * waited out its batch window, and a click in that window kept 404ing for a
 * minute because KV cached the miss. Somebody who makes a link and tries it
 * straight away is exactly who that hit. No polling here: the first request
 * has to redirect.
 */

test("a new link redirects on its very first click", async ({ page }) => {
  await signUpAndVerify(page, `live-link-${Date.now()}@gmail.com`, "test-password-123");

  const destination = `https://example.com/live-${Date.now()}`;
  const field = page.getByPlaceholder("https://example.com/launch").first();
  await expect(async () => {
    await field.fill(destination);
    await expect(page.getByRole("button", { name: "Create link" })).toBeEnabled();
  }).toPass();
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();

  const [{ slug }] = await queryRows<{ slug: string }>(
    page,
    "select slug from links where destination = ?",
    [destination],
  );
  const res = await page.request.get(`/${slug}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe(destination);
});
