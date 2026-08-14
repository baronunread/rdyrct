import { expect, test } from "@playwright/test";

/**
 * The head a crawler actually receives, from the built Worker and the real
 * asset bundle.
 *
 * Fetched rather than rendered: the clients this is for (Slack, WhatsApp,
 * iMessage, Discord, and Bing's first pass) read the bytes and never run a
 * line of the page's JavaScript. A title set on mount would pass a rendered
 * check and still be wrong for every one of them.
 */

const PAGES = [
  { path: "/", title: /URL shortener and QR code generator/ },
  { path: "/qr-code-generator", title: /Free QR code generator with logo/ },
  { path: "/signup", title: /Sign up/ },
  { path: "/privacy", title: /Privacy policy/ },
];

test("each public page arrives with its own title", async ({ request }) => {
  for (const { path, title } of PAGES) {
    const html = await (await request.get(path)).text();
    const found = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    expect(found, `title of ${path}`).toMatch(title);
  }
});

test("each public page points its canonical at itself", async ({ request }) => {
  for (const { path } of PAGES) {
    const html = await (await request.get(path)).text();
    const canonical = /rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(new URL(canonical).pathname, `canonical of ${path}`).toBe(path);
  }
});

test("the QR page describes itself in the share tags, not the landing page", async ({
  request,
}) => {
  const html = await (await request.get("/qr-code-generator")).text();

  expect(html).toMatch(/"og:title" content="Free QR code generator/);
  expect(html).toMatch(/"og:description" content="Make a custom QR code online for free/);
  expect(html).toMatch(/"og:url" content="[^"]*\/qr-code-generator"/);
});

test("the signed-in app keeps the default head", async ({ request }) => {
  // Nothing behind the login wants search traffic.
  const html = await (await request.get("/dashboard")).text();

  expect(html).toContain("<title>rdyrct - branded short links for your team");
});

test("walking off a public page does not take its title along", async ({ page }) => {
  // The head the Worker wrote is right for the document it served, and wrong
  // for wherever a client-side navigation goes next. Restoring "what the
  // document arrived with" looked correct and was exactly backwards for the
  // visitor who arrived on the public page itself: they carried the privacy
  // title onto the page they clicked through to.
  await page.goto("/privacy");
  await expect(page).toHaveTitle(/Privacy policy/);

  await page.getByRole("link", { name: "Terms" }).click();
  await expect(page).toHaveTitle(/Terms of service/);

  // And off a public page entirely. Asserted as "not the page we left",
  // because what the landing page ends up titled depends on whether it
  // claims a head of its own, while "the privacy title came along" is the
  // bug in either case.
  await page.goto("/privacy");
  await page.getByRole("link", { name: "rdyrct" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page).not.toHaveTitle(/Privacy policy/);
});
