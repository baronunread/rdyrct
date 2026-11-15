import { expect, test } from "@playwright/test";
import { queryRows } from "./db";
import { signUpWithLiveLink } from "./orgs";

/**
 * A deleted link's slug is never handed out again.
 *
 * Old posts, emails and printed QR codes keep pointing at it. Dead bit.ly
 * links in old brand tweets were claimed by strangers and now preview pages
 * their owners never linked; on the shared domain, the slug stays retired
 * and answers 404 for good.
 */
test("a deleted link answers 404 and its slug stays retired", async ({ page }) => {
  const { slug } = await signUpWithLiveLink(page, "dead-slug");

  await page.goto("/links");
  await page
    .getByRole("region", { name: "Cookie consent" })
    .getByRole("button", { name: "Reject" })
    .click();
  const row = page.getByRole("row", { name: new RegExp(slug) });
  await row.hover();
  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: "Delete link" }).click();
  await page
    .getByRole("dialog", { name: /^Delete .+\/.+\?$/ })
    .getByRole("button", { name: "Delete link" })
    .click();
  await expect(page.getByText("Link deleted")).toBeVisible();

  // The KV key goes through the storage queue, so give it a moment.
  await expect
    .poll(async () => (await page.request.get(`/${slug}`, { maxRedirects: 0 })).status())
    .toBe(404);
  const issued = await queryRows<{ slug: string }>(
    page,
    "select slug from issued_slugs where slug = ?",
    [slug],
  );
  expect(issued).toHaveLength(1);
});
