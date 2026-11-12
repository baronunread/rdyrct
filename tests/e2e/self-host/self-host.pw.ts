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
    "/google-url-shortener",
    "/whatsapp-qr-code",
    "/vcard-qr-code",
    "/wifi-qr-code",
    "/qr-code-monkey-alternative",
    "/tinyurl-alternative",
    "/flowcode-alternative",
  ]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
    await expect(
      page.getByRole("heading", { level: 1, name: "No link at this address." }),
    ).toBeVisible();
  }
});

test("a dead link does not advertise rdyrct", async ({ page }) => {
  const res = await page.goto("/no-such-link-x9");
  expect(res?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "No link at this address." }),
  ).toBeVisible();
  await expect(page.getByText("Made with rdyrct")).toHaveCount(0);
});

test("a link page opened directly does not advertise rdyrct either", async ({ request }) => {
  // The prerendered page served as it is, not through a link's redirect.
  const html = await (await request.get("/link-disabled")).text();
  expect(html).not.toContain("Made with rdyrct");
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

test("the icons the MCP server names are served from the copy's own host", async ({ request }) => {
  for (const [path, type] of [
    ["/connector-icon.svg", "image/svg+xml"],
    ["/connector-icon.png", "image/png"],
  ]) {
    const res = await request.get(path!);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toContain(type);
  }
});
