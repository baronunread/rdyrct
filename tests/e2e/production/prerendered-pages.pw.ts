import { expect, test, type Page } from "@playwright/test";

const PRERENDERED_PAGES = [
  { path: "/", heading: "The link shortener that answers to you." },
  { path: "/pricing", heading: "URL shortener pricing: free, $4 or $9 a month" },
  { path: "/qr-code-generator", heading: "QR code generator with logo" },
  { path: "/utm-builder", heading: "UTM builder" },
  { path: "/branded-link-shortener", heading: "Branded link shortener" },
  { path: "/docs", heading: "Developer docs" },
  { path: "/roadmap", heading: "What we are building" },
  { path: "/privacy", heading: "Privacy policy" },
  { path: "/terms", heading: "Terms of service" },
  { path: "/changelog", heading: "Changelog" },
  { path: "/compare", heading: "Compare rdyrct with other link shorteners" },
  { path: "/bitly-alternative", heading: "Bitly alternative: rdyrct vs Bitly" },
  { path: "/rebrandly-alternative", heading: "Rebrandly alternative: rdyrct vs Rebrandly" },
  { path: "/dub-alternative", heading: "Dub alternative: rdyrct vs Dub" },
  { path: "/short-io-alternative", heading: "Short.io alternative: rdyrct vs Short.io" },
  { path: "/whatsapp-qr-code", heading: "WhatsApp QR code generator" },
  { path: "/vcard-qr-code", heading: "vCard QR code generator for business cards" },
  { path: "/wifi-qr-code", heading: "WiFi QR code generator" },
  { path: "/qr-code-monkey-alternative", heading: "QR Code Monkey alternative" },
  { path: "/tinyurl-alternative", heading: "TinyURL alternative: rdyrct vs TinyURL" },
] as const;

const HTML_FALLBACK_PAGES = [] as const;

/** What React reports when hydration does not match the server HTML. The
 *  production build reports it as `pageerror` "Minified React error #418"
 *  (or #423, #425), with none of the words the development message has, so a
 *  console-only check for "hydration" never sees it. */
function collectHydrationErrors(page: Page) {
  const errors: string[] = [];
  const mismatch = /Minified React error #4(18|23|25)|hydration|didn't match|server html/i;
  page.on("pageerror", (error) => {
    if (mismatch.test(error.message)) errors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && mismatch.test(message.text())) errors.push(message.text());
  });
  return errors;
}

async function blockScripts(page: Page) {
  await page.route("**/*", (route) =>
    route.request().resourceType() === "script" ? route.abort() : route.continue(),
  );
}

async function assertPrerenderedHeadings(page: Page) {
  for (const { path, heading } of PRERENDERED_PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading }), path).toBeVisible();
  }
}

test("public content stays visible and correct before JavaScript runs", async ({ page }) => {
  await blockScripts(page);
  await assertPrerenderedHeadings(page);
  for (const { path, text } of HTML_FALLBACK_PAGES) {
    await page.goto(path);
    await expect(page.locator("#root")).toContainText(text);
  }
  // Auth routes render in the browser and carry no static form.
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: /Continue with Google/i }), path).toHaveCount(0);
  }
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Frequently asked questions" })).toBeVisible();
  // The hero globe is decoration that loads after hydration: never baked in.
  await expect(page.locator("[data-hero] canvas")).toHaveCount(0);
  await expect(page.locator("#faq")).toHaveCSS("opacity", "1");
  await page.goto("/docs");
  const origin = new URL(page.url()).origin;
  await expect(page.locator('code[data-mcp-url="endpoint"]')).toHaveText(`${origin}/api/mcp`);
});

test("all prerendered pages hydrate without mismatch warnings", async ({ page }) => {
  const hydrationErrors = collectHydrationErrors(page);

  await assertPrerenderedHeadings(page);

  const origin = new URL(page.url()).origin;
  await page.goto("/docs");
  await expect(page.getByText(`${origin}/api/mcp`, { exact: true })).toBeVisible();
  expect(hydrationErrors).toEqual([]);
});

test("conditional requests keep the prerendered HTML representation", async ({ request }) => {
  const first = await request.get("/pricing");
  expect(first.status()).toBe(200);
  const etag = first.headers().etag;
  expect(etag).toBeTruthy();

  const head = await request.head("/pricing");
  expect(head.status()).toBe(200);
  expect(head.headers().etag).toBe(etag);
  expect(head.headers()["content-type"]).toContain("text/html");

  const second = await request.get("/pricing", { headers: { "if-none-match": etag! } });
  if (second.status() === 304) {
    expect(second.headers()["content-type"]).toContain("text/html");
  } else {
    expect(second.status()).toBe(200);
    const body = await second.text();
    expect(body).toContain("URL shortener pricing: free, $4 or $9 a month");
    expect(body).not.toContain("The link shortener that answers to you.");
  }
});

// The build bakes the landing page into index.html, the shell every app route
// gets. A signed-in reload of /dashboard painted it until the bundle replaced
// it. App routes must ship an empty root.
test("an app route's raw HTML carries no landing page", async ({ request }) => {
  const body = await (await request.get("/dashboard")).text();
  expect(body).toContain('id="root"');
  expect(body).not.toContain("The link shortener that answers to you.");
});

// Auth routes read browser state on their first render, including query params.
test("the auth pages render with query params and stay usable", async ({ page }) => {
  const hydrationErrors = collectHydrationErrors(page);

  // The loaded form must retain input after its initial queries resolve.
  const typeEmail = (path: string, heading: string) =>
    expect(async () => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await page.getByLabel("Email").fill("someone@example.com");
      await page.waitForTimeout(500);
      await expect(page.getByLabel("Email")).toHaveValue("someone@example.com");
    }).toPass({ timeout: 15_000 });

  await typeEmail("/signup?next=/billing%3Fplan%3Dpro", "Create an account");
  await typeEmail("/login?next=/dashboard", "Sign in");
  expect(hydrationErrors).toEqual([]);
});

// Once the client-rendered form appears, it must stay visible.
test("a slow auth chunk leaves the loaded form visible", async ({ page }) => {
  const blank: string[] = [];
  page.on("console", (message) => {
    if (message.text() === "auth-heading-gone") blank.push(message.text());
  });
  await page.route("**/assets/auth-*.js", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.addInitScript(() => {
    let seen = false;
    requestAnimationFrame(function tick() {
      const there = [...document.querySelectorAll("h1")].some(
        (h1) => h1.textContent === "Sign in" && h1.getBoundingClientRect().height > 0,
      );
      if (there) seen = true;
      else if (seen) console.info("auth-heading-gone");
      requestAnimationFrame(tick);
    });
  });
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  expect(blank).toEqual([]);
});

// Twelve Tools, Fazier and PeerPush list rdyrct.com in exchange for a link
// back from the homepage, and their checks read the served HTML: a followed
// text link for Twelve Tools, each directory's own badge for the others. On the homepage
// only, and the dropped directories stay dropped.
test("the homepage credits its directories in the served HTML, followed", async ({ request }) => {
  const res = await request.get("/");
  const home = await res.text();
  const anchor = (href: string) =>
    home.match(new RegExp(`<a[^>]*href="${href.replace(/[.?]/g, "\\$&")}"[^>]*>`))?.[0] ?? "";
  for (const href of [
    "https://twelve.tools",
    "https://fazier.com/launches/rdyrct.com",
    "https://peerpush.com/p/rdyrct",
  ]) {
    expect(anchor(href), href).not.toBe("");
    expect(anchor(href), href).not.toMatch(/nofollow|ugc|sponsored/);
  }
  // The light badge is the one in the default render, and the CSP lets it load.
  expect(home).toContain(
    'src="https://fazier.com/api/v1//public/badges/launch_badges.svg?badge_type=launched&amp;theme=light"',
  );
  expect(home).toContain('src="https://peerpush.com/p/rdyrct/badge.png"');
  expect(res.headers()["content-security-policy"]).toMatch(/img-src[^;]*https:\/\/fazier\.com/);
  expect(res.headers()["content-security-policy"]).toMatch(/img-src[^;]*https:\/\/peerpush\.com/);
  for (const dropped of ["turbo0.com", "dang.ai"]) expect(home).not.toContain(dropped);

  const pricing = await (await request.get("/pricing")).text();
  expect(pricing).not.toContain("https://twelve.tools");
  expect(pricing).not.toContain("fazier.com/launches");
  expect(pricing).not.toContain("peerpush.com/p/rdyrct");
});
