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

test("a public page describes itself in the share tags, not the landing page", async ({
  request,
}) => {
  const html = await (await request.get("/privacy")).text();

  expect(html).toMatch(/"og:title" content="Privacy policy/);
  expect(html).toMatch(/"og:description" content="What rdyrct stores/);
  expect(html).toMatch(/"og:url" content="[^"]*\/privacy"/);
});

test("the signed-in app keeps the default head", async ({ request }) => {
  // Nothing behind the login wants search traffic.
  const html = await (await request.get("/dashboard")).text();

  expect(html).toContain("<title>rdyrct - short links that carry your team's brand");
});
