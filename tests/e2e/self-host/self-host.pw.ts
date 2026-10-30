import { expect, test } from "@playwright/test";

// A self-hosted copy is the app and its short links. rdyrct.com's own pages,
// head tags and analytics stay out of it (src/shared/site.ts).

test("the front door is the sign-in page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: /sign in|log in/i })).toBeVisible();
  // The tab names this copy (SITE_NAME, else its host), not rdyrct.com.
  await expect(page).toHaveTitle("localhost");
});

test("rdyrct.com's pages are not there", async ({ page }) => {
  for (const path of [
    "/pricing",
    "/docs",
    "/privacy",
    "/bitly-alternative",
    "/utm-builder",
    "/branded-link-shortener",
    "/tinyurl-alternative",
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "Nothing lives at this link." }),
    ).toBeVisible();
  }
});

test("nothing in the page reports to rdyrct.com or claims its address", async ({ request }) => {
  const html = await (await request.get("/login")).text();
  expect(html).not.toContain("stats.brnr.dev");
  expect(html).not.toContain('rel="canonical"');
  expect(html).not.toContain("og:image");
});

test("crawlers are asked to stay out, and rdyrct.com's guides are gone", async ({ request }) => {
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /");
  for (const path of ["/sitemap.xml", "/llms.txt"]) {
    const body = await (await request.get(path)).text();
    expect(body, path).not.toContain("rdyrct.com");
  }
});
