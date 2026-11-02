import { test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { queryRows } from "./db";
import { createQuickLink, expectRedirect } from "./orgs";

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
  await createQuickLink(page, destination);

  const [{ slug }] = await queryRows<{ slug: string }>(
    page,
    "select slug from links where destination = ?",
    [destination],
  );
  await expectRedirect(page, slug, destination);
});
