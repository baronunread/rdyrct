// fallow-ignore-file code-duplication -- specs repeat their setup so each reads on its own
import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify } from "./resend";
import { makePlatformAdmin, queryRows } from "./db";
import { createQuickLink } from "./orgs";

/**
 * What a visitor meets on a held or warned link (#344), served by the Worker
 * in place of the redirect. The worker tests cover the KV values and the
 * markup; this covers a person opening the link in a browser.
 */

const password = "test-password-123";

async function slugFor(page: Page, destination: string) {
  const [link] = await queryRows<{ slug: string }>(
    page,
    "select slug from links where destination = ?",
    [destination],
  );
  return link.slug;
}

test("a held link says it is under review instead of a 404", async ({ page }) => {
  await signUpAndVerify(page, `held-${Date.now()}@gmail.com`, password);
  // Scam-shaped, so it is created on hold (abuse-rules).
  const destination = `https://phonepewheel-${Date.now()}.up.railway.app/`;
  await createQuickLink(page, destination);
  const slug = await slugFor(page, destination);

  const res = await page.goto(`/${slug}`);
  expect(res?.status()).toBe(403);
  await expect(
    page.getByRole("heading", { level: 1, name: "This link is under review." }),
  ).toBeVisible();
  // Neither where it led nor why it stopped.
  await expect(page.getByText("railway.app")).toHaveCount(0);
});

test("an admin warns a link in one click, and a visitor continues past the warning", async ({
  page,
  browser,
}) => {
  const email = `warned-${Date.now()}@gmail.com`;
  const destination = `https://example.com/warned-${Date.now()}`;
  await signUpAndVerify(page, email, password);
  await createQuickLink(page, destination);
  const slug = await slugFor(page, destination);

  await makePlatformAdmin(page, email);
  await page.goto("/admin/links");
  await page.getByRole("textbox", { name: "Search links" }).fill(destination);
  const row = page.getByRole("row").filter({ hasText: slug });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByRole("button", { name: `Actions for ${slug}` }).click();
  await page.getByRole("menuitem", { name: "Show a warning" }).click();
  await expect(page.getByText(/Warning on\./)).toBeVisible({ timeout: 10_000 });
  await expect(row.getByText("warning", { exact: true })).toBeVisible();

  // A visitor, with no session, and no real trip to example.com.
  const visitor = await (await browser.newContext()).newPage();
  await visitor.route("https://example.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Landed</h1>" }),
  );
  // Not followed: until the republish lands, the old KV value still 302s to
  // example.com, which the route above also answers 200. Only the warning
  // page itself is a 200 from our host.
  await expect
    .poll(async () => (await visitor.request.get(`/${slug}`, { maxRedirects: 0 })).status(), {
      timeout: 15_000,
    })
    .toBe(200);
  await visitor.goto(`/${slug}`);
  await expect(
    visitor.getByRole("heading", { level: 1, name: "Check where this link goes." }),
  ).toBeVisible();
  await expect(visitor.getByText("example.com", { exact: true })).toBeVisible();
  await visitor.getByRole("link", { name: "Continue" }).click();
  await expect(visitor).toHaveURL(destination);
  await expect(visitor.getByRole("heading", { name: "Landed" })).toBeVisible();
});
