import { expect, test } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { createOrg } from "./orgs";
import { makePlatformAdmin, queryRows } from "./db";

/**
 * Admin link moderation through the screen an admin actually uses (#67).
 *
 * The worker tests cover enforcement. This covers the part only a browser
 * can: that somebody holding an abuse report can find the link by its
 * destination, stop it, and see that it stopped.
 */

const password = "test-password-123";

test("an admin can find a link by destination and suspend it", async ({ page }) => {
  // A normal account with a link to be reported.
  const ownerEmail = `owner-${Date.now()}@gmail.com`;
  const destination = `https://phishy-${Date.now()}.example/login`;
  await signUpAndVerify(page, ownerEmail, password);
  await createOrg(page, "Reported Org");

  const field = page.getByPlaceholder("https://example.com/launch").first();
  await expect(field).toBeVisible();
  await field.fill(destination);
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("dialog", { name: "Link created" })).toBeVisible();

  const slug = (
    await queryRows<{ slug: string }>(page, "select slug from links where destination = ?", [
      destination,
    ])
  )[0].slug;

  // The link redirects, which is the thing suspension has to stop. Polled,
  // because publishing rides the storage queue and is eventual by design.
  await expect
    .poll(async () => (await page.request.get(`/${slug}`, { maxRedirects: 0 })).status(), {
      timeout: 15_000,
      message: "the link never started redirecting",
    })
    .toBe(302);

  // Now an admin, holding the report.
  await makePlatformAdmin(page, ownerEmail);
  await page.goto("/admin/links");
  await expect(page.getByRole("heading", { name: "Links" })).toBeVisible();

  await page.getByPlaceholder(/Slug or destination/).fill(destination);
  const row = page.getByRole("row").filter({ hasText: slug });
  await expect(row).toBeVisible({ timeout: 10_000 });

  await row.getByRole("button", { name: "Suspend" }).click();
  const dialog = page.getByRole("dialog", { name: "Suspend this link" });
  await expect(dialog).toBeVisible();
  // A suspension with no reason is not answerable later, so it is refused.
  await expect(dialog.getByRole("button", { name: "Suspend link" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("phishing report, ticket 412");
  await dialog.getByRole("button", { name: "Suspend link" }).click();

  await expect(page.getByText("suspended").first()).toBeVisible({ timeout: 10_000 });

  // The redirect is gone, and the row and its clicks are not.
  await expect
    .poll(async () => (await page.request.get(`/${slug}`, { maxRedirects: 0 })).status(), {
      timeout: 15_000,
    })
    .not.toBe(302);

  const rows = await queryRows<{ n: number }>(
    page,
    "select count(*) as n from links where slug = ?",
    [slug],
  );
  expect(Number(rows[0].n)).toBe(1);

  // And it is answerable: the audit log names the action and the reason.
  await expect(page.getByText("link.suspend").first()).toBeVisible();
  await expect(page.getByText(/ticket 412/).first()).toBeVisible();
});

test("the Links tab is invisible and unreachable for a normal user", async ({ page }) => {
  await signUpAndVerify(page, `plain-${Date.now()}@gmail.com`, password);
  await createOrg(page, "Plain Org");

  // By href, not by label: the app's own "Links" tab is called that too, and
  // a name-based assertion would pass for the wrong reason.
  await expect(page.locator('a[href="/admin/links"]')).toHaveCount(0);

  // 404, not 403: a 403 would confirm the route exists.
  const res = await page.request.get("/api/admin/links");
  expect(res.status()).toBe(404);
});
